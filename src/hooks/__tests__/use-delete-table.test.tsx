import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type * as HttpClient from '@/lib/api/http-client';
import type { DBTable } from '@/lib/domain/db-table';
import type { TableLinks } from '@/lib/api/tables-api';
import type { TableLinksListProps } from '@/dialogs/base-alert-dialog/table-links-list';

const mocks = vi.hoisted(() => ({
    isApiConfiguredMock: vi.fn(() => false),
    removeTable: vi.fn(),
    deleteTableWithApi: vi.fn(),
    getTable: vi.fn(),
    showAlert: vi.fn(),
}));

vi.mock('@/lib/api/http-client', async (importOriginal) => ({
    ...(await importOriginal<typeof HttpClient>()),
    isApiConfigured: mocks.isApiConfiguredMock,
}));
vi.mock('@/hooks/use-chartdb', () => ({
    useChartDB: () => ({
        removeTable: mocks.removeTable,
        deleteTableWithApi: mocks.deleteTableWithApi,
        getTable: mocks.getTable,
    }),
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { name?: string }) =>
            options?.name ? `${key}:${options.name}` : key,
    }),
}));

import { alertContext } from '@/context/alert-context/alert-context';
import { useDeleteTable } from '../use-delete-table';

const Wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
    <alertContext.Provider
        value={{ showAlert: mocks.showAlert, closeAlert: vi.fn() }}
    >
        {children}
    </alertContext.Provider>
);

const links: TableLinks = {
    cles_etrangeres: [
        {
            id: 'r1',
            name: 'fk_orders_users',
            sourceTableId: 'id_orders',
            targetTableId: 'id_users',
            sourceFieldId: 'f1',
            targetFieldId: 'f2',
        },
    ],
    index: [{ id: 'i1', name: 'idx_orders' }],
};

const table = { id: 'id_orders', name: 'orders' } as DBTable;

/**
 * Simule le provider : appelle confirm(table, links) et renvoie sa promesse.
 * Le hook lui passe confirmDeletion, qui ouvre la boîte via showAlert.
 */
const delegateToConfirm = () => {
    let answer: Promise<boolean> | undefined;
    mocks.deleteTableWithApi.mockImplementation(
        async (
            _id: string,
            confirm: (t: DBTable, l: TableLinks) => Promise<boolean>
        ) => {
            answer = confirm(table, links);
            return (await answer) ? 'deleted' : 'cancelled';
        }
    );
    return () => answer!;
};

const alertParams = () => mocks.showAlert.mock.calls[0][0];

const setup = () => renderHook(() => useDeleteTable(), { wrapper: Wrapper });

describe('useDeleteTable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isApiConfiguredMock.mockReturnValue(false);
        mocks.removeTable.mockResolvedValue(undefined);
        mocks.getTable.mockImplementation((id: string) =>
            id === 'id_orders' ? { id, name: 'orders' } : null
        );
    });

    describe('mode local', () => {
        it('removeTable est appelé (undo d’origine), ni API ni boîte, retour deleted', async () => {
            const { result } = setup();

            const outcome = await result.current('id_orders');

            expect(outcome).toBe('deleted');
            expect(mocks.removeTable).toHaveBeenCalledTimes(1);
            // Aucune option : l'undo d'origine de removeTable est conservé.
            expect(mocks.removeTable).toHaveBeenCalledWith('id_orders');
            expect(mocks.deleteTableWithApi).not.toHaveBeenCalled();
            expect(mocks.showAlert).not.toHaveBeenCalled();
        });
    });

    describe('mode API', () => {
        beforeEach(() => {
            mocks.isApiConfiguredMock.mockReturnValue(true);
        });

        it.each(['deleted', 'cancelled', 'error'] as const)(
            'délègue à deleteTableWithApi et propage %s ; removeTable non appelé',
            async (outcome) => {
                mocks.deleteTableWithApi.mockResolvedValue(outcome);
                const { result } = setup();

                await expect(result.current('id_orders')).resolves.toBe(
                    outcome
                );

                expect(mocks.deleteTableWithApi).toHaveBeenCalledTimes(1);
                const [id, confirm] = mocks.deleteTableWithApi.mock.calls[0];
                expect(id).toBe('id_orders');
                expect(typeof confirm).toBe('function');
                expect(mocks.removeTable).not.toHaveBeenCalled();
                expect(mocks.showAlert).not.toHaveBeenCalled();
            }
        );

        it('la boîte : titre avec le nom, description, libellés des boutons', async () => {
            const answer = delegateToConfirm();
            const { result } = setup();

            const pending = result.current('id_orders');
            expect(mocks.showAlert).toHaveBeenCalledTimes(1);
            const params = alertParams();
            expect(params.title).toBe(
                'api_errors.table_delete.confirm_title:orders'
            );
            expect(params.description).toBe(
                'api_errors.table_delete.confirm_description'
            );
            expect(params.actionLabel).toBe(
                'api_errors.table_delete.confirm_action'
            );
            expect(params.closeLabel).toBe('api_errors.table_delete.cancel');

            params.onClose();
            await pending;
            await answer();
        });

        it('content : la liste reçue, et getTableName résout les ids connus', async () => {
            const answer = delegateToConfirm();
            const { result } = setup();

            const pending = result.current('id_orders');
            const content = alertParams()
                .content as React.ReactElement<TableLinksListProps>;

            expect(content.props.links).toBe(links);
            expect(content.props.getTableName!('id_orders')).toBe('orders');
            expect(content.props.getTableName!('id_inconnu')).toBeUndefined();

            alertParams().onClose();
            await pending;
            await answer();
        });

        it('Supprimer → true, outcome deleted', async () => {
            const answer = delegateToConfirm();
            const { result } = setup();

            const pending = result.current('id_orders');
            alertParams().onAction();

            await expect(answer()).resolves.toBe(true);
            await expect(pending).resolves.toBe('deleted');
        });

        it('Annuler ou Échap (onClose) → false, outcome cancelled', async () => {
            const answer = delegateToConfirm();
            const { result } = setup();

            const pending = result.current('id_orders');
            alertParams().onClose();

            await expect(answer()).resolves.toBe(false);
            await expect(pending).resolves.toBe('cancelled');
        });

        it('action puis fermeture : la première réponse l’emporte (true)', async () => {
            const answer = delegateToConfirm();
            const { result } = setup();

            const pending = result.current('id_orders');
            alertParams().onAction();
            alertParams().onClose();

            await expect(answer()).resolves.toBe(true);
            await expect(pending).resolves.toBe('deleted');
        });

        it('fermeture puis action : la première réponse l’emporte (false)', async () => {
            const answer = delegateToConfirm();
            const { result } = setup();

            const pending = result.current('id_orders');
            alertParams().onClose();
            alertParams().onAction();

            await expect(answer()).resolves.toBe(false);
            await expect(pending).resolves.toBe('cancelled');
        });
    });
});
