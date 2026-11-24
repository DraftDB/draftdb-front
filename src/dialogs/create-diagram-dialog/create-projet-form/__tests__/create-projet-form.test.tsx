import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    creerProjet: vi.fn(),
    addDiagram: vi.fn(),
    updateConfig: vi.fn(),
    closeCreateDiagramDialog: vi.fn(),
    navigate: vi.fn(),
    toast: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/use-storage', () => ({
    useStorage: () => ({ addDiagram: mocks.addDiagram }),
}));
vi.mock('@/hooks/use-config', () => ({
    useConfig: () => ({ updateConfig: mocks.updateConfig }),
}));
vi.mock('@/hooks/use-dialog', () => ({
    useDialog: () => ({
        closeCreateDiagramDialog: mocks.closeCreateDiagramDialog,
    }),
}));
vi.mock('@/components/toast/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@/lib/api/projets-api', async (importOriginal) => ({
    ...(await importOriginal<typeof ProjetsApi>()),
    creerProjet: mocks.creerProjet,
}));
// Le contenu de dialogue Radix exige un parent Dialog : on le remplace.
vi.mock('@/components/dialog/dialog', () => ({
    DialogHeader: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
        <h2>{children}</h2>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
        <p>{children}</p>
    ),
    DialogInternalContent: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    DialogFooter: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    DialogClose: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
    ),
}));

import type * as ProjetsApi from '@/lib/api/projets-api';
import { ApiError } from '@/lib/api/http-client';
import { CreateProjetForm } from '../create-projet-form';

const ID = '3f2b8c1e-0000-4000-8000-000000000001';
const projet = {
    id_projet: ID,
    nom: 'Boutique',
    description: null,
    type_base: 'generic',
    numero_sequence: 0,
};

const nomInput = () => screen.getByLabelText('new_project_form.name_label');
const descInput = () =>
    screen.getByLabelText('new_project_form.description_label');
const submit = () =>
    screen.getByRole('button', { name: 'new_project_form.create' });

const renderForm = () => render(<CreateProjetForm hasExistingDiagram={true} />);

describe('CreateProjetForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addDiagram.mockResolvedValue(undefined);
        mocks.updateConfig.mockResolvedValue(undefined);
    });

    it('nom vide : aucun appel réseau, erreur sur le champ', () => {
        renderForm();
        fireEvent.click(submit());
        expect(mocks.creerProjet).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toBe(
            'new_project_form.errors.required'
        );
    });

    it('nom trop long : aucun appel réseau, erreur sur le champ', () => {
        renderForm();
        fireEvent.change(nomInput(), { target: { value: 'a'.repeat(101) } });
        fireEvent.click(submit());
        expect(mocks.creerProjet).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toBe(
            'new_project_form.errors.name_too_long'
        );
    });

    it('description trop longue : aucun appel réseau', () => {
        renderForm();
        fireEvent.change(nomInput(), { target: { value: 'Boutique' } });
        fireEvent.change(descInput(), { target: { value: 'd'.repeat(501) } });
        fireEvent.click(submit());
        expect(mocks.creerProjet).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toBe(
            'new_project_form.errors.description_too_long'
        );
    });

    it('succès : crée le diagramme local avec id = id_projet puis navigue', async () => {
        mocks.creerProjet.mockResolvedValue(projet);
        renderForm();
        fireEvent.change(nomInput(), { target: { value: 'Boutique' } });
        fireEvent.change(descInput(), { target: { value: 'Ventes' } });
        fireEvent.click(submit());

        await waitFor(() =>
            expect(mocks.navigate).toHaveBeenCalledWith(`/diagrams/${ID}`)
        );
        expect(mocks.creerProjet).toHaveBeenCalledWith({
            nom: 'Boutique',
            description: 'Ventes',
        });
        const { diagram } = mocks.addDiagram.mock.calls[0][0];
        expect(diagram).toMatchObject({
            id: ID,
            name: 'Boutique',
            databaseType: 'generic',
        });
        expect(diagram.tables).toBeUndefined();
        expect(mocks.updateConfig).toHaveBeenCalledWith({
            config: { defaultDiagramId: ID },
        });
        expect(mocks.closeCreateDiagramDialog).toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
    });

    it.each([
        [401, { detail: 'Non identifié' }, 'api_errors.projet.unauthenticated'],
        [
            422,
            { detail: [{ loc: ['body', 'nom'], msg: 'Trop long' }] },
            'Trop long (nom)',
        ],
        [0, undefined, 'api_errors.projet.network'],
        [500, undefined, 'api_errors.projet.unknown'],
    ])(
        'erreur %i : toast destructif, rien créé en local',
        async (status, details, description) => {
            mocks.creerProjet.mockRejectedValue(
                new ApiError({ status, message: `HTTP ${status}`, details })
            );
            renderForm();
            fireEvent.change(nomInput(), { target: { value: 'Boutique' } });
            fireEvent.click(submit());

            await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
            expect(mocks.toast).toHaveBeenCalledWith(
                expect.objectContaining({
                    variant: 'destructive',
                    title: 'api_errors.projet.title',
                    description,
                })
            );
            expect(mocks.addDiagram).not.toHaveBeenCalled();
            expect(mocks.navigate).not.toHaveBeenCalled();
            await waitFor(() => expect(submit()).not.toBeDisabled());
        }
    );

    it('API réussie mais Dexie en échec : erreur explicite, pas de navigation', async () => {
        mocks.creerProjet.mockResolvedValue(projet);
        mocks.addDiagram.mockRejectedValue(new Error('quota'));
        renderForm();
        fireEvent.change(nomInput(), { target: { value: 'Boutique' } });
        fireEvent.click(submit());

        await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({
                variant: 'destructive',
                description: 'api_errors.projet.local_storage',
            })
        );
        expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it('double soumission : un seul appel, bouton désactivé pendant l’envoi', async () => {
        let resolve: (v: unknown) => void = () => {};
        mocks.creerProjet.mockReturnValue(
            new Promise((r) => {
                resolve = r;
            })
        );
        renderForm();
        fireEvent.change(nomInput(), { target: { value: 'Boutique' } });
        const form = nomInput().closest('form') as HTMLFormElement;
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(mocks.creerProjet).toHaveBeenCalledTimes(1);
        expect(
            screen.getByRole('button', { name: 'new_project_form.creating' })
        ).toBeDisabled();

        await act(async () => {
            resolve(projet);
        });
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    });

    it('deux projets de même nom : deux appels, deux ids distincts', async () => {
        mocks.creerProjet
            .mockResolvedValueOnce(projet)
            .mockResolvedValueOnce({ ...projet, id_projet: 'autre-id' });
        const first = renderForm();
        fireEvent.change(nomInput(), { target: { value: 'Boutique' } });
        fireEvent.click(submit());
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
        first.unmount();

        renderForm();
        fireEvent.change(nomInput(), { target: { value: 'Boutique' } });
        fireEvent.click(submit());
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(2));
        expect(mocks.addDiagram.mock.calls.map((c) => c[0].diagram.id)).toEqual(
            [ID, 'autre-id']
        );
    });
});
