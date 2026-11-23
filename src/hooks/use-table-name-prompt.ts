import { useCallback } from 'react';
import { useChartDB } from '@/hooks/use-chartdb';
import { useDialog } from '@/hooks/use-dialog';
import { isApiConfigured } from '@/lib/api/http-client';
import { getDefaultTableName } from '@/lib/domain/table-name';

/**
 * Réponse du hook, à répandre dans les attributs de createTable :
 * `{}` (mode local, aucune boîte) ou `{ name }`. Jamais `{ name: undefined }`.
 */
export type TableNameAnswer = { name: string } | Record<string, never>;

export interface TableNamePromptParams {
    isView: boolean;
    /** Schéma effectif de la future table. */
    schema?: string | null;
}

/**
 * Demande le nom d'une nouvelle table avant son envoi à l'API.
 * Résout `null` si l'utilisateur annule. La première réponse prime : valider
 * puis fermer la boîte ne compte pas comme une annulation.
 */
export const useTableNamePrompt = () => {
    const { tables } = useChartDB();
    const { openTableNameDialog } = useDialog();

    return useCallback(
        ({
            isView,
            schema,
        }: TableNamePromptParams): Promise<TableNameAnswer | null> =>
            new Promise((resolve) => {
                if (!isApiConfigured()) {
                    resolve({});
                    return;
                }

                let settled = false;
                const settle = (answer: TableNameAnswer | null) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    resolve(answer);
                };

                openTableNameDialog({
                    isView,
                    schema,
                    tables,
                    defaultName: getDefaultTableName(tables, isView),
                    onConfirm: (name) => settle({ name }),
                    onCancel: () => settle(null),
                });
            }),
        [tables, openTableNameDialog]
    );
};
