import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
    API_URL: '',
    USER_ID: '',
}));

vi.mock('@/lib/env', () => mockEnv);

import type { DBTable } from '@/lib/domain/db-table';
import type { DBIndex } from '@/lib/domain/db-index';
import { ApiError } from '../http-client';
import {
    deleteTable,
    describeTableApiError,
    getTableApiErrorKind,
    getTableLinksFromConfirmation,
    isConfirmationRequired,
    postTable,
    toTableBody,
} from '../tables-api';

const makeIndex = (overrides: Partial<DBIndex> = {}): DBIndex => ({
    id: 'idx1',
    name: '',
    unique: false,
    fieldIds: ['f1'],
    createdAt: 1,
    ...overrides,
});

const makeTable = (overrides: Partial<DBTable> = {}): DBTable => ({
    id: 't1',
    name: 'users',
    schema: 'public',
    x: 10,
    y: 20,
    width: 224,
    color: '#8eb7ff',
    comments: null,
    isView: false,
    createdAt: 1,
    fields: [
        {
            id: 'f1',
            name: 'id',
            type: { id: 'integer', name: 'integer' },
            primaryKey: true,
            unique: true,
            nullable: false,
            createdAt: 1,
        },
        {
            id: 'f2',
            name: 'email',
            type: { id: 'varchar', name: 'varchar' },
            primaryKey: false,
            unique: false,
            nullable: true,
            characterMaximumLength: '255',
            createdAt: 1,
        },
    ],
    indexes: [
        makeIndex({
            id: 'pk',
            name: '',
            fieldIds: ['f1'],
            unique: true,
            isPrimaryKey: true,
        }),
    ],
    ...overrides,
});

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

const rejection = (promise: Promise<unknown>): Promise<ApiError> =>
    promise.then(
        () => {
            throw new Error('La promesse aurait dû être rejetée');
        },
        (e: unknown) => e as ApiError
    );

describe('toTableBody', () => {
    it('garde le DBTable en camelCase avec ses ids', () => {
        const body = toTableBody(makeTable());

        expect(body).toMatchObject({
            id: 't1',
            name: 'users',
            schema: 'public',
            x: 10,
            y: 20,
            width: 224,
            color: '#8eb7ff',
            isView: false,
        });
        expect(body.fields.map((f) => f.id)).toEqual(['f1', 'f2']);
        expect(body.fields[0].primaryKey).toBe(true);
        expect(body.fields[1].characterMaximumLength).toBe('255');
        expect(body.indexes[0].id).toBe('pk');
        expect(body.indexes[0].fieldIds).toEqual(['f1']);
        expect(body.indexes[0].isPrimaryKey).toBe(true);
    });

    it.each([
        ['vide', ''],
        ['null', null],
        ['absent', undefined],
    ])('retire un schéma %s (la clé disparaît)', (_label, schema) => {
        const table = makeTable({ schema });
        if (schema === undefined) {
            delete table.schema;
        }
        const body = toTableBody(table);
        expect('schema' in body).toBe(false);
    });

    it('conserve un schéma renseigné', () => {
        expect(toTableBody(makeTable({ schema: 'sales' })).schema).toBe(
            'sales'
        );
    });

    it('nomme l’index de clé primaire sans nom <table>_pkey', () => {
        const body = toTableBody(makeTable());
        expect(body.indexes[0].name).toBe('users_pkey');
    });

    it('nomme les autres index sans nom idx_<table>_<n>, par rang', () => {
        const table = makeTable({
            indexes: [
                makeIndex({ id: 'pk', isPrimaryKey: true, unique: true }),
                makeIndex({ id: 'i1', name: '' }),
                makeIndex({ id: 'i2', name: 'mon_index' }),
                makeIndex({ id: 'i3', name: '   ' }),
            ],
        });
        const names = toTableBody(table).indexes.map((i) => i.name);
        expect(names).toEqual([
            'users_pkey',
            'idx_users_1',
            'mon_index',
            'idx_users_2',
        ]);
    });

    it('laisse intact un index déjà nommé, même primaire', () => {
        const named = makeIndex({
            id: 'pk',
            name: 'pk_custom',
            isPrimaryKey: true,
            unique: true,
        });
        const body = toTableBody(makeTable({ indexes: [named] }));
        expect(body.indexes[0]).toEqual(named);
    });

    it('limite les noms d’index générés à 63 caractères', () => {
        const longName = 'a'.repeat(63);
        const table = makeTable({
            name: longName,
            indexes: [
                makeIndex({ id: 'pk', isPrimaryKey: true, unique: true }),
                makeIndex({ id: 'i1' }),
            ],
        });
        const [pk, other] = toTableBody(table).indexes;
        expect(pk.name).toHaveLength(63);
        expect(pk.name.endsWith('_pkey')).toBe(true);
        expect(other.name).toHaveLength(63);
        expect(other.name.startsWith('idx_')).toBe(true);
        expect(other.name.endsWith('_1')).toBe(true);
    });

    it('ne modifie pas la table passée (l’index PK garde son nom vide)', () => {
        const table = makeTable({ schema: '' });
        const snapshot = structuredClone(table);

        const body = toTableBody(table);

        expect(table).toEqual(snapshot);
        expect(table.indexes[0].name).toBe('');
        expect('schema' in table).toBe(true);
        expect(body.indexes[0]).not.toBe(table.indexes[0]);
        expect(body.indexes).not.toBe(table.indexes);
    });
});

