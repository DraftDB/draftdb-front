import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
    API_URL: '/',
    USER_ID: '',
    PROJECT_ID: '',
}));

import type { Diagram } from '@/lib/domain/diagram';
import { DatabaseType } from '@/lib/domain/database-type';
import { sqlImportToDiagram } from '@/lib/data/sql-import';
import { toImportDiagram, type ImportDialecte } from '../import-api';

/**
 * Sortie RÉELLE de sqlImportToDiagram, contrôlée contre les règles du back :
 * pas de schéma vide, pas d'index sans nom, ids <= 25, noms <= 63.
 */
const MYSQL_DUMP = `
CREATE TABLE \`clients\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`email\` varchar(255) NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_clients_email\` (\`email\`)
) ENGINE=InnoDB;

CREATE TABLE \`commandes\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`client_id\` int NOT NULL,
  PRIMARY KEY (\`id\`),
  CONSTRAINT \`fk_commandes_client\` FOREIGN KEY (\`client_id\`) REFERENCES \`clients\` (\`id\`)
) ENGINE=InnoDB;
`;

const PG_DUMP = `
SET statement_timeout = 0;
SET client_encoding = 'UTF8';

CREATE TABLE public.clients (
    id integer NOT NULL,
    email character varying(255) NOT NULL
);

CREATE TABLE public.commandes (
    id integer NOT NULL,
    client_id integer NOT NULL
);

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commandes
    ADD CONSTRAINT commandes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commandes
    ADD CONSTRAINT fk_commandes_client FOREIGN KEY (client_id) REFERENCES public.clients(id);
`;

const CURRENT = { id: 'diagramme-courant', name: 'Projet' };

const cases: {
    label: string;
    sql: string;
    dialecte: ImportDialecte;
    type: DatabaseType;
}[] = [
    {
        label: 'MySQL',
        sql: MYSQL_DUMP,
        dialecte: 'mysql',
        type: DatabaseType.MYSQL,
    },
    {
        label: 'PostgreSQL (pg_dump)',
        sql: PG_DUMP,
        dialecte: 'postgresql',
        type: DatabaseType.POSTGRESQL,
    },
];

describe.each(cases)('sortie réelle du parser : $label', (c) => {
    const parse = (): Promise<Diagram> =>
        sqlImportToDiagram({
            sqlContent: c.sql,
            sourceDatabaseType: c.type,
            targetDatabaseType: c.type,
        });

    it('produit des tables avec clé primaire et au moins une relation', async () => {
        const parsed = await parse();
        expect(parsed.tables?.length).toBe(2);
        expect(
            parsed.tables?.every((t) => t.fields.some((f) => f.primaryKey))
        ).toBe(true);
        expect(parsed.relationships?.length).toBeGreaterThan(0);
    });

    it('aucune table avec un schéma vide', async () => {
        const out = toImportDiagram(CURRENT, await parse(), c.dialecte);
        for (const table of out.tables) {
            expect(table.schema === '').toBe(false);
        }
    });

    it('aucun index avec un nom vide', async () => {
        const out = toImportDiagram(CURRENT, await parse(), c.dialecte);
        for (const table of out.tables) {
            for (const index of table.indexes) {
                expect(index.name.trim()).not.toBe('');
            }
        }
    });

    it('identifiants de 25 caractères au plus et noms de 63 au plus', async () => {
        const out = toImportDiagram(CURRENT, await parse(), c.dialecte);
        for (const table of out.tables) {
            expect(table.id.length).toBeLessThanOrEqual(25);
            expect(table.name.length).toBeLessThanOrEqual(63);
            for (const field of table.fields) {
                expect(field.id.length).toBeLessThanOrEqual(25);
                expect(field.name.length).toBeLessThanOrEqual(63);
            }
            for (const index of table.indexes) {
                expect(index.id.length).toBeLessThanOrEqual(25);
                expect(index.name.length).toBeLessThanOrEqual(63);
            }
        }
        for (const rel of out.relationships) {
            expect(rel.id.length).toBeLessThanOrEqual(25);
        }
    });

    it('garde exactement les mêmes identifiants qu’avant la normalisation', async () => {
        const parsed = await parse();
        const out = toImportDiagram(CURRENT, parsed, c.dialecte);

        const ids = (tables: Diagram['tables']) =>
            (tables ?? []).map((t) => ({
                table: t.id,
                fields: t.fields.map((f) => f.id),
                indexes: t.indexes.map((i) => i.id),
            }));
        expect(ids(out.tables)).toEqual(ids(parsed.tables));
        expect(out.relationships.map((r) => r.id)).toEqual(
            (parsed.relationships ?? []).map((r) => r.id)
        );
    });

    it("ne retire aucun index : l'index PK est conservé et le parser laisse en plus un index unique non-PK", async () => {
        const parsed = await parse();
        const out = toImportDiagram(CURRENT, parsed, c.dialecte);

        for (const table of out.tables) {
            const before = parsed.tables?.find((t) => t.id === table.id);
            expect(table.indexes.length).toBe(before?.indexes.length);
            expect(table.indexes.some((i) => i.isPrimaryKey)).toBe(true);
        }
        // Constat (non corrigé ici) : en plus de l'index PK, le parser laisse
        // un index unique non-PK sur la table avec clé primaire.
        const clients = out.tables.find((t) => t.name === 'clients');
        expect(clients?.indexes.some((i) => !i.isPrimaryKey && i.unique)).toBe(
            true
        );
    });
});
