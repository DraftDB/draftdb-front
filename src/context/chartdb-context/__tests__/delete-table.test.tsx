import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import type { Diagram } from '@/lib/domain/diagram';
import { DatabaseType } from '@/lib/domain/database-type';
import type * as HttpClient from '@/lib/api/http-client';
import type * as TablesApi from '@/lib/api/tables-api';
import type { DeleteTableResponse, TableLinks } from '@/lib/api/tables-api';

const mocks = vi.hoisted(() => ({
    isApiConfiguredMock: vi.fn(() => true),
    deleteTable: vi.fn(),
    postTable: vi.fn(),
    toast: vi.fn(),
}));

// getProjetId préfère PROJECT_ID : on le force à '' pour ne pas dépendre d'un .env.
vi.mock('@/lib/env', () => ({
    API_URL: 'http://api.test',
    USER_ID: '',
    PROJECT_ID: '',
}));
vi.mock('@/lib/api/http-client', async (importOriginal) => ({
    ...(await importOriginal<typeof HttpClient>()),
    isApiConfigured: mocks.isApiConfiguredMock,
}));
vi.mock('@/lib/api/tables-api', async (importOriginal) => ({
    ...(await importOriginal<typeof TablesApi>()),
    deleteTable: mocks.deleteTable,
    postTable: mocks.postTable,
}));
vi.mock('@/components/toast/use-toast', () => ({ toast: mocks.toast }));
// i18next n'est pas initialisé dans les tests : `t` renvoie la clé.
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { ApiError } from '@/lib/api/http-client';
import { DiffProvider } from '@/context/diff-context/diff-provider';
import type { StorageContext } from '@/context/storage-context/storage-context';
import {
    storageContext,
    storageInitialValue,
} from '@/context/storage-context/storage-context';
import { redoUndoStackContext } from '@/context/history-context/redo-undo-stack-context';
import { ChartDBProvider } from '../chartdb-provider';
import { useChartDB } from '@/hooks/use-chartdb';

const DIAGRAM_ID = 'diagram_1';

const makeTable = (overrides: Partial<DBTable> = {}): DBTable => ({
    id: 'users',
    name: 'users',
    schema: 'public',
    x: 0,
    y: 0,
    fields: [],
    indexes: [],
    color: '#000000',
    isView: false,
    createdAt: 1,
    ...overrides,
});

const makeRelationship = (
    overrides: Partial<DBRelationship> = {}
): DBRelationship => ({
    id: 'rel1',
    name: 'fk_orders_users',
    sourceTableId: 'orders',
    targetTableId: 'users',
    sourceFieldId: 'f1',
    targetFieldId: 'f2',
    sourceCardinality: 'many',
    targetCardinality: 'one',
    createdAt: 1,
    ...overrides,
});

const storage: StorageContext = {
    ...storageInitialValue,
    updateDiagram: vi.fn().mockResolvedValue(undefined),
    addTable: vi.fn().mockResolvedValue(undefined),
    deleteTable: vi.fn().mockResolvedValue(undefined),
    deleteRelationship: vi.fn().mockResolvedValue(undefined),
    deleteDependency: vi.fn().mockResolvedValue(undefined),
};

const addUndoAction = vi.fn();
const undoStack = {
    redoStack: [],
    undoStack: [],
    addRedoAction: vi.fn(),
    addUndoAction,
    resetRedoStack: vi.fn(),
    resetUndoStack: vi.fn(),
    hasRedo: false,
    hasUndo: false,
};

const Wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
    <DiffProvider>
        <storageContext.Provider value={storage}>
            <redoUndoStackContext.Provider value={undoStack}>
                <ChartDBProvider>{children}</ChartDBProvider>
            </redoUndoStackContext.Provider>
        </storageContext.Provider>
    </DiffProvider>
);