describe('postTable', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        mockEnv.API_URL = 'http://api.test';
        mockEnv.USER_ID = 'user-1';
        localStorage.clear();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('envoie un POST sur /api/projets/{id}/tables avec X-User-Id et le corps', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(
                { table: makeTable(), numero_sequence: 1, avertissement: null },
                201
            )
        );
        const table = makeTable({ schema: '' });

        await postTable('diag-1', table);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://api.test/api/projets/diag-1/tables');
        expect(init.method).toBe('POST');
        expect(init.headers['X-User-Id']).toBe('user-1');
        expect(init.headers['Content-Type']).toBe('application/json');
        const sent = JSON.parse(init.body);
        expect(sent.id).toBe('t1');
        expect('schema' in sent).toBe(false);
        expect(sent.indexes[0].name).toBe('users_pkey');
    });

    it('renvoie { table, numero_sequence, avertissement } avec un avertissement', async () => {
        const avertissement = {
            code: 'TABLE_SANS_CLE_PRIMAIRE',
            message: 'La table n’a pas de clé primaire',
        };
        const saved = makeTable();
        fetchMock.mockResolvedValue(
            jsonResponse(
                { table: saved, numero_sequence: 7, avertissement },
                201
            )
        );

        const result = await postTable('diag-1', makeTable());

        expect(result).toEqual({
            table: saved,
            numero_sequence: 7,
            avertissement,
        });
    });

    it('renvoie avertissement null quand il n’y a rien à signaler', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(
                { table: makeTable(), numero_sequence: 2, avertissement: null },
                201
            )
        );

        const result = await postTable('diag-1', makeTable());

        expect(result.avertissement).toBeNull();
        expect(result.numero_sequence).toBe(2);
    });

    it('rejette avec une ApiError portant le statut HTTP', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: 'Interdit' }, 403));
        const error = await rejection(postTable('diag-1', makeTable()));
        expect(error).toBeInstanceOf(ApiError);
        expect(error.status).toBe(403);
    });
});

