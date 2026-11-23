import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDialog } from '@/hooks/use-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/dialog/dialog';
import { Button } from '@/components/button/button';
import { Input } from '@/components/input/input';
import { Label } from '@/components/label/label';
import type { DBTable } from '@/lib/domain/db-table';
import {
    MAX_TABLE_NAME_LENGTH,
    validateTableName,
} from '@/lib/domain/table-name';
import type { BaseDialogProps } from '../common/base-dialog-props';

export interface TableNameDialogProps extends BaseDialogProps {
    isView: boolean;
    /** Schéma choisi pour la table : la validation s'y limite. */
    schema?: string | null;
    /** Nom proposé à l'ouverture. */
    defaultName: string;
    tables: Pick<DBTable, 'name' | 'schema'>[];
    onConfirm: (name: string) => void;
    onCancel: () => void;
}

export const TableNameDialog: React.FC<TableNameDialogProps> = ({
    dialog,
    isView,
    schema,
    defaultName,
    tables,
    onConfirm,
    onCancel,
}) => {
    const { t } = useTranslation();
    const { closeTableNameDialog } = useDialog();
    const [name, setName] = useState(defaultName);

    useEffect(() => {
        if (dialog.open) {
            setName(defaultName);
        }
    }, [dialog.open, defaultName]);

    const error = useMemo(
        () => validateTableName(name, tables, schema),
        [name, tables, schema]
    );

    const handleConfirm = useCallback(() => {
        if (error) {
            return;
        }
        onConfirm(name.trim());
        closeTableNameDialog();
    }, [error, name, onConfirm, closeTableNameDialog]);

    const handleCancel = useCallback(() => {
        onCancel();
        closeTableNameDialog();
    }, [onCancel, closeTableNameDialog]);

    return (
        <Dialog
            {...dialog}
            onOpenChange={(open) => {
                if (!open) {
                    handleCancel();
                }

                setTimeout(() => (document.body.style.pointerEvents = ''), 500);
            }}
        >
            <DialogContent className="flex flex-col" showClose>
                <DialogHeader>
                    <DialogTitle>
                        {isView
                            ? t('table_name_dialog.view_title')
                            : t('table_name_dialog.table_title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('table_name_dialog.description')}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-1">
                    <Label htmlFor="table-name">
                        {t('table_name_dialog.label')}
                    </Label>
                    <Input
                        id="table-name"
                        value={name}
                        autoFocus
                        autoComplete="off"
                        aria-invalid={error !== null}
                        aria-describedby={
                            error ? 'table-name-error' : undefined
                        }
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                            if (
                                e.key === 'Enter' &&
                                !e.nativeEvent.isComposing
                            ) {
                                e.preventDefault();
                                handleConfirm();
                            }
                        }}
                    />
                    {error ? (
                        <p
                            id="table-name-error"
                            role="alert"
                            className="text-sm text-destructive"
                        >
                            {t(`table_name_dialog.errors.${error}`, {
                                max: MAX_TABLE_NAME_LENGTH,
                            })}
                        </p>
                    ) : null}
                </div>
                <DialogFooter className="flex gap-1 md:justify-between">
                    <Button variant="secondary" onClick={handleCancel}>
                        {t('table_name_dialog.cancel')}
                    </Button>
                    <Button onClick={handleConfirm} disabled={error !== null}>
                        {t('table_name_dialog.confirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