/** Diagramme : users, orders, products ; une relation orders → users. */
const setup = (
    tables: DBTable[] = [
        makeTable(),
        makeTable({ id: 'orders', name: 'orders' }),
        makeTable({ id: 'products', name: 'products' }),
    ],
    relationships: DBRelationship[] = [makeRelationship()]
) => {
    const hook = renderHook(() => useChartDB(), { wrapper: Wrapper });
    const diagram: Diagram = {
        id: DIAGRAM_ID,
        name: 'Test',
        databaseType: DatabaseType.GENERIC,
        tables,
        relationships,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    // Comme l'éditeur : sans cela, diagramId reste '' (prop `diagram` ignorée).
    act(() => hook.result.current.loadDiagramFromData(diagram));
    return hook;
};

const links: TableLinks = {
    cles_etrangeres: [
        {
            id: 'rel1',
            name: 'fk_orders_users',
            sourceTableId: 'orders',
            targetTableId: 'users',
            sourceFieldId: 'f1',
            targetFieldId: 'f2',
        },
    ],
    index: [{ id: 'idx1', name: 'idx_users_email' }],
};

/** 409 réel du back : CONFIRMATION_REQUISE avec la liste des liens. */
const confirmationRequired = (
    detail: Record<string, unknown> = {
        cles_etrangeres: links.cles_etrangeres,
        index: links.index,
    }
) =>
    new ApiError({
        status: 409,
        message: 'HTTP 409',
        code: 'CONFIRMATION_REQUISE',
        details: { detail: { code: 'CONFIRMATION_REQUISE', ...detail } },
    });

const apiError = (status: number, details?: unknown) =>
    new ApiError({ status, message: `HTTP ${status}`, details });

const deleted = (id = 'users'): DeleteTableResponse => ({
    id_table: id,
    numero_sequence: 5,
});

/** Scénario nominal : 409 au 1er appel, 200 au second. */
const mockNominal = () => {
    mocks.deleteTable
        .mockRejectedValueOnce(confirmationRequired())
        .mockResolvedValueOnce(deleted());
};

const accept = () => vi.fn().mockResolvedValue(true);
const refuse = () => vi.fn().mockResolvedValue(false);

const toastArg = () => mocks.toast.mock.calls[0][0];
const tableIds = (tables: DBTable[]) => tables.map((t) => t.id);

describe('deleteTableWithApi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isApiConfiguredMock.mockReturnValue(true);
        mocks.deleteTable.mockReset();
        mocks.postTable.mockReset();
    });

    describe('parcours nominal', () => {
        it('409 puis 200 : 2 appels (false puis true), table et relation retirées, ni toast ni undo', async () => {
            mockNominal();
            const confirm = accept();
            const { result } = setup();

            let outcome;
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'users',
                    confirm
                );
            });

            expect(outcome).toBe('deleted');
            expect(mocks.deleteTable).toHaveBeenCalledTimes(2);
            expect(mocks.deleteTable.mock.calls[0]).toEqual([
                DIAGRAM_ID,
                'users',
                { confirmation: false },
            ]);
            expect(mocks.deleteTable.mock.calls[1]).toEqual([
                DIAGRAM_ID,
                'users',
                { confirmation: true },
            ]);
            expect(tableIds(result.current.tables)).toEqual([
                'orders',
                'products',
            ]);
            expect(storage.deleteTable).toHaveBeenCalledWith({
                diagramId: DIAGRAM_ID,
                id: 'users',
            });
            expect(mocks.toast).not.toHaveBeenCalled();
            expect(addUndoAction).not.toHaveBeenCalled();
        });

        it('les relations liées sont retirées de l’état et du stockage', async () => {
            mockNominal();
            const { result } = setup();

            await act(async () => {
                await result.current.deleteTableWithApi('users', accept());
            });

            expect(result.current.relationships).toEqual([]);
            expect(storage.deleteRelationship).toHaveBeenCalledWith({
                diagramId: DIAGRAM_ID,
                id: 'rel1',
            });
        });

        it('la boîte reçoit la table et les liens du serveur', async () => {
            mockNominal();
            const confirm = accept();
            const { result } = setup();

            await act(async () => {
                await result.current.deleteTableWithApi('users', confirm);
            });

            expect(confirm).toHaveBeenCalledTimes(1);
            const [table, received] = confirm.mock.calls[0];
            expect(table.id).toBe('users');
            expect(received).toEqual(links);
        });

        it('la table reste tant que la confirmation est en attente', async () => {
            mockNominal();
            let answer!: (value: boolean) => void;
            const confirm = vi.fn(
                () =>
                    new Promise<boolean>((resolve) => {
                        answer = resolve;
                    })
            );
            const { result } = setup();

            let pending!: Promise<string>;
            act(() => {
                pending = result.current.deleteTableWithApi('users', confirm);
            });
            await vi.waitFor(() => expect(confirm).toHaveBeenCalled());

            expect(tableIds(result.current.tables)).toContain('users');
            expect(mocks.deleteTable).toHaveBeenCalledTimes(1);
            expect(storage.deleteTable).not.toHaveBeenCalled();

            await act(async () => {
                answer(true);
                await pending;
            });
            expect(tableIds(result.current.tables)).not.toContain('users');
        });

        it('table sans lien : la boîte s’ouvre quand même, avec des listes vides', async () => {
            mocks.deleteTable
                .mockRejectedValueOnce(
                    confirmationRequired({ cles_etrangeres: [], index: [] })
                )
                .mockResolvedValueOnce(deleted('products'));
            const confirm = accept();
            const { result } = setup();

            await act(async () => {
                await result.current.deleteTableWithApi('products', confirm);
            });

            expect(confirm).toHaveBeenCalledTimes(1);
            expect(confirm.mock.calls[0][1]).toEqual({
                cles_etrangeres: [],
                index: [],
            });
            expect(tableIds(result.current.tables)).not.toContain('products');
        });
    });

    describe('annulation', () => {
        it('un seul appel, rien ne change, aucun toast', async () => {
            mocks.deleteTable.mockRejectedValueOnce(confirmationRequired());
            const { result } = setup();

            let outcome;
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'users',
                    refuse()
                );
            });

            expect(outcome).toBe('cancelled');
            expect(mocks.deleteTable).toHaveBeenCalledTimes(1);
            expect(tableIds(result.current.tables)).toContain('users');
            expect(result.current.relationships).toHaveLength(1);
            expect(storage.deleteTable).not.toHaveBeenCalled();
            expect(mocks.toast).not.toHaveBeenCalled();
        });
    });

    describe('erreurs au 1er appel', () => {
        it.each([
            [401, 'api_errors.table_delete.unauthenticated'],
            [403, 'api_errors.table_delete.forbidden'],
            [404, 'api_errors.table_delete.not_found'],
            [0, 'api_errors.table_delete.network'],
            [500, 'api_errors.table_delete.unknown'],
        ])(
            '%i : pas de boîte, rien ne change, toast destructif',
            async (status, descriptionKey) => {
                mocks.deleteTable.mockRejectedValueOnce(apiError(status));
                const confirm = accept();
                const { result } = setup();

                let outcome;
                await act(async () => {
                    outcome = await result.current.deleteTableWithApi(
                        'users',
                        confirm
                    );
                });

                expect(outcome).toBe('error');
                expect(confirm).not.toHaveBeenCalled();
                expect(mocks.deleteTable).toHaveBeenCalledTimes(1);
                expect(tableIds(result.current.tables)).toContain('users');
                expect(storage.deleteTable).not.toHaveBeenCalled();
                expect(toastArg()).toMatchObject({
                    variant: 'destructive',
                    title: 'api_errors.table_delete.title',
                    description: descriptionKey,
                });
            }
        );

        it('422 : le toast affiche le message du serveur', async () => {
            mocks.deleteTable.mockRejectedValueOnce(
                apiError(422, {
                    detail: [
                        {
                            msg: 'String should have at most 25 characters',
                            loc: ['path', 'id_table'],
                        },
                    ],
                })
            );
            const confirm = accept();
            const { result } = setup();

            let outcome;
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'users',
                    confirm
                );
            });

            expect(outcome).toBe('error');
            expect(confirm).not.toHaveBeenCalled();
            expect(tableIds(result.current.tables)).toContain('users');
            expect(toastArg()).toMatchObject({
                variant: 'destructive',
                title: 'api_errors.table_delete.title',
                description:
                    'String should have at most 25 characters (path.id_table)',
            });
        });

        it('409 sans le code : erreur ordinaire, pas de boîte', async () => {
            mocks.deleteTable.mockRejectedValueOnce(
                // Listes valides mais pas de code : seule la condition sur
                // le code empêche d'ouvrir la boîte.
                new ApiError({
                    status: 409,
                    message: 'HTTP 409',
                    details: {
                        detail: {
                            cles_etrangeres: links.cles_etrangeres,
                            index: links.index,
                        },
                    },
                })
            );
            const confirm = accept();
            const { result } = setup();

            let outcome;
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'users',
                    confirm
                );
            });

            expect(outcome).toBe('error');
            expect(confirm).not.toHaveBeenCalled();
            expect(mocks.deleteTable).toHaveBeenCalledTimes(1);
            expect(tableIds(result.current.tables)).toContain('users');
            expect(toastArg()).toMatchObject({
                variant: 'destructive',
                description: 'api_errors.table_delete.unknown',
            });
        });

        it('409 CONFIRMATION_REQUISE sans liste exploitable : toast, error, pas de boîte, un seul appel', async () => {
            mocks.deleteTable.mockRejectedValueOnce(confirmationRequired({}));
            const confirm = accept();
            const { result } = setup();

            let outcome;
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'users',
                    confirm
                );
            });

            expect(outcome).toBe('error');
            expect(confirm).not.toHaveBeenCalled();
            expect(mocks.deleteTable).toHaveBeenCalledTimes(1);
            expect(tableIds(result.current.tables)).toContain('users');
            expect(result.current.relationships).toHaveLength(1);
            expect(storage.deleteTable).not.toHaveBeenCalled();
            expect(toastArg()).toMatchObject({
                variant: 'destructive',
                description: 'api_errors.table_delete.unknown',
            });
        });
    });

    describe('erreurs au 2e appel', () => {
        it.each([
            [500, 'api_errors.table_delete.unknown'],
            [404, 'api_errors.table_delete.not_found'],
        ])(
            '%i : la table reste, toast destructif, aucun retrait local',
            async (status, descriptionKey) => {
                mocks.deleteTable
                    .mockRejectedValueOnce(confirmationRequired())
                    .mockRejectedValueOnce(apiError(status));
                const { result } = setup();

                let outcome;
                await act(async () => {
                    outcome = await result.current.deleteTableWithApi(
                        'users',
                        accept()
                    );
                });

                expect(outcome).toBe('error');
                expect(mocks.deleteTable).toHaveBeenCalledTimes(2);
                expect(tableIds(result.current.tables)).toContain('users');
                expect(result.current.relationships).toHaveLength(1);
                expect(storage.deleteTable).not.toHaveBeenCalled();
                expect(storage.deleteRelationship).not.toHaveBeenCalled();
                expect(toastArg()).toMatchObject({
                    variant: 'destructive',
                    description: descriptionKey,
                });
            }
        );
    });

    describe('garde-fou 2xx au 1er appel', () => {
        it('retire la table sans 2e appel ni boîte', async () => {
            mocks.deleteTable.mockResolvedValueOnce(deleted());
            const confirm = accept();
            const { result } = setup();

            let outcome;
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'users',
                    confirm
                );
            });

            expect(outcome).toBe('deleted');
            expect(mocks.deleteTable).toHaveBeenCalledTimes(1);
            expect(confirm).not.toHaveBeenCalled();
            expect(tableIds(result.current.tables)).not.toContain('users');
            expect(addUndoAction).not.toHaveBeenCalled();
        });
    });

    describe('table inconnue et verrou', () => {
        it('table inconnue : cancelled, aucun appel', async () => {
            const confirm = accept();
            const { result } = setup();

            let outcome;
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'inconnue',
                    confirm
                );
            });

            expect(outcome).toBe('cancelled');
            expect(mocks.deleteTable).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
            expect(mocks.toast).not.toHaveBeenCalled();
        });

        it('double-clic : un seul parcours, le second appel est annulé sans requête', async () => {
            mocks.deleteTable.mockRejectedValueOnce(confirmationRequired());
            let answer!: (value: boolean) => void;
            const confirm = vi.fn(
                () =>
                    new Promise<boolean>((resolve) => {
                        answer = resolve;
                    })
            );
            const { result } = setup();

            let first!: Promise<string>;
            let second!: Promise<string>;
            act(() => {
                first = result.current.deleteTableWithApi('users', confirm);
                second = result.current.deleteTableWithApi('users', confirm);
            });

            await expect(second).resolves.toBe('cancelled');
            expect(mocks.deleteTable).toHaveBeenCalledTimes(1);

            await act(async () => {
                answer(false);
                await first;
            });
            expect(confirm).toHaveBeenCalledTimes(1);
        });

        it('verrou libéré après une annulation puis après une erreur', async () => {
            const { result } = setup();

            mocks.deleteTable.mockRejectedValueOnce(confirmationRequired());
            await act(async () => {
                await result.current.deleteTableWithApi('users', refuse());
            });

            mocks.deleteTable.mockRejectedValueOnce(apiError(500));
            let outcome;
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'users',
                    accept()
                );
            });
            expect(outcome).toBe('error');

            // Après l'erreur, un nouveau parcours complet passe.
            mockNominal();
            await act(async () => {
                outcome = await result.current.deleteTableWithApi(
                    'users',
                    accept()
                );
            });
            expect(outcome).toBe('deleted');
            expect(mocks.deleteTable).toHaveBeenCalledTimes(4);
        });
    });

    describe('RG-10', () => {
        it('une table supprimée libère son nom : createTable({ name }) le reprend', async () => {
            mockNominal();
            mocks.postTable.mockImplementation(
                async (_diagramId: string, table: DBTable) => ({
                    table,
                    numero_sequence: 6,
                    avertissement: null,
                })
            );
            const { result } = setup();

            await act(async () => {
                await result.current.deleteTableWithApi('users', accept());
            });

            let table: DBTable | null = null;
            await act(async () => {
                table = await result.current.createTable({
                    name: 'users',
                    schema: 'public',
                });
            });

            expect(table!.name).toBe('users');
            expect(mocks.postTable.mock.calls[0][1].name).toBe('users');
        });
    });
});