describe('getTableApiErrorKind', () => {
    const apiError = (status: number, details?: unknown) =>
        new ApiError({ status, message: `HTTP ${status}`, details });

    it.each([
        [0, 'network'],
        [401, 'unauthenticated'],
        [403, 'forbidden'],
        [404, 'not_found'],
        [422, 'validation'],
        [500, 'unknown'],
        [409, 'unknown'],
    ])('statut %i → %s', (status, kind) => {
        expect(getTableApiErrorKind(apiError(status))).toBe(kind);
    });

    it('ignore un éventuel code dans le corps de la réponse', () => {
        const withCode = new ApiError({
            status: 404,
            code: 'TABLE_SANS_CLE_PRIMAIRE',
            message: 'x',
            details: { code: '403', message: 'x' },
        });
        expect(getTableApiErrorKind(withCode)).toBe('not_found');

        const forbiddenCode = new ApiError({
            status: 500,
            code: 'FORBIDDEN',
            message: 'x',
        });
        expect(getTableApiErrorKind(forbiddenCode)).toBe('unknown');
    });

    it('renvoie unknown pour une erreur qui n’est pas une ApiError', () => {
        expect(getTableApiErrorKind(new Error('boom'))).toBe('unknown');
        expect(getTableApiErrorKind(undefined)).toBe('unknown');
    });

    it('classe un vrai échec réseau (status 0) via apiRequest', async () => {
        mockEnv.API_URL = 'http://api.test';
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
        vi.stubGlobal('fetch', fetchMock);
        try {
            const error = await rejection(postTable('d', makeTable()));
            expect(getTableApiErrorKind(error)).toBe('network');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('describeTableApiError', () => {
    it('donne les clés i18n du cas', () => {
        const description = describeTableApiError(
            new ApiError({ status: 403, message: 'x' })
        );
        expect(description).toEqual({
            kind: 'forbidden',
            titleKey: 'api_errors.table.title',
            descriptionKey: 'api_errors.table.forbidden',
            serverMessage: undefined,
        });
    });

    it('renseigne serverMessage pour un 422 avec detail texte', () => {
        const description = describeTableApiError(
            new ApiError({
                status: 422,
                message: 'x',
                details: { detail: 'Nom déjà pris dans ce schéma' },
            })
        );
        expect(description.kind).toBe('validation');
        expect(description.descriptionKey).toBe('api_errors.table.validation');
        expect(description.serverMessage).toBe('Nom déjà pris dans ce schéma');
    });

    it('renseigne serverMessage pour un 422 avec tableau pydantic', () => {
        const description = describeTableApiError(
            new ApiError({
                status: 422,
                message: 'x',
                details: {
                    detail: [
                        {
                            msg: 'String should have at least 1 character',
                            loc: ['body', 'indexes', 0, 'name'],
                        },
                    ],
                },
            })
        );
        expect(description.serverMessage).toBe(
            'String should have at least 1 character (indexes.0.name)'
        );
    });

    it('laisse serverMessage undefined pour un 422 sans detail exploitable', () => {
        const description = describeTableApiError(
            new ApiError({ status: 422, message: 'x' })
        );
        expect(description.kind).toBe('validation');
        expect(description.serverMessage).toBeUndefined();
    });

    it.each([0, 401, 403, 404, 500])(
        'ne renseigne aucun serverMessage pour le statut %i, même avec un detail',
        (status) => {
            const description = describeTableApiError(
                new ApiError({
                    status,
                    message: 'x',
                    details: { detail: 'Un motif serveur' },
                })
            );
            expect(description.serverMessage).toBeUndefined();
        }
    );

    it('traite une erreur inconnue comme unknown sans serverMessage', () => {
        const description = describeTableApiError(new Error('boom'));
        expect(description.kind).toBe('unknown');
        expect(description.descriptionKey).toBe('api_errors.table.unknown');
        expect(description.serverMessage).toBeUndefined();
    });
});

const TABLE_ID = 'cm1abcdefghijklmnopqrstuv';

const fk = {
    id: 'r1',
    name: 'fk_orders_users',
    sourceTableId: 'orders',
    targetTableId: 'users',
    sourceFieldId: 'f1',
    targetFieldId: 'f2',
};

const confirmationBody = (detail: Record<string, unknown> = {}) => ({
    detail: { code: 'CONFIRMATION_REQUISE', ...detail },
});

const confirmationError = (details: unknown) =>
    new ApiError({
        status: 409,
        code: 'CONFIRMATION_REQUISE',
        message: 'x',
        details,
    });

describe('deleteTable', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        mockEnv.API_URL = 'http://api.test/';
        mockEnv.USER_ID = '42';
        localStorage.clear();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('1er appel : DELETE confirme_suppression=false, sans corps, X-User-Id ; le vrai 409 est reconnu', async () => {
        const body = confirmationBody({
            cles_etrangeres: [fk],
            index: [{ id: 'i1', name: 'idx_orders' }],
        });
        fetchMock.mockResolvedValue(jsonResponse(body, 409));

        const error = await rejection(
            deleteTable('proj 1', TABLE_ID, { confirmation: false })
        );

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(
            `http://api.test/api/projets/proj%201/tables/${TABLE_ID}?confirme_suppression=false`
        );
        expect(init.method).toBe('DELETE');
        expect(init.body).toBeUndefined();
        expect(init.headers['X-User-Id']).toBe('42');
        // L'erreur vient de apiRequest : ApiError.code est lu depuis detail.code.
        expect(error.status).toBe(409);
        expect(error.code).toBe('CONFIRMATION_REQUISE');
        expect(isConfirmationRequired(error)).toBe(true);
        expect(getTableLinksFromConfirmation(error)).toEqual({
            cles_etrangeres: [fk],
            index: [{ id: 'i1', name: 'idx_orders' }],
        });
    });

    it('2e appel : confirme_suppression=true, renvoie { id_table, numero_sequence } tel quel', async () => {
        const response = { id_table: TABLE_ID, numero_sequence: 12 };
        fetchMock.mockResolvedValue(jsonResponse(response));

        const result = await deleteTable('proj 1', TABLE_ID, {
            confirmation: true,
        });

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(
            `http://api.test/api/projets/proj%201/tables/${TABLE_ID}?confirme_suppression=true`
        );
        expect(init.method).toBe('DELETE');
        expect(init.body).toBeUndefined();
        expect(result).toEqual(response);
    });

    it('un 409 sans code n’est pas une demande de confirmation', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: 'Conflit' }, 409));
        const error = await rejection(
            deleteTable('p', TABLE_ID, { confirmation: false })
        );
        expect(isConfirmationRequired(error)).toBe(false);
    });
});

