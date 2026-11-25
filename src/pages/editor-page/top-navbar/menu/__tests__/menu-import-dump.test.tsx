import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as RouterModule from 'react-router-dom';

const mocks = vi.hoisted(() => ({
    apiConfigured: false,
    openImportDumpDialog: vi.fn(),
    openImportDatabaseDialog: vi.fn(),
    openImportDiagramDialog: vi.fn(),
}));

vi.mock('@/lib/api/http-client', () => ({
    isApiConfigured: () => mocks.apiConfigured,
}));
vi.mock('@/hooks/use-chartdb', () => ({
    useChartDB: () => ({
        clearDiagramData: vi.fn(),
        deleteDiagram: vi.fn(),
        updateDiagramUpdatedAt: vi.fn(),
        databaseType: 'generic',
    }),
}));
vi.mock('@/hooks/use-dialog', () => ({
    useDialog: () => ({
        openCreateDiagramDialog: vi.fn(),
        openOpenDiagramDialog: vi.fn(),
        openExportSQLDialog: vi.fn(),
        openImportDatabaseDialog: mocks.openImportDatabaseDialog,
        openExportImageDialog: vi.fn(),
        openExportDiagramDialog: vi.fn(),
        openImportDiagramDialog: mocks.openImportDiagramDialog,
        openImportDumpDialog: mocks.openImportDumpDialog,
    }),
}));
vi.mock('@/hooks/use-export-image', () => ({
    useExportImage: () => ({ exportImage: vi.fn() }),
}));
vi.mock('@/hooks/use-history', () => ({
    useHistory: () => ({
        redo: vi.fn(),
        undo: vi.fn(),
        hasRedo: false,
        hasUndo: false,
    }),
}));
vi.mock('@/hooks/use-layout', () => ({
    useLayout: () => ({
        hideSidePanel: vi.fn(),
        showSidePanel: vi.fn(),
        isSidePanelShowed: true,
    }),
}));
vi.mock('@/hooks/use-theme', () => ({
    useTheme: () => ({ setTheme: vi.fn(), theme: 'light' }),
}));
vi.mock('@/hooks/use-local-config', () => ({
    useLocalConfig: () => ({
        scrollAction: 'pan',
        setScrollAction: vi.fn(),
        showCardinality: true,
        setShowCardinality: vi.fn(),
        showFieldAttributes: true,
        setShowFieldAttributes: vi.fn(),
        showMiniMapOnCanvas: true,
        setShowMiniMapOnCanvas: vi.fn(),
        showDBViews: false,
        setShowDBViews: vi.fn(),
    }),
}));
vi.mock('@/context/alert-context/alert-context', () => ({
    useAlert: () => ({ showAlert: vi.fn() }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof RouterModule>()),
    useNavigate: () => vi.fn(),
}));
// i18next n'est pas initialisé dans les tests : `t` renvoie la clé.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { Menu } from '../menu';

const user = userEvent.setup({ pointerEventsCheck: 0 });

/** Ouvre Actions, puis le sous-menu Importer. */
const openImportSubmenu = async () => {
    render(<Menu />);
    await user.click(screen.getByText('menu.actions.actions'));
    await user.click(await screen.findByText('menu.actions.import'));
    await screen.findByText('DBML');
};

describe('Menu > Importer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.apiConfigured = false;
    });

    it('sans API : seulement .json, SQL et DBML, comme ChartDB', async () => {
        mocks.apiConfigured = false;
        await openImportSubmenu();

        expect(screen.getByText('.json')).toBeInTheDocument();
        expect(screen.getByText('SQL')).toBeInTheDocument();
        expect(screen.getByText('DBML')).toBeInTheDocument();
        expect(screen.queryByText('import_dump_dialog.menu_item')).toBeNull();
    });

    it('avec API : l’entrée « Dump SQL (serveur) » est affichée en plus', async () => {
        mocks.apiConfigured = true;
        await openImportSubmenu();

        expect(screen.getByText('.json')).toBeInTheDocument();
        expect(screen.getByText('SQL')).toBeInTheDocument();
        expect(screen.getByText('DBML')).toBeInTheDocument();
        expect(
            screen.getByText('import_dump_dialog.menu_item')
        ).toBeInTheDocument();
    });

    it('avec API : l’entrée ouvre le dialogue d’import de dump, et rien d’autre', async () => {
        mocks.apiConfigured = true;
        await openImportSubmenu();

        // Sans géométrie (happy-dom), le déplacement du pointeur referme le
        // sous-menu Radix : on déclenche directement le clic.
        fireEvent.click(screen.getByText('import_dump_dialog.menu_item'));

        expect(mocks.openImportDumpDialog).toHaveBeenCalledTimes(1);
        expect(mocks.openImportDatabaseDialog).not.toHaveBeenCalled();
        expect(mocks.openImportDiagramDialog).not.toHaveBeenCalled();
    });

    it('les entrées d’origine ouvrent toujours les dialogues ChartDB', async () => {
        mocks.apiConfigured = true;
        await openImportSubmenu();

        fireEvent.click(screen.getByText('SQL'));

        expect(mocks.openImportDatabaseDialog).toHaveBeenCalledTimes(1);
        expect(mocks.openImportDatabaseDialog).toHaveBeenCalledWith(
            expect.objectContaining({ initialImportMethod: 'ddl' })
        );
        expect(mocks.openImportDumpDialog).not.toHaveBeenCalled();
    });
});
