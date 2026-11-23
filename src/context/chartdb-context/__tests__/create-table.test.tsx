import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DBTable } from '@/lib/domain/db-table';
import type { Diagram } from '@/lib/domain/diagram';
import { DatabaseType } from '@/lib/domain/database-type';
import type * as HttpClient from '@/lib/api/http-client';
import type * as TablesApi from '@/lib/api/tables-api';
import type { PostTableResponse } from '@/lib/api/tables-api';

const mocks = vi.hoisted(() => ({
    apiConfigured: true,
    postTable: vi.fn(),
    toast: vi.fn(),
    t: (key: string) => key,
}));

vi.mock('@/lib/api/http-client', async (importOriginal) => ({
    ...(await importOriginal<typeof HttpClient>()),
    isApiConfigured: () => mocks.apiConfigured,
}));
vi.mock('@/lib/api/tables-api', async (importOriginal) => ({
    ...(await importOriginal<typeof TablesApi>()),
    postTable: mocks.postTable,
}));
vi.mock('@/components/toast/use-toast', () => ({ toast: mocks.toast }));
// i18next n'est pas initialisé dans les tests : `t` renvoie la clé.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: mocks.t }),
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

const DIAGRAM_ID = 'diagram-1';

const makeTable = (overrides: Partial<DBTable> = {}): DBTable => ({
    id: 'existing',
    name: 'existing',
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

/** « Cache » : tables enregistrées dans le stockage local (IndexedDB). */
let cache: DBTable[] = [];
const addUndoAction = vi.fn();

const storage: StorageContext = {
    ...storageInitialValue,
    updateDiagram: vi.fn().mockResolvedValue(undefined),
    addTable: vi.fn(async ({ table }: { table: DBTable }) => {
        cache.push(table);
    }),
};

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

const setup = (tables: DBTable[] = []) => {
    const hook = renderHook(() => useChartDB(), { wrapper: Wrapper });
    const diagram: Diagram = {
        id: DIAGRAM_ID,
        name: 'Test',
        databaseType: DatabaseType.GENERIC,
        tables,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    act(() => hook.result.current.loadDiagramFromData(diagram));
    return hook;
};

/** Simule le 201 du back : { table, numero_sequence, avertissement }. */
const created = (avertissement: PostTableResponse['avertissement'] = null) =>
    vi.fn(
        async (
            _diagramId: string,
            table: DBTable
        ): Promise<PostTableResponse> => ({
            table,
            numero_sequence: 1,
            avertissement,
        })
    );

const apiError = (status: number, details?: unknown) =>
    new ApiError({ status, message: `HTTP ${status}`, details });

const toastArg = () => mocks.toast.mock.calls[0][0];

describe('createTable', () => {
    beforeEach(() => {
        mocks.apiConfigured = true;
        mocks.postTable.mockReset();
        mocks.toast.mockClear();
        addUndoAction.mockClear();
        cache = [];
        vi.mocked(storage.addTable).mockClear();
    });

    describe('mode API', () => {
        it('201 : un seul POST, id de 25 caractères, table dans l’état et le cache, ni undo ni toast', async () => {
            mocks.postTable.mockImplementation(created());
            const { result } = setup();

            let table: DBTable | null = null;
            await act(async () => {
                table = await result.current.createTable({ x: 10, y: 20 });
            });

            expect(mocks.postTable).toHaveBeenCalledTimes(1);
            const [diagramId, sent] = mocks.postTable.mock.calls[0];
            expect(diagramId).toBe(DIAGRAM_ID);
            expect(sent.id).toHaveLength(25);
            expect(table).not.toBeNull();
            expect(table!.id).toBe(sent.id);
            expect(result.current.tables.map((t) => t.id)).toEqual([sent.id]);
            expect(cache.map((t) => t.id)).toEqual([sent.id]);
            expect(addUndoAction).not.toHaveBeenCalled();
            expect(mocks.toast).not.toHaveBeenCalled();
        });

        it('201 avec avertissement : toast non destructif avec avertissement.message', async () => {
            mocks.postTable.mockImplementation(
                created({
                    code: 'TABLE_SANS_CLE_PRIMAIRE',
                    message: 'La table n’a pas de clé primaire',
                })
            );
            const { result } = setup();

            await act(async () => {
                await result.current.createTable();
            });

            expect(mocks.toast).toHaveBeenCalledTimes(1);
            expect(toastArg()).toMatchObject({
                title: 'api_errors.table.warnings_title',
                description: 'La table n’a pas de clé primaire',
            });
            expect(toastArg().variant).not.toBe('destructive');
            expect(result.current.tables).toHaveLength(1);
        });

        it('422 avec detail texte : null, rien dans l’état ni le cache, toast destructif avec le message du serveur', async () => {
            mocks.postTable.mockRejectedValue(
                apiError(422, { detail: 'Nom déjà pris dans ce schéma' })
            );
            const { result } = setup();

            let table: DBTable | null = makeTable();
            await act(async () => {
                table = await result.current.createTable();
            });

            expect(table).toBeNull();
            expect(result.current.tables).toEqual([]);
            expect(cache).toEqual([]);
            expect(storage.addTable).not.toHaveBeenCalled();
            expect(toastArg()).toMatchObject({
                variant: 'destructive',
                title: 'api_errors.table.title',
                description: 'Nom déjà pris dans ce schéma',
            });
        });

        it('403 : toast avec le texte générique de la clé', async () => {
            mocks.postTable.mockRejectedValue(
                apiError(403, { detail: 'Un motif serveur ignoré' })
            );
            const { result } = setup();

            let table: DBTable | null = makeTable();
            await act(async () => {
                table = await result.current.createTable();
            });

            expect(table).toBeNull();
            expect(toastArg()).toMatchObject({
                variant: 'destructive',
                description: 'api_errors.table.forbidden',
            });
            expect(result.current.tables).toEqual([]);
        });

        it('erreur réseau : rien n’est ajouté', async () => {
            mocks.postTable.mockRejectedValue(apiError(0));
            const { result } = setup();

            let table: DBTable | null = makeTable();
            await act(async () => {
                table = await result.current.createTable();
            });

            expect(table).toBeNull();
            expect(result.current.tables).toEqual([]);
            expect(cache).toEqual([]);
            expect(addUndoAction).not.toHaveBeenCalled();
            expect(toastArg()).toMatchObject({
                variant: 'destructive',
                description: 'api_errors.table.network',
            });
        });

        it('double-clic : un seul POST, le second appel renvoie null, puis un nouvel ajout est possible', async () => {
            let release!: () => void;
            mocks.postTable.mockImplementationOnce(
                (_diagramId: string, table: DBTable) =>
                    new Promise<PostTableResponse>((resolve) => {
                        release = () =>
                            resolve({
                                table,
                                numero_sequence: 1,
                                avertissement: null,
                            });
                    })
            );
            const { result } = setup();

            let first!: Promise<DBTable | null>;
            let second!: Promise<DBTable | null>;
            act(() => {
                first = result.current.createTable();
                second = result.current.createTable();
            });

            await expect(second).resolves.toBeNull();
            expect(mocks.postTable).toHaveBeenCalledTimes(1);

            await act(async () => {
                release();
                await first;
            });
            await expect(first).resolves.not.toBeNull();
            expect(result.current.tables).toHaveLength(1);

            // Le verrou est libéré : un nouvel ajout passe.
            mocks.postTable.mockImplementation(created());
            await act(async () => {
                await result.current.createTable();
            });
            expect(mocks.postTable).toHaveBeenCalledTimes(2);
            expect(result.current.tables).toHaveLength(2);
        });

        it('le verrou est libéré après une erreur', async () => {
            mocks.postTable.mockRejectedValueOnce(apiError(500));
            const { result } = setup();

            await act(async () => {
                await result.current.createTable();
            });
            expect(result.current.tables).toEqual([]);

            mocks.postTable.mockImplementation(created());
            let table: DBTable | null = null;
            await act(async () => {
                table = await result.current.createTable();
            });

            expect(table).not.toBeNull();
            expect(mocks.postTable).toHaveBeenCalledTimes(2);
            expect(result.current.tables).toHaveLength(1);
        });

        it('nom par défaut : avec table_2 existante, la nouvelle s’appelle table_3', async () => {
            mocks.postTable.mockImplementation(created());
            const { result } = setup([
                makeTable({ id: 't2', name: 'table_2' }),
            ]);

            let table: DBTable | null = null;
            await act(async () => {
                table = await result.current.createTable();
            });

            expect(table!.name).toBe('table_3');
            expect(mocks.postTable.mock.calls[0][1].name).toBe('table_3');
        });

        it('duplication : x_copy existe déjà, le résultat est x_copy_2', async () => {
            mocks.postTable.mockImplementation(created());
            const { result } = setup([
                makeTable({ id: 'tc', name: 'x_copy', schema: 'public' }),
            ]);

            let table: DBTable | null = null;
            await act(async () => {
                table = await result.current.createTable({
                    name: 'x_copy',
                    schema: 'public',
                });
            });

            expect(table!.name).toBe('x_copy_2');
            expect(mocks.postTable.mock.calls[0][1].name).toBe('x_copy_2');
        });
    });

    describe('mode local (sans VITE_API_URL)', () => {
        it('aucun POST, table ajoutée, undo conservé', async () => {
            mocks.apiConfigured = false;
            const { result } = setup();

            let table: DBTable | null = null;
            await act(async () => {
                table = await result.current.createTable();
            });

            expect(mocks.postTable).not.toHaveBeenCalled();
            expect(table).not.toBeNull();
            expect(result.current.tables.map((t) => t.id)).toEqual([table!.id]);
            expect(cache.map((t) => t.id)).toEqual([table!.id]);
            expect(addUndoAction).toHaveBeenCalledTimes(1);
            expect(addUndoAction.mock.calls[0][0].action).toBe('addTables');
            expect(mocks.toast).not.toHaveBeenCalled();
        });
    });
});
