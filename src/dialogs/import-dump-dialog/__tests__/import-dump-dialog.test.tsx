import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ImportApiModule from '@/lib/api/import-api';
import type { ImportDumpRequest } from '@/lib/api/import-api';
import type { Diagram } from '@/lib/domain/diagram';

const mocks = vi.hoisted(() => ({
    postImportMock: vi.fn(),
    updateDiagramDataMock: vi.fn(),
    closeMock: vi.fn(),
    currentDiagram: {
        id: 'diagram-courant',
        name: 'Mon projet',
        databaseType: 'generic',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
    },
}));

vi.mock('@/lib/api/import-api', async (importOriginal) => ({
    ...(await importOriginal<typeof ImportApiModule>()),
    postImport: mocks.postImportMock,
}));
vi.mock('@/hooks/use-chartdb', () => ({
    useChartDB: () => ({
        currentDiagram: mocks.currentDiagram,
        diagramId: mocks.currentDiagram.id,
        updateDiagramData: mocks.updateDiagramDataMock,
    }),
}));
vi.mock('@/hooks/use-dialog', () => ({
    useDialog: () => ({ closeImportDumpDialog: mocks.closeMock }),
}));
// i18next n'est pas initialisé dans les tests : `t` renvoie la clé, suivie des
// valeurs des options (count, sequence…) quand il y en a.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            options && Object.keys(options).length > 0
                ? `${key}:${Object.values(options).join(',')}`
                : key,
    }),
}));

import { ApiError } from '@/lib/api/http-client';
import { ImportDumpDialog } from '../import-dump-dialog';

// Un dump qui se détecte tout seul (ENGINE=InnoDB → MySQL).
const MYSQL_LINES = [
    'CREATE TABLE `clients` (',
    '  `id` int NOT NULL AUTO_INCREMENT,',
    '  `email` varchar(255) NOT NULL,',
    '  PRIMARY KEY (`id`)',
    ') ENGINE=InnoDB;',
    'CREATE TABLE `commandes` (',
    '  `id` int NOT NULL AUTO_INCREMENT,',
    '  `client_id` int NOT NULL,',
    '  PRIMARY KEY (`id`),',
    '  CONSTRAINT `fk_cmd_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`)',
    ') ENGINE=InnoDB;',
    "INSERT INTO `clients` VALUES (1,'marie.dupont@example.org');",
];
const MYSQL_DUMP = MYSQL_LINES.join('\n');
const INSERT_LINE = MYSQL_LINES.findIndex((l) => l.startsWith('INSERT')) + 1;

const CREATED = {
    id_import: 'imp-1',
    numero_sequence: 7,
    nb_elements_crees: 5,
};

const apiError = (status: number, details?: unknown, code?: string) =>
    new ApiError({ status, code, message: `HTTP ${status}`, details });

const conflict = (count = 4) =>
    apiError(
        409,
        {
            detail: {
                code: 'CONFIRMATION_REQUISE',
                nb_tables_existantes: count,
            },
        },
        'CONFIRMATION_REQUISE'
    );

const user = userEvent.setup({ pointerEventsCheck: 0 });

const importButton = () =>
    screen.getByRole('button', { name: 'import_dump_dialog.import' });
const button = (key: string) =>
    screen.getByRole('button', { name: `import_dump_dialog.${key}` });

const upload = async (content: string, name = 'dump.sql') => {
    const input = document.querySelector(
        'input[type=file]'
    ) as HTMLInputElement;
    await user.upload(
        input,
        new File([content], name, { type: 'application/sql' })
    );
};

const renderDialog = () => render(<ImportDumpDialog dialog={{ open: true }} />);

/** Rend le dialogue, choisit le fichier et attend que Importer soit actif. */
const openWithFile = async (content = MYSQL_DUMP, name = 'dump.sql') => {
    renderDialog();
    await upload(content, name);
    await waitFor(() => expect(importButton()).toBeEnabled());
};

const sentRequest = (call = 0): ImportDumpRequest =>
    mocks.postImportMock.mock.calls[call][1];

