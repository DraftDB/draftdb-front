import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DBTable } from '@/lib/domain/db-table';
import type { Diagram } from '@/lib/domain/diagram';
import type * as HttpClient from '@/lib/api/http-client';

const mocks = vi.hoisted(() => ({
    apiConfigured: false,
    addUndoAction: vi.fn(),
    resetRedoStack: vi.fn(),
    resetUndoStack: vi.fn(),
    storage: {
        updateDiagram: vi.fn(),
        addTable: vi.fn(),
    },
}));

vi.mock('@/lib/api/http-client', async (importOriginal) => ({
    ...(await importOriginal<typeof HttpClient>()),
    isApiConfigured: () => mocks.apiConfigured,
}));
vi.mock('@/hooks/use-storage', () => ({ useStorage: () => mocks.storage }));
vi.mock('@/hooks/use-redo-undo-stack', () => ({
    useRedoUndoStack: () => ({
        addUndoAction: mocks.addUndoAction,
        resetRedoStack: mocks.resetRedoStack,
        resetUndoStack: mocks.resetUndoStack,
    }),
}));
vi.mock('@/context/diff-context/use-diff', () => ({
    useDiff: () => ({
        hasDiff: false,
        events: { useSubscription: vi.fn() },
    }),
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/toast/use-toast', () => ({ toast: vi.fn() }));

import { ChartDBProvider } from '../chartdb-provider';
import { useChartDB } from '@/hooks/use-chartdb';

const makeTable = (overrides: Partial<DBTable> = {}): DBTable => ({
    id: 'existing',
    name: 'x_copy',
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

const renderChartDB = (tables: DBTable[] = []) =>
    renderHook(() => useChartDB(), {
        wrapper: ({ children }: React.PropsWithChildren) => (
            <ChartDBProvider diagram={{ tables } as Diagram}>
                {children}
            </ChartDBProvider>
        ),
    });

describe('createTable : nommage selon le mode', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        mocks.apiConfigured = false;
        vi.clearAllMocks();
        mocks.storage.updateDiagram.mockResolvedValue(undefined);
        mocks.storage.addTable.mockResolvedValue(undefined);
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('mode API', () => {
        beforeEach(() => {
            mocks.apiConfigured = true;
            fetchMock.mockImplementation(async (_url, init) => {
                const table = JSON.parse(init.body);
                return new Response(
                    JSON.stringify({
                        table,
                        numero_sequence: 1,
                        avertissement: null,
                    }),
                    { status: 201 }
                );
            });
        });

        it('rend unique un nom pris dans le même schéma : x_copy → x_copy_2', async () => {
            const { result } = renderChartDB([makeTable()]);

            let created: DBTable | null = null;
            await act(async () => {
                created = await result.current.createTable({
                    name: 'x_copy',
                    schema: 'public',
                });
            });

            expect(created).not.toBeNull();
            expect(created!.name).toBe('x_copy_2');
            expect(JSON.parse(fetchMock.mock.calls[0][1].body).name).toBe(
                'x_copy_2'
            );
            expect(result.current.tables.map((t) => t.name)).toEqual([
                'x_copy',
                'x_copy_2',
            ]);
        });

        it('garde x_copy si le même nom est dans un autre schéma', async () => {
            const { result } = renderChartDB([makeTable({ schema: 'public' })]);

            let created: DBTable | null = null;
            await act(async () => {
                created = await result.current.createTable({
                    name: 'x_copy',
                    schema: 'sales',
                });
            });

            expect(created!.name).toBe('x_copy');
        });

        it('utilise le schéma effectif (par défaut du type de base si absent)', async () => {
            // Type de base générique : pas de schéma par défaut, donc `undefined`.
            const { result } = renderChartDB([
                makeTable({ schema: undefined }),
            ]);

            let created: DBTable | null = null;
            await act(async () => {
                created = await result.current.createTable({ name: 'x_copy' });
            });

            expect(created!.name).toBe('x_copy_2');
        });
    });

    describe('mode local (sans VITE_API_URL)', () => {
        it('deux duplications donnent deux x_copy, sans appel réseau', async () => {
            const { result } = renderChartDB([makeTable({ name: 'x' })]);

            await act(async () => {
                await result.current.createTable({
                    name: 'x_copy',
                    schema: 'public',
                });
            });
            await act(async () => {
                await result.current.createTable({
                    name: 'x_copy',
                    schema: 'public',
                });
            });

            expect(result.current.tables.map((t) => t.name)).toEqual([
                'x',
                'x_copy',
                'x_copy',
            ]);
            expect(fetchMock).not.toHaveBeenCalled();
            // Comportement ChartDB d'origine : historique d'annulation conservé.
            expect(mocks.addUndoAction).toHaveBeenCalledTimes(2);
        });
    });
});
