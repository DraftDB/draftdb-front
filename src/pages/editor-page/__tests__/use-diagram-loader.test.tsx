import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

const mockEnv = vi.hoisted(() => ({
    API_URL: 'http://api.test',
    USER_ID: 'user-1',
    PROJECT_ID: '',
}));
vi.mock('@/lib/env', () => mockEnv);

const mocks = vi.hoisted(() => ({
    toast: vi.fn(),
    loadDiagram: vi.fn(),
    getDiagram: vi.fn(),
    replaceDiagram: vi.fn(),
    listDiagrams: vi.fn(),
    updateConfig: vi.fn(),
    openOpenDiagramDialog: vi.fn(),
    openCreateDiagramDialog: vi.fn(),
    confirmOverwrite: vi.fn(),
    config: { defaultDiagramId: '' },
}));

vi.mock('@/components/toast/use-toast', () => ({ toast: mocks.toast }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/use-chartdb', () => ({
    useChartDB: () => ({
        loadDiagram: mocks.loadDiagram,
        currentDiagram: { id: '' },
    }),
}));
vi.mock('@/hooks/use-config', () => ({
    useConfig: () => ({
        config: mocks.config,
        updateConfig: mocks.updateConfig,
    }),
}));
vi.mock('@/hooks/use-dialog', () => ({
    useDialog: () => ({
        openOpenDiagramDialog: mocks.openOpenDiagramDialog,
        openCreateDiagramDialog: mocks.openCreateDiagramDialog,
    }),
}));
const loader = { showLoader: vi.fn(), hideLoader: vi.fn() };
vi.mock('@/hooks/use-full-screen-spinner', () => ({
    useFullScreenLoader: () => loader,
}));
const undo = { resetRedoStack: vi.fn(), resetUndoStack: vi.fn() };
vi.mock('@/hooks/use-redo-undo-stack', () => ({
    useRedoUndoStack: () => undo,
}));
vi.mock('@/hooks/use-storage', () => ({
    useStorage: () => ({
        getDiagram: mocks.getDiagram,
        replaceDiagram: mocks.replaceDiagram,
        listDiagrams: mocks.listDiagrams,
    }),
}));
vi.mock('@/hooks/use-projet-conflict-prompt', () => ({
    useProjetConflictPrompt: () => mocks.confirmOverwrite,
}));

import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import { useDiagramLoader } from '../use-diagram-loader';

const serverBody = {
    id_projet: ID,
    nom: 'Boutique',
    description: null,
    type_base: 'postgresql',
    numero_sequence: 3,
    diagramme: {
        id: ID,
        name: 'Boutique',
        databaseType: 'postgresql',
        tables: [],
        relationships: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    },
};

const localDiagram: Diagram = {
    id: ID,
    name: 'Boutique',
    databaseType: DatabaseType.POSTGRESQL,
    tables: [],
    relationships: [],
    createdAt: new Date(),
    updatedAt: new Date(),
};

const Probe: React.FC = () => {
    const { initialDiagram } = useDiagramLoader();
    const location = useLocation();
    return (
        <>
            <div data-testid="path">{location.pathname}</div>
            <div data-testid="diagram">{initialDiagram?.id ?? ''}</div>
        </>
    );
};

const renderAt = (path: string) =>
    render(
        <React.StrictMode>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/" element={<Probe />} />
                    <Route path="/diagrams/:diagramId" element={<Probe />} />
                </Routes>
            </MemoryRouter>
        </React.StrictMode>
    );

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

