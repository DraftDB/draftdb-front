import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TableLinks } from '@/lib/api/tables-api';

export interface TableLinksListProps {
    /** Liens renvoyés par le serveur (409) : des ids, pas des noms. */
    links: TableLinks;
    /** Résout l'id d'une table en nom, pour l'affichage seulement. */
    getTableName?: (tableId: string) => string | undefined;
}

export const TableLinksList: React.FC<TableLinksListProps> = ({
    links,
    getTableName,
}) => {
    const { t } = useTranslation();
    const tableLabel = (tableId: string) => getTableName?.(tableId) ?? tableId;

    const { cles_etrangeres: foreignKeys, index: indexes } = links;

    if (foreignKeys.length === 0 && indexes.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                {t('api_errors.table_delete.no_links')}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-3 text-sm">
            {foreignKeys.length > 0 ? (
                <section>
                    <h4 className="mb-1 font-medium text-foreground">
                        {t('api_errors.table_delete.foreign_keys')}
                    </h4>
                    <ul className="list-disc pl-5 text-muted-foreground">
                        {foreignKeys.map((foreignKey) => (
                            <li key={foreignKey.id}>
                                {`${foreignKey.name} (${tableLabel(foreignKey.sourceTableId)} → ${tableLabel(foreignKey.targetTableId)})`}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
            {indexes.length > 0 ? (
                <section>
                    <h4 className="mb-1 font-medium text-foreground">
                        {t('api_errors.table_delete.indexes')}
                    </h4>
                    <ul className="list-disc pl-5 text-muted-foreground">
                        {indexes.map((index) => (
                            <li key={index.id}>{index.name}</li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    );
};
