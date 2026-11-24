import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
    API_URL: 'http://api.test/',
    USER_ID: '42',
}));

vi.mock('@/lib/env', () => env);

import type { Diagram } from '@/lib/domain/diagram';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBIndex } from '@/lib/domain/db-index';
import { DatabaseType } from '@/lib/domain/database-type';
import { ApiError } from '../http-client';
import {
    databaseTypeToDialecte,
    describeImportApiError,
    getExistingTablesCount,
    getImportApiErrorKind,
    isImportConfirmationRequired,
    normalizeImportTables,
    postImport,
    toImportDiagram,
    type ImportDumpRequest,
} from '../import-api';

const ID_25 = 'abcdefghij0123456789klmno';

const makeIndex = (overrides: Partial<DBIndex> = {}): DBIndex => ({
    id: 'idx1',
    name: '',
    unique: false,
    fieldIds: ['f1'],
    createdAt: 1,
    ...overrides,
});

const makeTable = (overrides: Partial<DBTable> = {}): DBTable => ({
    id: ID_25,
    name: 'users',
    schema: 'public',
    x: 0,
    y: 0,
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
    ],
    indexes: [
        makeIndex({ id: 'pk', isPrimaryKey: true, unique: true }),
        makeIndex({ id: 'i2', name: 'idx_users_email' }),
    ],
    ...overrides,
});

