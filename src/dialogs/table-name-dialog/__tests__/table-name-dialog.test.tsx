import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    closeTableNameDialog: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/use-dialog', () => ({
    useDialog: () => ({ closeTableNameDialog: mocks.closeTableNameDialog }),
}));

import { TableNameDialog } from '../table-name-dialog';

const tables = [
    { name: 'users', schema: 'public' },
    { name: 'orders', schema: 'sales' },
];

const renderDialog = (
    props: Partial<React.ComponentProps<typeof TableNameDialog>> = {}
) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
        <TableNameDialog
            dialog={{ open: true }}
            isView={false}
            schema="public"
            defaultName="table_1"
            tables={tables}
            onConfirm={onConfirm}
            onCancel={onCancel}
            {...props}
        />
    );
    return { onConfirm, onCancel };
};

const getInput = () => screen.getByRole('textbox') as HTMLInputElement;
const confirmButton = () =>
    screen.getByRole('button', { name: 'table_name_dialog.confirm' });

describe('TableNameDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('propose le nom par défaut', () => {
        renderDialog({ defaultName: 'table_7' });
        expect(getInput().value).toBe('table_7');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(
            screen.getByText('table_name_dialog.table_title')
        ).toBeInTheDocument();
    });

    it('affiche le titre des vues pour une vue', () => {
        renderDialog({ isView: true, defaultName: 'view_1' });
        expect(
            screen.getByText('table_name_dialog.view_title')
        ).toBeInTheDocument();
    });

    it('Entrée valide le nom saisi, sans les espaces autour', () => {
        const { onConfirm, onCancel } = renderDialog();

        fireEvent.change(getInput(), { target: { value: '  customers ' } });
        fireEvent.keyDown(getInput(), { key: 'Enter' });

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledWith('customers');
        expect(onCancel).not.toHaveBeenCalled();
        expect(mocks.closeTableNameDialog).toHaveBeenCalled();
    });

    it('le bouton de confirmation valide aussi le nom', () => {
        const { onConfirm } = renderDialog();
        fireEvent.click(confirmButton());
        expect(onConfirm).toHaveBeenCalledWith('table_1');
    });

    it('refuse un nom vide avec un message', () => {
        const { onConfirm } = renderDialog();

        fireEvent.change(getInput(), { target: { value: '   ' } });

        expect(screen.getByRole('alert')).toHaveTextContent(
            'table_name_dialog.errors.empty'
        );
        expect(confirmButton()).toBeDisabled();
        fireEvent.keyDown(getInput(), { key: 'Enter' });
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('refuse un nom déjà pris dans le même schéma avec un message', () => {
        const { onConfirm } = renderDialog();

        fireEvent.change(getInput(), { target: { value: 'users' } });

        expect(screen.getByRole('alert')).toHaveTextContent(
            'table_name_dialog.errors.taken'
        );
        expect(confirmButton()).toBeDisabled();
        fireEvent.keyDown(getInput(), { key: 'Enter' });
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('accepte le même nom dans un autre schéma et avec une autre casse', () => {
        const { onConfirm } = renderDialog({ schema: 'sales' });

        fireEvent.change(getInput(), { target: { value: 'users' } });
        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.change(getInput(), { target: { value: 'Orders' } });
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.keyDown(getInput(), { key: 'Enter' });
        expect(onConfirm).toHaveBeenCalledWith('Orders');
    });

    it('refuse un nom de plus de 63 caractères avec un message', () => {
        const { onConfirm } = renderDialog();

        fireEvent.change(getInput(), { target: { value: 'a'.repeat(64) } });

        expect(screen.getByRole('alert')).toHaveTextContent(
            'table_name_dialog.errors.too_long'
        );
        expect(confirmButton()).toBeDisabled();
        fireEvent.keyDown(getInput(), { key: 'Enter' });
        expect(onConfirm).not.toHaveBeenCalled();

        fireEvent.change(getInput(), { target: { value: 'a'.repeat(63) } });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('Annuler appelle onCancel sans valider', () => {
        const { onConfirm, onCancel } = renderDialog();

        fireEvent.click(
            screen.getByRole('button', { name: 'table_name_dialog.cancel' })
        );

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
        expect(mocks.closeTableNameDialog).toHaveBeenCalled();
    });
});