describe('ImportDumpDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.postImportMock.mockReset();
        mocks.postImportMock.mockResolvedValue(CREATED);
        mocks.updateDiagramDataMock.mockReset();
        mocks.updateDiagramDataMock.mockResolvedValue(undefined);
    });

    describe('(a) import réussi', () => {
        it('envoie le diagramme, puis remplace le schéma local et affiche le résultat', async () => {
            await openWithFile();
            await user.click(importButton());

            await screen.findByText('import_dump_dialog.success_title');

            expect(mocks.postImportMock).toHaveBeenCalledTimes(1);
            expect(mocks.postImportMock.mock.calls[0][0]).toBe(
                'diagram-courant'
            );
            const request = sentRequest();
            expect(request.confirme_remplacement).toBe(false);
            expect(request.fichier).toEqual({
                nom: 'dump.sql',
                dialecte: 'mysql',
                taille_octets: new File([MYSQL_DUMP], 'x').size,
            });
            expect(request.diagramme.id).toBe('diagram-courant');
            expect(request.diagramme.name).toBe('Mon projet');
            expect(request.diagramme.tables).toHaveLength(2);
            expect(request.rapport.non_repris).toEqual([
                expect.objectContaining({ ligne: INSERT_LINE, type: 'INSERT' }),
            ]);
            // RG-24 : aucune donnée du dump dans ce qui part vers le serveur.
            const json = JSON.stringify(request.rapport);
            expect(json).not.toContain('marie');
            expect(json).not.toContain('example.org');
            expect(Object.keys(request.rapport.non_repris[0]).sort()).toEqual([
                'ligne',
                'raison',
                'type',
            ]);

            // Le schéma local n'est remplacé qu'après le 201.
            expect(mocks.updateDiagramDataMock).toHaveBeenCalledTimes(1);
            expect(
                mocks.postImportMock.mock.invocationCallOrder[0]
            ).toBeLessThan(
                mocks.updateDiagramDataMock.mock.invocationCallOrder[0]
            );
            const local = mocks.updateDiagramDataMock.mock.calls[0][0];
            expect(local.id).toBe('diagram-courant');
            expect(local.databaseType).toBe('mysql');

            // Étape done : éléments créés, numéro de séquence, rapport.
            expect(
                screen.getByText('import_dump_dialog.success_description:5,7')
            ).toBeInTheDocument();
            expect(
                screen.getByText('import_dump_dialog.report_summary:1')
            ).toBeInTheDocument();
            expect(screen.getByText('INSERT')).toBeInTheDocument();
            expect(
                screen.getByRole('button', { name: 'import_dump_dialog.close' })
            ).toBeInTheDocument();
        });
    });

    describe('(b) 409 puis Remplacer', () => {
        it('renvoie la MÊME requête avec confirme_remplacement: true', async () => {
            mocks.postImportMock.mockRejectedValueOnce(conflict(4));
            await openWithFile();
            await user.click(importButton());

            await screen.findByText('import_dump_dialog.confirm_description:4');
            expect(mocks.updateDiagramDataMock).not.toHaveBeenCalled();

            await user.click(button('replace'));
            await screen.findByText('import_dump_dialog.success_title');

            expect(mocks.postImportMock).toHaveBeenCalledTimes(2);
            const first = sentRequest(0);
            const second = sentRequest(1);
            expect(first.confirme_remplacement).toBe(false);
            expect(second.confirme_remplacement).toBe(true);
            // Mêmes identifiants : le 409 n'a rien écrit.
            expect(second.diagramme).toEqual(first.diagramme);
            expect(second.fichier).toEqual(first.fichier);
            expect(second.rapport).toEqual(first.rapport);
            expect(mocks.updateDiagramDataMock).toHaveBeenCalledTimes(1);
        });

        it('texte de repli quand le 409 ne donne pas le nombre de tables', async () => {
            mocks.postImportMock.mockRejectedValueOnce(
                apiError(409, { detail: { code: 'CONFIRMATION_REQUISE' } })
            );
            await openWithFile();
            await user.click(importButton());

            await screen.findByText(
                'import_dump_dialog.confirm_description_unknown'
            );
        });
    });

    describe('(b bis) 409 au second envoi', () => {
        it("s'affiche comme une erreur, sans reboucler sur la confirmation", async () => {
            mocks.postImportMock.mockRejectedValue(conflict(4));
            await openWithFile();
            await user.click(importButton());
            await screen.findByText('import_dump_dialog.confirm_description:4');

            await user.click(button('replace'));

            await screen.findByText('api_errors.import.unknown');
            expect(mocks.postImportMock).toHaveBeenCalledTimes(2);
            expect(mocks.updateDiagramDataMock).not.toHaveBeenCalled();
            // Retour à l'étape select, pas de nouvelle confirmation.
            expect(
                screen.queryByText('import_dump_dialog.confirm_title')
            ).toBeNull();
            expect(
                screen.queryByRole('button', {
                    name: 'import_dump_dialog.replace',
                })
            ).toBeNull();
            expect(importButton()).toBeEnabled();
        });
    });

    describe('(c) 409 puis Annuler', () => {
        it('un seul appel, schéma local intact, fichier conservé', async () => {
            mocks.postImportMock.mockRejectedValueOnce(conflict(4));
            await openWithFile();
            await user.click(importButton());
            await screen.findByText('import_dump_dialog.confirm_description:4');

            await user.click(button('cancel'));

            expect(mocks.postImportMock).toHaveBeenCalledTimes(1);
            expect(mocks.updateDiagramDataMock).not.toHaveBeenCalled();
            // Le FileUploader n'a pas été démonté : Importer reste utilisable.
            expect(importButton()).toBeEnabled();
        });
    });

    describe('(d) SQL inutilisable : rien n’est envoyé', () => {
        it('exception du parser : fichier illisible avec le message, aucun appel', async () => {
            const unreadable = [
                'CREATE TABLE a (',
                '  id INT,',
                '  b INT REFERENCES c (id)',
                ') ENGINE=InnoDB;',
            ].join('\n');
            await openWithFile(unreadable);

            await user.click(importButton());

            await screen.findByText('import_dump_dialog.parse_error_title');
            expect(screen.getByText(/inline REFERENCES/i)).toBeInTheDocument();
            expect(mocks.postImportMock).not.toHaveBeenCalled();
            expect(mocks.updateDiagramDataMock).not.toHaveBeenCalled();
            // L'utilisateur peut choisir un autre fichier ou réessayer.
            expect(importButton()).toBeEnabled();
        });

        it('0 table : message no_tables, aucun appel', async () => {
            await openWithFile('-- ENGINE=InnoDB\nSELECT 1;');

            await user.click(importButton());

            await screen.findByText('import_dump_dialog.no_tables');
            expect(mocks.postImportMock).not.toHaveBeenCalled();
            expect(mocks.updateDiagramDataMock).not.toHaveBeenCalled();
            expect(importButton()).toBeEnabled();
        });

        it('dialecte non détecté : Importer reste désactivé', async () => {
            renderDialog();
            await upload('SELECT 1;');

            await screen.findByText('import_dump_dialog.dialect_required');
            expect(importButton()).toBeDisabled();
        });
    });

    describe('erreurs du serveur', () => {
        it('(e) 403 : texte « responsable », schéma local intact', async () => {
            mocks.postImportMock.mockRejectedValueOnce(
                apiError(403, { detail: 'Seul le responsable du projet' })
            );
            await openWithFile();
            await user.click(importButton());

            await screen.findByText('api_errors.import.forbidden');
            expect(
                screen.getByText('api_errors.import.title')
            ).toBeInTheDocument();
            // Pas de message du serveur hors 422.
            expect(screen.queryByText(/Seul le responsable/)).toBeNull();
            expect(mocks.updateDiagramDataMock).not.toHaveBeenCalled();
        });

        it('(f) 422 avec detail texte : le message du serveur est affiché', async () => {
            mocks.postImportMock.mockRejectedValueOnce(
                apiError(422, {
                    detail: 'Diagramme refusé : identifiant déjà utilisé.',
                })
            );
            await openWithFile();
            await user.click(importButton());

            await screen.findByText('api_errors.import.validation');
            expect(
                screen.getByText('Diagramme refusé : identifiant déjà utilisé.')
            ).toBeInTheDocument();
            expect(mocks.updateDiagramDataMock).not.toHaveBeenCalled();
        });

        it('erreur réseau', async () => {
            mocks.postImportMock.mockRejectedValueOnce(apiError(0));
            await openWithFile();
            await user.click(importButton());

            await screen.findByText('api_errors.import.network');
        });
    });

    describe('(g) anti double envoi', () => {
        it('deux clics dans le même instant : un seul appel', async () => {
            let release: (value: typeof CREATED) => void = () => {};
            mocks.postImportMock.mockReturnValue(
                new Promise((resolve) => {
                    release = resolve;
                })
            );
            await openWithFile();

            // Les deux clics partent avant que React ait réaffiché le bouton
            // désactivé : seul le ref empêche le second envoi.
            const importBtn = importButton();
            act(() => {
                importBtn.click();
                importBtn.click();
            });

            await waitFor(() =>
                expect(mocks.postImportMock).toHaveBeenCalledTimes(1)
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(mocks.postImportMock).toHaveBeenCalledTimes(1);

            await act(async () => {
                release(CREATED);
            });
            await screen.findByText('import_dump_dialog.success_title');
            expect(mocks.postImportMock).toHaveBeenCalledTimes(1);
        });

        it('pas de fermeture du dialogue pendant l’envoi', async () => {
            let release: (value: typeof CREATED) => void = () => {};
            mocks.postImportMock.mockReturnValue(
                new Promise((resolve) => {
                    release = resolve;
                })
            );
            await openWithFile();
            await user.click(importButton());
            await waitFor(() =>
                expect(mocks.postImportMock).toHaveBeenCalledTimes(1)
            );

            await user.keyboard('{Escape}');
            expect(mocks.closeMock).not.toHaveBeenCalled();
            expect(importButton()).toBeDisabled();

            await act(async () => {
                release(CREATED);
            });
            await screen.findByText('import_dump_dialog.success_title');
            await user.keyboard('{Escape}');
            expect(mocks.closeMock).toHaveBeenCalled();
        });
    });

    describe('(h) normalisation avec la sortie réelle du parser', () => {
        it('le corps et l’état local sont le même diagramme normalisé', async () => {
            await openWithFile();
            await user.click(importButton());
            await screen.findByText('import_dump_dialog.success_title');

            const body = sentRequest().diagramme;
            const local = mocks.updateDiagramDataMock.mock
                .calls[0][0] as Diagram;

            for (const table of body.tables) {
                // MySQL : le parser met schema: '' ; le back le refuse.
                expect(table.schema === '').toBe(false);
                expect('schema' in table).toBe(false);
                for (const index of table.indexes) {
                    expect(index.name.trim()).not.toBe('');
                }
                const pk = table.indexes.find((i) => i.isPrimaryKey);
                expect(pk?.name).toBe(`${table.name}_pkey`);
            }

            const summary = (tables: Diagram['tables']) =>
                (tables ?? []).map((t) => ({
                    id: t.id,
                    schema: t.schema,
                    fields: t.fields.map((f) => f.id),
                    indexes: t.indexes.map((i) => [i.id, i.name]),
                }));
            expect(summary(local.tables)).toEqual(summary(body.tables));
            expect(local.tables).toEqual(body.tables);
            expect(local.relationships).toEqual(body.relationships);
        });
    });

    describe('(h bis) pg_dump : lignes client neutralisées avant le parser', () => {
        it('la clé primaire après un COPY est envoyée, le rapport garde COPY et \\restrict', async () => {
            const key = 'CleSecreteRestrict42';
            const pgDump = [
                `\\restrict ${key}`,
                'SET statement_timeout = 0;',
                'CREATE TABLE public.clients (',
                '    id integer NOT NULL,',
                '    email text NOT NULL',
                ');',
                'COPY public.clients (id, email) FROM stdin;',
                '1\tmarie.dupont@example.org',
                '\\.',
                'ALTER TABLE ONLY public.clients',
                '    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);',
                `\\unrestrict ${key}`,
            ].join('\n');
            await openWithFile(pgDump);
            await user.click(importButton());
            await screen.findByText('import_dump_dialog.success_title');

            const request = sentRequest();
            expect(request.fichier.dialecte).toBe('postgresql');
            const local = mocks.updateDiagramDataMock.mock
                .calls[0][0] as Diagram;
            const id = local.tables
                ?.find((t) => t.name === 'clients')
                ?.fields.find((f) => f.name === 'id');
            expect(id?.primaryKey).toBe(true);
            expect(request.diagramme.tables).toEqual(local.tables);

            const types = request.rapport.non_repris.map((e) => e.type);
            expect(types).toEqual(
                expect.arrayContaining(['\\RESTRICT', 'COPY', '\\UNRESTRICT'])
            );
            expect(types).not.toContain('ALTER TABLE');
            const json = JSON.stringify(request.rapport);
            expect(json).not.toContain(key);
            expect(json).not.toContain('marie');
        });
    });

    describe('rapport affiché', () => {
        it('limite l’affichage à 200 entrées avec une mention de troncature', async () => {
            const inserts = Array.from(
                { length: 250 },
                (_, i) => `INSERT INTO \`clients\` VALUES (${i}, 'x');`
            );
            await openWithFile(
                [...MYSQL_LINES.slice(0, 5), ...inserts].join('\n')
            );
            await user.click(importButton());
            await screen.findByText('import_dump_dialog.success_title');

            expect(
                screen.getByText('import_dump_dialog.report_summary:250')
            ).toBeInTheDocument();
            expect(
                screen.getByText('import_dump_dialog.report_truncated:200,250')
            ).toBeInTheDocument();
            // 200 lignes de données + l'en-tête.
            expect(screen.getAllByRole('row')).toHaveLength(201);
        });

        it('rapport vide quand tout est repris', async () => {
            await openWithFile(MYSQL_LINES.slice(0, 11).join('\n'));
            await user.click(importButton());
            await screen.findByText('import_dump_dialog.success_title');

            expect(
                screen.getByText('import_dump_dialog.report_empty')
            ).toBeInTheDocument();
        });
    });
});
