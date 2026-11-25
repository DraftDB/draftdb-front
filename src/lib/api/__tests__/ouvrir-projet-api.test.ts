import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
    API_URL: '',
    USER_ID: '',
}));

vi.mock('@/lib/env', () => mockEnv);

import { DatabaseType } from '@/lib/domain/database-type';
import type { DBTable } from '@/lib/domain/db-table';
import { ApiError } from '../http-client';
import type { ProjetOuvertResponse } from '../projets-api';
import {
    describeOuvrirProjetApiError,
    getNumeroSequence,
    getOuvrirProjetApiErrorKind,
    ouvrirProjet,
    setNumeroSequence,
    toLocalDiagram,
    typeBaseToDatabaseType,
} from '../projets-api';

const PROJET_ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

const makeTable = (overrides: Partial<DBTable> = {}): DBTable => ({
    id: 't1',
    name: 'users',
    schema: 'public',
    x: 10,
    y: 20,
    color: '#8eb7ff',
    isView: false,
    createdAt: 1,
    fields: [
        {
            id: 'f-id',
            name: 'id',
            type: { id: 'integer', name: 'integer' },
            primaryKey: true,
            unique: true,
            nullable: false,
            createdAt: 1,
        },
        {
            id: 'f-email',
            name: 'email',
            type: { id: 'varchar', name: 'varchar' },
            primaryKey: false,
            unique: false,
            nullable: true,
            createdAt: 2,
        },
        {
            id: 'f-age',
            name: 'age',
            type: { id: 'integer', name: 'integer' },
            primaryKey: false,
            unique: false,
            nullable: true,
            createdAt: 3,
        },
    ],
    indexes: [
        {
            id: 'i1',
            name: 'users_pkey',
            unique: true,
            fieldIds: ['f-id'],
            isPrimaryKey: true,
            createdAt: 1,
        },
    ],
    ...overrides,
});

const makeResponse = (
    overrides: Partial<ProjetOuvertResponse> = {}
): ProjetOuvertResponse => ({
    id_projet: PROJET_ID,
    nom: 'Boutique',
    description: null,
    type_base: 'postgresql',
    numero_sequence: 7,
    diagramme: {
        id: PROJET_ID,
        name: 'Boutique',
        databaseType: DatabaseType.POSTGRESQL,
        tables: [makeTable()],
        relationships: [
            {
                id: 'r1',
                name: 'fk',
                sourceTableId: 't1',
                targetTableId: 't1',
                sourceFieldId: 'f-id',
                targetFieldId: 'f-age',
                sourceCardinality: 'one',
                targetCardinality: 'many',
                createdAt: 4,
            },
        ],
        createdAt: '2026-01-02T03:04:05.000Z',
        updatedAt: '2026-02-03T04:05:06.000Z',
    },
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

describe('ouvrirProjet', () => {
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

    it('envoie un GET sans corps sur /api/projets/{id} avec X-User-Id', async () => {
        fetchMock.mockResolvedValue(jsonResponse(makeResponse()));
        const controller = new AbortController();

        const response = await ouvrirProjet(PROJET_ID, {
            signal: controller.signal,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        // L'id de l'URL fait foi.
        expect(url).toBe(`http://api.test/api/projets/${PROJET_ID}`);
        expect(init.method).toBe('GET');
        expect(init.body).toBeUndefined();
        expect(init.headers['X-User-Id']).toBe('user-1');
        expect(init.headers['Content-Type']).toBeUndefined();
        expect(init.signal).toBe(controller.signal);
        expect(response.numero_sequence).toBe(7);
    });

    it('préfère l’identifiant de localStorage à VITE_USER_ID', async () => {
        localStorage.setItem('draftdb_user_id', 'user-ls');
        fetchMock.mockResolvedValue(jsonResponse(makeResponse()));

        await ouvrirProjet(PROJET_ID);

        expect(fetchMock.mock.calls[0][1].headers['X-User-Id']).toBe('user-ls');
    });

    it.each([
        [401, 'unauthenticated'],
        [403, 'forbidden'],
        [404, 'not_found'],
        [500, 'server'],
        [503, 'server'],
    ] as const)('rejette un %i en %s', async (status, kind) => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: 'refusé' }, status));

        const error = await rejection(ouvrirProjet(PROJET_ID));

        expect(error).toBeInstanceOf(ApiError);
        expect(error.status).toBe(status);
        expect(getOuvrirProjetApiErrorKind(error)).toBe(kind);
    });

    it('rejette une erreur réseau en status 0', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

        const error = await rejection(ouvrirProjet(PROJET_ID));

        expect(error.status).toBe(0);
        expect(getOuvrirProjetApiErrorKind(error)).toBe('network');
    });

    it('laisse passer l’annulation (AbortError)', async () => {
        fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));

        const error = await rejection(ouvrirProjet(PROJET_ID));

        expect(error).toBeInstanceOf(DOMException);
    });
});