describe('useDiagramLoader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockEnv.API_URL = 'http://api.test';
        mocks.config.defaultDiagramId = '';
        localStorage.clear();
        mocks.getDiagram.mockResolvedValue(undefined);
        mocks.replaceDiagram.mockResolvedValue(undefined);
        mocks.loadDiagram.mockResolvedValue(localDiagram);
        mocks.listDiagrams.mockResolvedValue([localDiagram]);
        mocks.updateConfig.mockResolvedValue(undefined);
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('mode API : un seul GET (StrictMode), écrit puis affiche le projet', async () => {
        fetchMock.mockResolvedValue(json(serverBody));

        renderAt(`/diagrams/${ID}`);

        await waitFor(() =>
            expect(screen.getByTestId('diagram').textContent).toBe(ID)
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`http://api.test/api/projets/${ID}`);
        expect(init.method).toBe('GET');
        expect(mocks.replaceDiagram).toHaveBeenCalledTimes(1);
        expect(mocks.loadDiagram).toHaveBeenCalledWith(ID);
        expect(mocks.toast).not.toHaveBeenCalled();
    });

    it.each([
        [401, 'title_unauthenticated'],
        [403, 'title_forbidden'],
        [404, 'title_not_found'],
    ])(
        '%i : toast distinct, rien écrit, retour à l’accueil sans boucle',
        async (status, title) => {
            mocks.config.defaultDiagramId = ID;
            mocks.getDiagram.mockResolvedValue(localDiagram);
            fetchMock.mockResolvedValue(json({ detail: 'non' }, status));

            renderAt(`/diagrams/${ID}`);

            await waitFor(() =>
                expect(screen.getByTestId('path').textContent).toBe('/')
            );
            await waitFor(() =>
                expect(mocks.openOpenDiagramDialog).toHaveBeenCalled()
            );
            expect(mocks.toast).toHaveBeenCalledTimes(1);
            expect(mocks.toast.mock.calls[0][0]).toMatchObject({
                variant: 'destructive',
                title: `api_errors.projet_open.${title}`,
            });
            expect(mocks.replaceDiagram).not.toHaveBeenCalled();
            expect(mocks.updateConfig).toHaveBeenCalledWith({
                config: { defaultDiagramId: '' },
            });
            // Pas de retour automatique vers le projet en échec.
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(mocks.loadDiagram).not.toHaveBeenCalled();
        }
    );

    it('erreur réseau avec copie locale : ouvre la copie et prévient', async () => {
        mocks.getDiagram.mockResolvedValue(localDiagram);
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

        renderAt(`/diagrams/${ID}`);

        await waitFor(() =>
            expect(screen.getByTestId('diagram').textContent).toBe(ID)
        );
        expect(mocks.replaceDiagram).not.toHaveBeenCalled();
        expect(mocks.toast.mock.calls[0][0]).toMatchObject({
            title: 'api_errors.projet_open.title_network',
            description: 'api_errors.projet_open.offline_local_copy',
        });
        expect(screen.getByTestId('path').textContent).toBe(`/diagrams/${ID}`);
    });

    it('annule le GET si l’utilisateur quitte', async () => {
        let signal: AbortSignal | undefined;
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    signal = init.signal ?? undefined;
                    signal?.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError'))
                    );
                })
        );

        const { unmount } = renderAt(`/diagrams/${ID}`);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        unmount();

        await waitFor(() => expect(signal?.aborted).toBe(true));
        expect(mocks.replaceDiagram).not.toHaveBeenCalled();
    });

    it('mode API, id non UUID : chargement local, sans GET', async () => {
        renderAt('/diagrams/abcdef123456');

        await waitFor(() =>
            expect(mocks.loadDiagram).toHaveBeenCalledWith('abcdef123456')
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('mode local : comportement ChartDB, sans GET', async () => {
        mockEnv.API_URL = '';

        renderAt(`/diagrams/${ID}`);

        await waitFor(() =>
            expect(screen.getByTestId('diagram').textContent).toBe(ID)
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.replaceDiagram).not.toHaveBeenCalled();
    });

    it('mode API, « / » avec un projet par défaut : ouvre depuis le serveur', async () => {
        mocks.config.defaultDiagramId = ID;
        fetchMock.mockResolvedValue(json(serverBody));

        renderAt('/');

        await waitFor(() =>
            expect(screen.getByTestId('diagram').textContent).toBe(ID)
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // Pas de chargement local avant le GET.
        expect(mocks.replaceDiagram.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadDiagram.mock.invocationCallOrder[0]
        );
    });
});