const makeDiagram = (overrides: Partial<Diagram> = {}): Diagram => ({
    id: 'diagram-courant',
    name: 'Mon projet',
    databaseType: DatabaseType.GENERIC,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
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

const makeRequest = (): ImportDumpRequest => ({
    confirme_remplacement: false,
    fichier: { nom: 'dump.sql', dialecte: 'postgresql', taille_octets: 12 },
    diagramme: toImportDiagram(makeDiagram(), makeDiagram(), 'postgresql'),
    rapport: {
        non_repris: [
            { ligne: 3, type: 'INSERT', raison: 'Données non reprises' },
        ],
    },
});

describe('normalizeImportTables', () => {
    it("retire la clé schema quand elle vaut ''", () => {
        const [out] = normalizeImportTables([makeTable({ schema: '' })]);
        expect('schema' in out).toBe(false);
    });

    it('garde un schéma renseigné', () => {
        const [out] = normalizeImportTables([makeTable({ schema: 'public' })]);
        expect(out.schema).toBe('public');
    });

    it('nomme <table>_pkey un index PK sans nom', () => {
        const [out] = normalizeImportTables([makeTable()]);
        expect(out.indexes[0].name).toBe('users_pkey');
        expect(out.indexes[0].isPrimaryKey).toBe(true);
    });

    it('garde tel quel un index PK déjà nommé', () => {
        const [out] = normalizeImportTables([
            makeTable({
                indexes: [
                    makeIndex({ isPrimaryKey: true, name: 'pk_utilisateurs' }),
                ],
            }),
        ]);
        expect(out.indexes[0].name).toBe('pk_utilisateurs');
    });

    it('ne touche pas un index ordinaire, même sans nom', () => {
        const ordinary = makeIndex({ id: 'i3', name: '' });
        const [out] = normalizeImportTables([
            makeTable({ indexes: [ordinary] }),
        ]);
        expect(out.indexes[0]).toEqual(ordinary);
    });

    it('coupe le nom à 63 caractères en finissant par _pkey', () => {
        const [out] = normalizeImportTables([
            makeTable({ name: 'a'.repeat(80) }),
        ]);
        const { name } = out.indexes[0];
        expect(name).toHaveLength(63);
        expect(name).toBe(`${'a'.repeat(58)}_pkey`);
    });

    it("ne retire jamais l'index PK et ne change aucun id", () => {
        const table = makeTable();
        const [out] = normalizeImportTables([table]);
        expect(out.indexes).toHaveLength(table.indexes.length);
        expect(out.indexes.map((i) => i.id)).toEqual(['pk', 'i2']);
        expect(out.id).toBe(ID_25);
        expect(out.fields.map((f) => f.id)).toEqual(['f1']);
    });

    it('est idempotente', () => {
        const once = normalizeImportTables([makeTable({ schema: '' })]);
        expect(normalizeImportTables(once)).toEqual(once);
    });

    it('ne modifie pas son argument', () => {
        const table = makeTable({ schema: '' });
        const copy = structuredClone(table);
        normalizeImportTables([table]);
        expect(table).toEqual(copy);
    });
});

describe('toImportDiagram', () => {
    it("garde l'id du diagramme courant, le nom, le dialecte et l'id ChartDB de 25 caractères", () => {
        const parsed = makeDiagram({
            id: 'genere-par-le-parser',
            name: 'autre',
            tables: [makeTable({ schema: '' })],
        });
        const out = toImportDiagram(makeDiagram(), parsed, 'mysql');

        expect(out.id).toBe('diagram-courant');
        expect(out.name).toBe('Mon projet');
        expect(out.databaseType).toBe(DatabaseType.MYSQL);
        expect(out.tables[0].id).toBe(ID_25);
        expect(out.tables[0].id).toHaveLength(25);
        expect('schema' in out.tables[0]).toBe(false);
        expect(out.tables[0].indexes[0].name).toBe('users_pkey');
    });

    it('ne contient pas createdAt ni updatedAt', () => {
        const out = toImportDiagram(makeDiagram(), makeDiagram(), 'postgresql');
        expect(out.databaseType).toBe(DatabaseType.POSTGRESQL);
        expect('createdAt' in out).toBe(false);
        expect('updatedAt' in out).toBe(false);
    });

    it('remplace les 6 listes absentes par []', () => {
        const out = toImportDiagram(makeDiagram(), makeDiagram(), 'mysql');
        expect(out.tables).toEqual([]);
        expect(out.relationships).toEqual([]);
        expect(out.areas).toEqual([]);
        expect(out.notes).toEqual([]);
        expect(out.customTypes).toEqual([]);
        expect(out.dependencies).toEqual([]);
    });
});

describe('databaseTypeToDialecte', () => {
    it.each([
        [DatabaseType.POSTGRESQL, 'postgresql'],
        [DatabaseType.COCKROACHDB, 'postgresql'],
        [DatabaseType.MYSQL, 'mysql'],
        [DatabaseType.MARIADB, 'mysql'],
        [DatabaseType.SQLITE, undefined],
        [DatabaseType.SQL_SERVER, undefined],
        [null, undefined],
    ])('%s → %s', (type, expected) => {
        expect(databaseTypeToDialecte(type)).toBe(expected);
    });
});

describe('postImport', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        env.API_URL = 'http://api.test/';
        env.USER_ID = '42';
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("utilise l'id du diagramme tel quel (espace → %20) dans l'URL exacte", async () => {
        fetchMock.mockResolvedValue(jsonResponse({}, 201));

        await postImport('mon projet', makeRequest());

        expect(fetchMock.mock.calls[0][0]).toBe(
            'http://api.test/api/projets/mon%20projet/import'
        );
    });

    it('POST avec X-User-Id et le corps confirme_remplacement / fichier / rapport', async () => {
        fetchMock.mockResolvedValue(jsonResponse({}, 201));
        const request = { ...makeRequest(), confirme_remplacement: true };

        await postImport('abc', request);

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.method).toBe('POST');
        expect((init.headers as Record<string, string>)['X-User-Id']).toBe(
            '42'
        );
        const body = JSON.parse(init.body as string);
        expect(body.confirme_remplacement).toBe(true);
        expect(body.fichier).toEqual({
            nom: 'dump.sql',
            dialecte: 'postgresql',
            taille_octets: 12,
        });
        expect(body.rapport).toEqual({
            non_repris: [
                { ligne: 3, type: 'INSERT', raison: 'Données non reprises' },
            ],
        });
        expect(body.diagramme.id).toBe('diagram-courant');
    });

    it('renvoie la réponse 201 telle quelle', async () => {
        const payload = {
            id_import: '0b0f4c1e-0000-4000-8000-000000000001',
            numero_sequence: 7,
            nb_elements_crees: 12,
        };
        fetchMock.mockResolvedValue(jsonResponse(payload, 201));
        await expect(postImport('abc', makeRequest())).resolves.toEqual(
            payload
        );
    });

    it('409 avec detail.code et nb_tables_existantes', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(
                {
                    detail: {
                        code: 'CONFIRMATION_REQUISE',
                        nb_tables_existantes: 4,
                    },
                },
                409
            )
        );
        const error = await rejection(postImport('abc', makeRequest()));
        expect(error.status).toBe(409);
        expect(error.code).toBe('CONFIRMATION_REQUISE');
        expect(isImportConfirmationRequired(error)).toBe(true);
        expect(getExistingTablesCount(error)).toBe(4);
    });

    it.each([
        [401, 'unauthenticated'],
        [403, 'forbidden'],
        [404, 'not_found'],
        [413, 'too_large'],
        [422, 'validation'],
        [500, 'unknown'],
    ])('statut %s → kind %s, sans confirmation', async (status, kind) => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: 'x' }, status));
        const error = await rejection(postImport('abc', makeRequest()));
        expect(error.status).toBe(status);
        expect(getImportApiErrorKind(error)).toBe(kind);
        expect(isImportConfirmationRequired(error)).toBe(false);
    });

    it('fetch rejeté → network', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        const error = await rejection(postImport('abc', makeRequest()));
        expect(error.status).toBe(0);
        expect(getImportApiErrorKind(error)).toBe('network');
        expect(isImportConfirmationRequired(error)).toBe(false);
    });
});

