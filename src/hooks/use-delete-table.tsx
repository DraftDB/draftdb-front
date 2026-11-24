import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAlert } from '@/context/alert-context/alert-context';
import { isApiConfigured } from '@/lib/api/http-client';
import type {
    ConfirmTableDeletion,
    DeleteTableOutcome,
} from '@/context/chartdb-context/chartdb-context';
import { TableLinksList } from '@/dialogs/base-alert-dialog/table-links-list';

/**
 * Point d'entrée unique de la suppression d'une table dans l'UI (menu
 * contextuel, liste latérale, touche Suppr du canvas).
 * Suppose AlertProvider monté (c'est le cas dans l'éditeur).
 *  - mode local : removeTable d'origine, avec undo ;
 *  - mode API : deleteTableWithApi, avec la boîte de confirmation.
 */
export const useDeleteTable = () => {
    const { t } = useTranslation();
    const { removeTable, deleteTableWithApi, getTable } = useChartDB();
    const { showAlert } = useAlert();

    const confirmDeletion: ConfirmTableDeletion = useCallback(
        (table, links) =>
            new Promise<boolean>((resolve) => {
                // La première réponse l'emporte.
                let settled = false;
                const settle = (answer: boolean) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    resolve(answer);
                };

                showAlert({
                    title: t('api_errors.table_delete.confirm_title', {
                        name: table.name,
                    }),
                    description: t(
                        'api_errors.table_delete.confirm_description'
                    ),
                    content: (
                        <TableLinksList
                            links={links}
                            getTableName={(id) => getTable(id)?.name}
                        />
                    ),
                    actionLabel: t('api_errors.table_delete.confirm_action'),
                    closeLabel: t('api_errors.table_delete.cancel'),
                    onAction: () => settle(true),
                    onClose: () => settle(false),
                });
            }),
        [showAlert, t, getTable]
    );

    return useCallback(
        async (tableId: string): Promise<DeleteTableOutcome> => {
            if (!isApiConfigured()) {
                await removeTable(tableId);
                return 'deleted';
            }
            return deleteTableWithApi(tableId, confirmDeletion);
        },
        [removeTable, deleteTableWithApi, confirmDeletion]
    );
};
