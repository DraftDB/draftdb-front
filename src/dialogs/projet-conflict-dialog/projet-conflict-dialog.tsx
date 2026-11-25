import React, { useCallback } from 'react';
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
import type { BaseDialogProps } from '../common/base-dialog-props';

export type ProjetConflictChoice = 'server' | 'local';

export interface ProjetConflictDialogProps extends BaseDialogProps {
    projetName: string;
    onChoose: (choice: ProjetConflictChoice) => void;
}

/**
 * Copie locale différente du serveur : l'utilisateur choisit la version à
 * ouvrir. Fermer la boîte (Échap, clic extérieur, croix) revient à garder la
 * version locale : aucun écrasement sans clic explicite.
 */
export const ProjetConflictDialog: React.FC<ProjetConflictDialogProps> = ({
    dialog,
    projetName,
    onChoose,
}) => {
    const { t } = useTranslation();
    const { closeProjetConflictDialog } = useDialog();

    const choose = useCallback(
        (choice: ProjetConflictChoice) => {
            onChoose(choice);
            closeProjetConflictDialog();
        },
        [onChoose, closeProjetConflictDialog]
    );

    return (
        <Dialog
            {...dialog}
            onOpenChange={(open) => {
                if (!open) {
                    choose('local');
                }

                setTimeout(() => (document.body.style.pointerEvents = ''), 500);
            }}
        >
            <DialogContent className="flex flex-col" showClose>
                <DialogHeader>
                    <DialogTitle>
                        {t('projet_conflict_dialog.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('projet_conflict_dialog.description', {
                            name: projetName,
                        })}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex gap-1 md:justify-between">
                    <Button variant="secondary" onClick={() => choose('local')}>
                        {t('projet_conflict_dialog.keep_local')}
                    </Button>
                    <Button onClick={() => choose('server')}>
                        {t('projet_conflict_dialog.use_server')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