describe('getExistingTablesCount', () => {
    const conflict = (details: unknown) =>
        new ApiError({ status: 409, message: 'x', details });

    it('lit details.detail.nb_tables_existantes', () => {
        expect(
            getExistingTablesCount(
                conflict({ detail: { nb_tables_existantes: 4 } })
            )
        ).toBe(4);
    });

    it('repli : details.nb_tables_existantes', () => {
        expect(
            getExistingTablesCount(conflict({ nb_tables_existantes: 2 }))
        ).toBe(2);
    });

    it.each([
        ['absent', { detail: {} }],
        ['texte', { detail: { nb_tables_existantes: '4' } }],
        ['detail texte', { detail: 'Conflit' }],
        ['sans détails', undefined],
    ])('%s → null', (_label, details) => {
        expect(getExistingTablesCount(conflict(details))).toBeNull();
    });

    it("null pour une erreur qui n'est pas une ApiError", () => {
        expect(getExistingTablesCount(new Error('x'))).toBeNull();
    });

    it('isImportConfirmationRequired : le code seul suffit', () => {
        expect(
            isImportConfirmationRequired(
                new ApiError({
                    status: 400,
                    code: 'CONFIRMATION_REQUISE',
                    message: 'x',
                })
            )
        ).toBe(true);
        expect(isImportConfirmationRequired(new Error('x'))).toBe(false);
    });
});

describe('describeImportApiError', () => {
    const err = (status: number, details?: unknown) =>
        new ApiError({ status, message: `HTTP ${status}`, details });

    it('une erreur quelconque est unknown', () => {
        expect(getImportApiErrorKind(new Error('x'))).toBe('unknown');
    });

    it('utilise les clés api_errors.import.*', () => {
        expect(describeImportApiError(err(413))).toEqual({
            kind: 'too_large',
            titleKey: 'api_errors.import.title',
            descriptionKey: 'api_errors.import.too_large',
            serverMessage: undefined,
        });
    });

    it('422 avec detail texte : message du serveur', () => {
        expect(
            describeImportApiError(
                err(422, {
                    detail: 'Diagramme refusé : identifiant déjà utilisé.',
                })
            ).serverMessage
        ).toBe('Diagramme refusé : identifiant déjà utilisé.');
    });

    it("422 pydantic avec loc ['body','diagramme'] : 'msg (diagramme)'", () => {
        expect(
            describeImportApiError(
                err(422, {
                    detail: [
                        {
                            type: 'value_error',
                            loc: ['body', 'diagramme'],
                            msg: 'Value error, Le diagramme ne contient aucune table : rien à importer.',
                        },
                    ],
                })
            ).serverMessage
        ).toBe(
            'Value error, Le diagramme ne contient aucune table : rien à importer. (diagramme)'
        );
    });

    it('403 : pas de serverMessage', () => {
        const d = describeImportApiError(
            err(403, {
                detail: 'Seul le responsable du projet peut effectuer cette action.',
            })
        );
        expect(d.kind).toBe('forbidden');
        expect(d.serverMessage).toBeUndefined();
    });
});
