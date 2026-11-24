import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TableLinks } from '@/lib/api/tables-api';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { TableLinksList } from '../table-links-list';

const fk = {
    id: 'r1',
    name: 'fk_orders_users',
    sourceTableId: 'id_orders',
    targetTableId: 'id_users',
    sourceFieldId: 'f1',
    targetFieldId: 'f2',
};

const withLinks = (overrides: Partial<TableLinks> = {}): TableLinks => ({
    cles_etrangeres: [fk],
    index: [{ id: 'i1', name: 'idx_orders' }],
    ...overrides,
});

const names: Record<string, string> = {
    id_orders: 'orders',
    id_users: 'users',
};

describe('TableLinksList', () => {
    it('affiche « name (source → cible) » avec les noms résolus', () => {
        render(
            <TableLinksList
                links={withLinks()}
                getTableName={(id) => names[id]}
            />
        );

        expect(
            screen.getByText('fk_orders_users (orders → users)')
        ).toBeTruthy();
        expect(screen.getByText('idx_orders')).toBeTruthy();
        expect(
            screen.getByText('api_errors.table_delete.foreign_keys')
        ).toBeTruthy();
        expect(
            screen.getByText('api_errors.table_delete.indexes')
        ).toBeTruthy();
        expect(
            screen.queryByText('api_errors.table_delete.no_links')
        ).toBeNull();
    });

    it('se replie sur l’id si getTableName est absent', () => {
        render(<TableLinksList links={withLinks()} />);

        expect(
            screen.getByText('fk_orders_users (id_orders → id_users)')
        ).toBeTruthy();
    });

    it('se replie sur l’id pour une table inconnue (getTableName renvoie undefined)', () => {
        render(
            <TableLinksList
                links={withLinks()}
                getTableName={(id) => (id === 'id_users' ? 'users' : undefined)}
            />
        );

        expect(
            screen.getByText('fk_orders_users (id_orders → users)')
        ).toBeTruthy();
    });

    it('sans aucun lien : affiche no_links, aucune section', () => {
        render(
            <TableLinksList
                links={{ cles_etrangeres: [], index: [] }}
                getTableName={(id) => names[id]}
            />
        );

        expect(
            screen.getByText('api_errors.table_delete.no_links')
        ).toBeTruthy();
        expect(
            screen.queryByText('api_errors.table_delete.foreign_keys')
        ).toBeNull();
        expect(
            screen.queryByText('api_errors.table_delete.indexes')
        ).toBeNull();
    });

    it('masque la section Index quand elle est vide', () => {
        render(<TableLinksList links={withLinks({ index: [] })} />);

        expect(
            screen.getByText('api_errors.table_delete.foreign_keys')
        ).toBeTruthy();
        expect(
            screen.queryByText('api_errors.table_delete.indexes')
        ).toBeNull();
        expect(
            screen.queryByText('api_errors.table_delete.no_links')
        ).toBeNull();
    });

    it('masque la section Clés étrangères quand elle est vide', () => {
        render(<TableLinksList links={withLinks({ cles_etrangeres: [] })} />);

        expect(
            screen.getByText('api_errors.table_delete.indexes')
        ).toBeTruthy();
        expect(
            screen.queryByText('api_errors.table_delete.foreign_keys')
        ).toBeNull();
        expect(
            screen.queryByText('api_errors.table_delete.no_links')
        ).toBeNull();
    });
});
