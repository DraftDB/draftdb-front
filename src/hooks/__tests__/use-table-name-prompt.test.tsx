import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DBTable } from '@/lib/domain/db-table';

const mocks = vi.hoisted(() => ({
    apiConfigured: false,
    tables: [] as unknown[],
    openTableNameDialog: vi.fn(),
}));

vi.mock('@/lib/api/http-client', () => ({
    isApiConfigured: () => mocks.apiConfigured,
}));
vi.mock('@/hooks/use-chartdb', () => ({
    useChartDB: () => ({ tables: mocks.tables }),
}));
vi.mock('@/hooks/use-dialog', () => ({
    useDialog: () => ({ openTableNameDialog: mocks.openTableNameDialog }),
}));

import { useTableNamePrompt } from '../use-table-name-prompt';
import type { TableNameAnswer } from '../use-table-name-prompt';

const makeTable = (name: string, isView = false): DBTable =>
    ({ name, schema: 'public', isView }) as DBTable;

const dialogParams = () => mocks.openTableNameDialog.mock.calls[0][0];

describe('useTableNamePrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.apiConfigured = false;
        mocks.tables = [];
    });

    it('mode local : résout {} sans ouvrir la boîte', async () => {
        const { result } = renderHook(() => useTableNamePrompt());

        const answer = await result.current({ isView: false });

        expect(answer).toEqual({});
        expect(answer && 'name' in answer).toBe(false);
        expect(mocks.openTableNameDialog).not.toHaveBeenCalled();
    });

    describe('mode API', () => {
        beforeEach(() => {
            mocks.apiConfigured = true;
        });

        it('transmet à la boîte le nom par défaut, les tables, le type et le schéma', () => {
            mocks.tables = [makeTable('table_1'), makeTable('v', true)];
            const { result } = renderHook(() => useTableNamePrompt());

            act(() => {
                void result.current({ isView: false, schema: 'sales' });
            });

            expect(mocks.openTableNameDialog).toHaveBeenCalledTimes(1);
            const params = dialogParams();
            expect(params.defaultName).toBe('table_2');
            expect(params.tables).toBe(mocks.tables);
            expect(params.isView).toBe(false);
            expect(params.schema).toBe('sales');
        });

        it('propose view_N pour une vue', () => {
            const { result } = renderHook(() => useTableNamePrompt());

            act(() => {
                void result.current({ isView: true });
            });

            expect(dialogParams().defaultName).toBe('view_1');
            expect(dialogParams().isView).toBe(true);
        });

        it('résout { name } quand le nom est validé', async () => {
            const { result } = renderHook(() => useTableNamePrompt());

            let promise!: Promise<TableNameAnswer | null>;
            act(() => {
                promise = result.current({ isView: false });
            });
            act(() => dialogParams().onConfirm('customers'));

            await expect(promise).resolves.toEqual({ name: 'customers' });
        });

        it('résout null quand la boîte est annulée', async () => {
            const { result } = renderHook(() => useTableNamePrompt());

            let promise!: Promise<TableNameAnswer | null>;
            act(() => {
                promise = result.current({ isView: false });
            });
            act(() => dialogParams().onCancel());

            await expect(promise).resolves.toBeNull();
        });

        it('la première réponse prime : valider puis fermer n’annule pas', async () => {
            const { result } = renderHook(() => useTableNamePrompt());

            let promise!: Promise<TableNameAnswer | null>;
            act(() => {
                promise = result.current({ isView: false });
            });
            act(() => {
                dialogParams().onConfirm('customers');
                // La fermeture de la boîte déclenche ensuite onCancel.
                dialogParams().onCancel();
            });

            await expect(promise).resolves.toEqual({ name: 'customers' });
        });

        it('la première réponse prime : annuler puis valider reste annulé', async () => {
            const { result } = renderHook(() => useTableNamePrompt());

            let promise!: Promise<TableNameAnswer | null>;
            act(() => {
                promise = result.current({ isView: false });
            });
            act(() => {
                dialogParams().onCancel();
                dialogParams().onConfirm('customers');
            });

            await expect(promise).resolves.toBeNull();
        });
    });
});
