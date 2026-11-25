import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    closeProjetConflictDialog: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/use-dialog', () => ({
    useDialog: () => ({
        closeProjetConflictDialog: mocks.closeProjetConflictDialog,
    }),
}));

import { ProjetConflictDialog } from '../projet-conflict-dialog';

const renderDialog = () => {
    const onChoose = vi.fn();
    render(
        <ProjetConflictDialog
            dialog={{ open: true }}
            projetName="Boutique"
            onChoose={onChoose}
        />
    );
    return { onChoose };
};

describe('ProjetConflictDialog', () => {
    beforeEach(() => {
        mocks.closeProjetConflictDialog.mockReset();
    });

    it('choisit la version du serveur sur clic explicite', () => {
        const { onChoose } = renderDialog();
        fireEvent.click(
            screen.getByRole('button', {
                name: 'projet_conflict_dialog.use_server',
            })
        );
        expect(onChoose).toHaveBeenCalledWith('server');
        expect(mocks.closeProjetConflictDialog).toHaveBeenCalled();
    });

    it('garde la version locale', () => {
        const { onChoose } = renderDialog();
        fireEvent.click(
            screen.getByRole('button', {
                name: 'projet_conflict_dialog.keep_local',
            })
        );
        expect(onChoose).toHaveBeenCalledWith('local');
    });

    it('Échap garde la version locale (aucun écrasement)', () => {
        const { onChoose } = renderDialog();
        fireEvent.keyDown(document.activeElement ?? document.body, {
            key: 'Escape',
        });
        expect(onChoose).toHaveBeenCalledWith('local');
        expect(onChoose).not.toHaveBeenCalledWith('server');
    });
});
