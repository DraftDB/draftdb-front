import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import { ApiError } from '@/lib/api/http-client';
import type { ProjetOuvertResponse } from '@/lib/api/projets-api';
import { getNumeroSequence } from '@/lib/api/projets-api';
import type { OpenProjetDeps } from '../open-projet';
import { openProjet } from '../open-projet';

const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

const makeResponse = (): ProjetOuvertResponse => ({
    id_projet: ID,
    nom: 'Boutique',
    description: null,
    type_base: 'postgresql',
    numero_sequence: 5,
    diagramme: {
        id: ID,
        name: 'Boutique',
        databaseType: DatabaseType.POSTGRESQL,
        tables: [
            {
                id: 't1',
                name: 'users',
                schema: 'public',
                x: 0,
                y: 0,
                color: '#fff',
                isView: false,
                createdAt: 1,
                fields: [],
                indexes: [],
            },
        ],
        relationships: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
    },
});

const localSameAsServer = (): Diagram => ({
    id: ID,
    name: 'Boutique',
    databaseType: DatabaseType.POSTGRESQL,
    tables: [
        {
            id: 't1',
            name: 'users',
            schema: 'public',
            // Position différente : ignorée par la comparaison.
            x: 300,
            y: 200,
            color: '#000',
            isView: false,
            createdAt: 99,
            fields: [],
            indexes: [],
        },
    ],
    relationships: [],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
});

const localDifferent = (): Diagram => ({
    ...localSameAsServer(),
    tables: [
        { ...localSameAsServer().tables![0], name: 'users_renamed_locally' },
    ],
});

const makeDeps = (
    overrides: Partial<
        Record<Exclude<keyof OpenProjetDeps, 'signal'>, Mock>
    > = {}
) => {
    const deps = {
        fetchProjet: vi.fn().mockResolvedValue(makeResponse()),
        getLocalDiagram: vi.fn().mockResolvedValue(undefined),
        replaceDiagram: vi.fn().mockResolvedValue(undefined),
        confirmOverwrite: vi.fn().mockResolvedValue('server'),
        ...overrides,
    };
    return deps;
};

const apiError = (status: number) =>
    new ApiError({ status, message: `HTTP ${status}` });

describe('openProjet', () => {
    beforeEach(() => localStorage.clear());

    it('sans copie locale : écrit la version du serveur, sans dialogue', async () => {
        const deps = makeDeps();

        const result = await openProjet(ID, deps);

        expect(result).toEqual({ kind: 'opened', source: 'server' });
        expect(deps.fetchProjet).toHaveBeenCalledTimes(1);
        expect(deps.confirmOverwrite).not.toHaveBeenCalled();
        expect(deps.replaceDiagram).toHaveBeenCalledTimes(1);
        const written = deps.replaceDiagram.mock.calls[0][0] as Diagram;
        expect(written.id).toBe(ID);
        expect(written.name).toBe('Boutique');
        expect(written.tables?.[0].id).toBe('t1');
        expect(written.createdAt).toBeInstanceOf(Date);
        expect(getNumeroSequence(ID)).toBe(5);
    });

    it('copie locale identique : mise à jour silencieuse', async () => {
        const deps = makeDeps({
            getLocalDiagram: vi.fn().mockResolvedValue(localSameAsServer()),
        });

        const result = await openProjet(ID, deps);

        expect(result).toEqual({ kind: 'opened', source: 'server' });
        expect(deps.confirmOverwrite).not.toHaveBeenCalled();
        expect(deps.replaceDiagram).toHaveBeenCalledTimes(1);
    });

    it('copie locale différente : dialogue, puis écrasement sur choix « serveur »', async () => {
        const deps = makeDeps({
            getLocalDiagram: vi.fn().mockResolvedValue(localDifferent()),
            confirmOverwrite: vi.fn().mockResolvedValue('server'),
        });

        const result = await openProjet(ID, deps);

        expect(deps.confirmOverwrite).toHaveBeenCalledWith('Boutique');
        expect(deps.replaceDiagram).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ kind: 'opened', source: 'server' });
    });

    it('copie locale différente : « garder ma version locale » n’écrit rien', async () => {
        const deps = makeDeps({
            getLocalDiagram: vi.fn().mockResolvedValue(localDifferent()),
            confirmOverwrite: vi.fn().mockResolvedValue('local'),
        });

        const result = await openProjet(ID, deps);

        expect(deps.replaceDiagram).not.toHaveBeenCalled();
        expect(result).toEqual({ kind: 'opened', source: 'local' });
    });

    it.each([
        [401, 'unauthenticated'],
        [403, 'forbidden'],
        [404, 'not_found'],
    ] as const)(
        '%i : redirection, rien écrit, même avec une copie locale',
        async (status, kind) => {
            const deps = makeDeps({
                fetchProjet: vi.fn().mockRejectedValue(apiError(status)),
                getLocalDiagram: vi.fn().mockResolvedValue(localSameAsServer()),
            });

            const result = await openProjet(ID, deps);

            expect(result.kind).toBe('redirect');
            expect(result.kind === 'redirect' && result.error.kind).toBe(kind);
            expect(deps.replaceDiagram).not.toHaveBeenCalled();
            expect(deps.confirmOverwrite).not.toHaveBeenCalled();
            expect(getNumeroSequence(ID)).toBeUndefined();
        }
    );

    it.each([0, 500, 503])(
        'erreur %i avec copie locale : ouvre la copie locale',
        async (status) => {
            const deps = makeDeps({
                fetchProjet: vi.fn().mockRejectedValue(apiError(status)),
                getLocalDiagram: vi.fn().mockResolvedValue(localDifferent()),
            });

            const result = await openProjet(ID, deps);

            expect(result.kind).toBe('offline_local');
            expect(deps.replaceDiagram).not.toHaveBeenCalled();
        }
    );

    it('erreur réseau sans copie locale : redirection', async () => {
        const deps = makeDeps({
            fetchProjet: vi.fn().mockRejectedValue(apiError(0)),
        });

        const result = await openProjet(ID, deps);

        expect(result.kind).toBe('redirect');
        expect(result.kind === 'redirect' && result.error.kind).toBe('network');
        expect(result.kind === 'redirect' && result.error.blocking).toBe(false);
    });

    it('annulation pendant le GET : rien écrit', async () => {
        const controller = new AbortController();
        const deps = makeDeps({
            fetchProjet: vi.fn(async () => {
                controller.abort();
                throw new DOMException('aborted', 'AbortError');
            }),
        });

        const result = await openProjet(ID, {
            ...deps,
            signal: controller.signal,
        });

        expect(result).toEqual({ kind: 'aborted' });
        expect(deps.replaceDiagram).not.toHaveBeenCalled();
    });

    it('annulation pendant le dialogue : rien écrit', async () => {
        const controller = new AbortController();
        const deps = makeDeps({
            getLocalDiagram: vi.fn().mockResolvedValue(localDifferent()),
            confirmOverwrite: vi.fn(async () => {
                controller.abort();
                return 'server' as const;
            }),
        });

        const result = await openProjet(ID, {
            ...deps,
            signal: controller.signal,
        });

        expect(result).toEqual({ kind: 'aborted' });
        expect(deps.replaceDiagram).not.toHaveBeenCalled();
    });

    it('échec de l’écriture Dexie : copie locale conservée et ouverte', async () => {
        const deps = makeDeps({
            getLocalDiagram: vi.fn().mockResolvedValue(localSameAsServer()),
            replaceDiagram: vi.fn().mockRejectedValue(new Error('quota')),
        });

        const result = await openProjet(ID, deps);

        expect(result.kind).toBe('offline_local');
    });
});
