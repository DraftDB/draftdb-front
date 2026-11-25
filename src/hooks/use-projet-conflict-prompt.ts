import { useCallback } from 'react';
import { useDialog } from '@/hooks/use-dialog';
import type { ProjetConflictChoice } from '@/dialogs/projet-conflict-dialog/projet-conflict-dialog';

/**
 * Demande quelle version ouvrir quand la copie locale diffère du serveur.
 * La première réponse prime : choisir puis fermer la boîte ne compte pas
 * comme un second choix.
 */
export const useProjetConflictPrompt = () => {
    const { openProjetConflictDialog } = useDialog();

    return useCallback(
        (projetName: string): Promise<ProjetConflictChoice> =>
            new Promise((resolve) => {
                let settled = false;
                openProjetConflictDialog({
                    projetName,
                    onChoose: (choice) => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        resolve(choice);
                    },
                });
            }),
        [openProjetConflictDialog]
    );
};