describe('isConfirmationRequired', () => {
    it('409 avec le code → vrai', () => {
        expect(isConfirmationRequired(confirmationError({}))).toBe(true);
    });

    it.each([
        ['409 sans code', new ApiError({ status: 409, message: 'x' })],
        [
            '422 avec ce code',
            new ApiError({
                status: 422,
                code: 'CONFIRMATION_REQUISE',
                message: 'x',
            }),
        ],
        ['Error ordinaire', new Error('boom')],
    ])('%s → faux', (_label, error) => {
        expect(isConfirmationRequired(error)).toBe(false);
    });
});

describe('getTableLinksFromConfirmation', () => {
    it('format réel : renvoie les liens exacts', () => {
        const index = [{ id: 'i1', name: 'idx_orders' }];
        expect(
            getTableLinksFromConfirmation(
                confirmationError(
                    confirmationBody({ cles_etrangeres: [fk], index })
                )
            )
        ).toEqual({ cles_etrangeres: [fk], index });
    });

    it('deux listes vides → liens vides, pas null', () => {
        expect(
            getTableLinksFromConfirmation(
                confirmationError(
                    confirmationBody({ cles_etrangeres: [], index: [] })
                )
            )
        ).toEqual({ cles_etrangeres: [], index: [] });
    });

    it('un seul tableau présent : l’autre est complété par []', () => {
        expect(
            getTableLinksFromConfirmation(
                confirmationError(confirmationBody({ cles_etrangeres: [fk] }))
            )
        ).toEqual({ cles_etrangeres: [fk], index: [] });
        expect(
            getTableLinksFromConfirmation(
                confirmationError(
                    confirmationBody({ index: [{ id: 'i', name: 'n' }] })
                )
            )
        ).toEqual({ cles_etrangeres: [], index: [{ id: 'i', name: 'n' }] });
    });

    it('ne garde que les objets des tableaux', () => {
        expect(
            getTableLinksFromConfirmation(
                confirmationError(
                    confirmationBody({
                        cles_etrangeres: [fk, 'x', null, 3],
                        index: [],
                    })
                )
            )
        ).toEqual({ cles_etrangeres: [fk], index: [] });
    });

    it('aucun tableau → null', () => {
        expect(
            getTableLinksFromConfirmation(confirmationError(confirmationBody()))
        ).toBeNull();
    });

    it('403 → null, même avec des listes', () => {
        expect(
            getTableLinksFromConfirmation(
                new ApiError({
                    status: 403,
                    message: 'x',
                    details: confirmationBody({ cles_etrangeres: [fk] }),
                })
            )
        ).toBeNull();
    });

    it('details ou detail qui ne sont pas des objets → null', () => {
        expect(
            getTableLinksFromConfirmation(confirmationError('texte'))
        ).toBeNull();
        expect(
            getTableLinksFromConfirmation(confirmationError({ detail: 'x' }))
        ).toBeNull();
    });

    it.each([
        ['{ liens }', { liens: [fk] }],
        ['{ detail: { liens } }', { detail: { liens: [fk] } }],
        ['tableau à la racine', [fk]],
        ['listes à la racine', { cles_etrangeres: [fk], index: [] }],
    ])('refuse le format %s', (_label, details) => {
        expect(
            getTableLinksFromConfirmation(confirmationError(details))
        ).toBeNull();
    });
});

describe('describeTableApiError (opération delete)', () => {
    it.each([
        [0, 'network'],
        [401, 'unauthenticated'],
        [403, 'forbidden'],
        [404, 'not_found'],
        [422, 'validation'],
        [500, 'unknown'],
    ])('statut %i → %s', (status, kind) => {
        const description = describeTableApiError(
            new ApiError({ status, message: 'x' }),
            'delete'
        );
        expect(description.kind).toBe(kind);
        expect(description.titleKey).toBe('api_errors.table_delete.title');
        expect(description.descriptionKey).toBe(
            `api_errors.table_delete.${kind}`
        );
    });

    it('422 : serverMessage reprend le texte du serveur', () => {
        const description = describeTableApiError(
            new ApiError({
                status: 422,
                message: 'x',
                details: {
                    detail: [
                        {
                            msg: 'String should have at most 25 characters',
                            loc: ['path', 'id_table'],
                        },
                    ],
                },
            }),
            'delete'
        );
        expect(description.kind).toBe('validation');
        expect(description.serverMessage).toBe(
            'String should have at most 25 characters (path.id_table)'
        );
    });

    it('403 : pas de serverMessage', () => {
        const description = describeTableApiError(
            new ApiError({
                status: 403,
                message: 'x',
                details: { detail: 'Seul un concepteur du projet…' },
            }),
            'delete'
        );
        expect(description.serverMessage).toBeUndefined();
    });
});
