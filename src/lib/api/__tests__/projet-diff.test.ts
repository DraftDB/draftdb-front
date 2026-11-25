import { describe, expect, it } from 'vitest';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import type { DBTable } from '@/lib/domain/db-table';
import { isSameDiagramContent } from '../projet-diff';

const makeTable = (): DBTable => ({
    id: 't1',
    name: 'users',
    schema: 'public',
    x: 10,
    y: 20,
    color: '#8eb7ff',
    isView: false,
    createdAt: 1,
    order: 0,
    fields: [
        {
            id: 'f-id',
            name: 'id',
            type: { id: 'integer', name: 'integer' },
            primaryKey: true,
            unique: true,
            nullable: false,
            createdAt: 1,
        },
        {
            id: 'f-email',
            name: 'email',
            type: { id: 'varchar', name: 'varchar' },
            primaryKey: false,
            unique: false,
            nullable: true,
            characterMaximumLength: '255',
            createdAt: 2,
        },
    ],
    indexes: [
        {
            id: 'i-pk',
            name: '',
            unique: true,
            fieldIds: ['f-id'],
            isPrimaryKey: true,
            createdAt: 1,
        },
        {
            id: 'i-email',
            name: 'idx_email',
            unique: true,
            fieldIds: ['f-email'],
            createdAt: 1,
        },
    ],
});

const makeDiagram = (): Diagram => ({
    id: 'p1',
    name: 'Boutique',
    databaseType: DatabaseType.POSTGRESQL,
    tables: [
        makeTable(),
        { ...makeTable(), id: 't2', name: 'orders', fields: [], indexes: [] },
    ],
    relationships: [
        {
            id: 'r1',
            name: 'fk_orders_users',
            sourceTableId: 't2',
            targetTableId: 't1',
            sourceFieldId: 'f-x',
            targetFieldId: 'f-id',
            sourceCardinality: 'many',
            targetCardinality: 'one',
            createdAt: 1,
        },
    ],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
});

const editTable = (
    diagram: Diagram,
    edit: (table: DBTable) => DBTable
): Diagram => ({
    ...diagram,
    tables: diagram.tables?.map((t) => (t.id === 't1' ? edit(t) : t)),
});

describe('isSameDiagramContent', () => {
    it('ignore positions, couleurs, largeur, ordre d’affichage et dates', () => {
        const local = makeDiagram();
        const server = editTable(
            {
                ...makeDiagram(),
                createdAt: new Date('2030-01-01'),
                updatedAt: new Date('2030-01-01'),
                notes: [],
                areas: [],
            },
            (t) => ({
                ...t,
                x: 999,
                y: -5,
                width: 400,
                color: '#000000',
                order: 7,
                createdAt: 123,
                fields: t.fields.map((f) => ({ ...f, createdAt: 456 })),
            })
        );
        expect(isSameDiagramContent(local, server)).toBe(true);
    });

    it('ignore l’ordre des tables, index et relations dans les tableaux', () => {
        const local = makeDiagram();
        const server = editTable(
            { ...makeDiagram(), tables: [...makeDiagram().tables!].reverse() },
            (t) => ({ ...t, indexes: [...t.indexes].reverse() })
        );
        expect(isSameDiagramContent(local, server)).toBe(true);
    });

    it('confond null, undefined et chaîne vide', () => {
        const local = editTable(makeDiagram(), (t) => ({
            ...t,
            comments: '',
            fields: t.fields.map((f) => ({ ...f, default: null })),
        }));
        const server = editTable(makeDiagram(), (t) => ({
            ...t,
            comments: undefined,
        }));
        expect(isSameDiagramContent(local, server)).toBe(true);
    });

    it('ne compare pas le nom de l’index de clé primaire (renommé par le back)', () => {
        const server = editTable(makeDiagram(), (t) => ({
            ...t,
            indexes: t.indexes.map((i) =>
                i.isPrimaryKey ? { ...i, name: 'users_pkey' } : i
            ),
        }));
        expect(isSameDiagramContent(makeDiagram(), server)).toBe(true);
    });

    it('détecte un nom de diagramme différent', () => {
        expect(
            isSameDiagramContent(makeDiagram(), {
                ...makeDiagram(),
                name: 'Autre',
            })
        ).toBe(false);
    });

    it('détecte une table ajoutée ou renommée', () => {
        const added = {
            ...makeDiagram(),
            tables: [...makeDiagram().tables!, { ...makeTable(), id: 't3' }],
        };
        expect(isSameDiagramContent(makeDiagram(), added)).toBe(false);
        const renamed = editTable(makeDiagram(), (t) => ({
            ...t,
            name: 'clients',
        }));
        expect(isSameDiagramContent(makeDiagram(), renamed)).toBe(false);
    });

    it('détecte une colonne ajoutée, modifiée ou déplacée', () => {
        const added = editTable(makeDiagram(), (t) => ({
            ...t,
            fields: [...t.fields, { ...t.fields[1], id: 'f-new' }],
        }));
        const typed = editTable(makeDiagram(), (t) => ({
            ...t,
            fields: t.fields.map((f) =>
                f.id === 'f-email'
                    ? { ...f, type: { id: 'text', name: 'text' } }
                    : f
            ),
        }));
        const nullable = editTable(makeDiagram(), (t) => ({
            ...t,
            fields: t.fields.map((f) =>
                f.id === 'f-email' ? { ...f, nullable: false } : f
            ),
        }));
        const moved = editTable(makeDiagram(), (t) => ({
            ...t,
            fields: [...t.fields].reverse(),
        }));
        for (const server of [added, typed, nullable, moved]) {
            expect(isSameDiagramContent(makeDiagram(), server)).toBe(false);
        }
    });

    it('détecte un index modifié', () => {
        const server = editTable(makeDiagram(), (t) => ({
            ...t,
            indexes: t.indexes.map((i) =>
                i.id === 'i-email' ? { ...i, unique: false } : i
            ),
        }));
        expect(isSameDiagramContent(makeDiagram(), server)).toBe(false);
    });

    it('détecte une relation ajoutée, supprimée ou modifiée', () => {
        const base = makeDiagram();
        const removed = { ...base, relationships: [] };
        const changed = {
            ...base,
            relationships: base.relationships!.map((r) => ({
                ...r,
                sourceCardinality: 'one' as const,
            })),
        };
        expect(isSameDiagramContent(base, removed)).toBe(false);
        expect(isSameDiagramContent(base, changed)).toBe(false);
    });
});
