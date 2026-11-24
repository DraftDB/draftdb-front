import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { alertContext } from '@/context/alert-context/alert-context';
import { BaseAlertDialog } from '../base-alert-dialog';

const closeAlert = vi.fn();
const onAction = vi.fn();
const onClose = vi.fn();

const renderDialog = () =>
    render(
        <alertContext.Provider value={{ showAlert: vi.fn(), closeAlert }}>
            <BaseAlertDialog
                dialog={{ open: true }}
                title="Titre"
                actionLabel="Supprimer"
                closeLabel="Annuler"
                onAction={onAction}
                onClose={onClose}
            />
        </alertContext.Provider>
    );

describe('BaseAlertDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Échap appelle onClose (la promesse de confirmation ne reste pas en suspens)', async () => {
        renderDialog();

        await userEvent.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onAction).not.toHaveBeenCalled();
        expect(closeAlert).toHaveBeenCalled();
    });

    it('le bouton Annuler appelle onClose une seule fois', async () => {
        renderDialog();

        await userEvent.click(screen.getByText('Annuler'));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onAction).not.toHaveBeenCalled();
    });

    it('le bouton Supprimer appelle onAction, sans onClose même si Radix rappelle onOpenChange(false)', async () => {
        renderDialog();

        await userEvent.click(screen.getByText('Supprimer'));

        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('action puis Échap : onClose n’est pas exécuté après onAction', async () => {
        renderDialog();

        await userEvent.click(screen.getByText('Supprimer'));
        await userEvent.keyboard('{Escape}');

        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });
});