describe('describeOuvrirProjetApiError', () => {
    const err = (status: number) => new ApiError({ status, message: 'x' });

    it('donne un titre et un message distincts par cas', () => {
        const kinds = [401, 403, 404, 0, 500].map(
            (status) => describeOuvrirProjetApiError(err(status)).descriptionKey
        );
        expect(new Set(kinds).size).toBe(5);
        expect(describeOuvrirProjetApiError(err(403))).toEqual({
            kind: 'forbidden',
            titleKey: 'api_errors.projet_open.title_forbidden',
            descriptionKey: 'api_errors.projet_open.forbidden',
            blocking: true,
        });
    });

    it('bloque 401, 403 et 404 seulement', () => {
        expect(describeOuvrirProjetApiError(err(401)).blocking).toBe(true);
        expect(describeOuvrirProjetApiError(err(404)).blocking).toBe(true);
        expect(describeOuvrirProjetApiError(err(0)).blocking).toBe(false);
        expect(describeOuvrirProjetApiError(err(502)).blocking).toBe(false);
        expect(describeOuvrirProjetApiError(err(418)).blocking).toBe(false);
        expect(describeOuvrirProjetApiError(new Error('x')).kind).toBe(
            'unknown'
        );
    });
});

describe('toLocalDiagram', () => {
    const now = new Date('2026-11-24T00:00:00.000Z');

    it('prend id, nom et type de base du projet, sans régénérer les ids', () => {
        const diagram = toLocalDiagram(
            makeResponse({
                nom: 'Nouveau nom',
                type_base: 'mysql',
                diagramme: {
                    ...makeResponse().diagramme,
                    id: 'autre-id',
                    name: 'Ancien nom',
                },
            }),
            now
        );

        expect(diagram.id).toBe(PROJET_ID);
        expect(diagram.name).toBe('Nouveau nom');
        expect(diagram.databaseType).toBe(DatabaseType.MYSQL);
        expect(diagram.tables?.map((t) => t.id)).toEqual(['t1']);
        expect(diagram.relationships?.map((r) => r.id)).toEqual(['r1']);
        expect(diagram.tables?.[0].indexes.map((i) => i.id)).toEqual(['i1']);
    });

    it('garde les colonnes dans l’ordre du serveur', () => {
        const diagram = toLocalDiagram(makeResponse(), now);
        expect(diagram.tables?.[0].fields.map((f) => f.id)).toEqual([
            'f-id',
            'f-email',
            'f-age',
        ]);
    });

    it('reconvertit les dates en Date', () => {
        const diagram = toLocalDiagram(makeResponse(), now);
        expect(diagram.createdAt).toBeInstanceOf(Date);
        expect(diagram.createdAt.toISOString()).toBe(
            '2026-01-02T03:04:05.000Z'
        );
        expect(diagram.updatedAt.toISOString()).toBe(
            '2026-02-03T04:05:06.000Z'
        );
    });

    it('convertit un createdAt d’élément en chaîne en nombre', () => {
        const response = makeResponse();
        const table = response.diagramme.tables![0];
        (table as unknown as { createdAt: string }).createdAt =
            '2026-01-02T03:04:05.000Z';
        const diagram = toLocalDiagram(response, now);
        expect(diagram.tables?.[0].createdAt).toBe(
            Date.parse('2026-01-02T03:04:05.000Z')
        );
    });

    it('rend un diagramme vide pour un projet sans table', () => {
        const diagram = toLocalDiagram(
            makeResponse({
                diagramme: {
                    id: PROJET_ID,
                    name: 'Vide',
                    databaseType: DatabaseType.GENERIC,
                },
            }),
            now
        );
        expect(diagram.tables).toEqual([]);
        expect(diagram.relationships).toEqual([]);
        expect(diagram.notes).toEqual([]);
        expect(diagram.createdAt).toEqual(now);
        expect(diagram.updatedAt).toEqual(now);
    });

    it('se replie sur GENERIC pour un type de base inconnu', () => {
        expect(typeBaseToDatabaseType('oracle')).toBe(DatabaseType.GENERIC);
        expect(typeBaseToDatabaseType('postgresql')).toBe(
            DatabaseType.POSTGRESQL
        );
        expect(typeBaseToDatabaseType('generic')).toBe(DatabaseType.GENERIC);
    });
});

describe('numero_sequence', () => {
    beforeEach(() => localStorage.clear());

    it('est conservé par projet', () => {
        expect(getNumeroSequence(PROJET_ID)).toBeUndefined();
        setNumeroSequence(PROJET_ID, 12);
        expect(getNumeroSequence(PROJET_ID)).toBe(12);
        expect(getNumeroSequence('autre')).toBeUndefined();
    });
});
