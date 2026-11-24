import { expect } from 'vitest';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import { isPgDumpFormat, sqlImportToDiagram } from '..';
import {
    buildDumpReport,
    splitDumpStatements,
    type DumpDialect,
} from '../dump-report';

/** Contextes de classement : le parser lit des choses différentes dans chacun. */
export type DumpContext = 'pg-plain' | 'pg-dump' | 'mysql';

export const PG_DUMP_PREFIX = 'SET statement_timeout = 0;';

export const dialectOf = (context: DumpContext): DumpDialect =>
    context === 'mysql' ? 'mysql' : 'postgresql';

const databaseTypeOf = (context: DumpContext): DatabaseType =>
    context === 'mysql' ? DatabaseType.MYSQL : DatabaseType.POSTGRESQL;

/** Dump de test : en pg_dump, le préfixe déclenche le chemin pg_dump du parser. */
export const buildDump = (context: DumpContext, lines: string[]): string => {
    const sql = (
        context === 'pg-dump' ? [PG_DUMP_PREFIX, ...lines] : lines
    ).join('\n');
    // Garde-fou : le contexte demandé est bien celui que le parser va choisir.
    if (context !== 'mysql') {
        expect(isPgDumpFormat(sql)).toBe(context === 'pg-dump');
    }
    return sql;
};

export const importDump = (
    context: DumpContext,
    sql: string
): Promise<Diagram> =>
    sqlImportToDiagram({
        sqlContent: sql,
        sourceDatabaseType: databaseTypeOf(context),
        targetDatabaseType: databaseTypeOf(context),
    });

/** Ligne (à partir de 1) de la première ligne qui commence par le préfixe. */
export const lineOf = (sql: string, prefix: string): number => {
    const index = sql.split('\n').findIndex((l) => l.startsWith(prefix));
    expect(index, `aucune ligne ne commence par ${prefix}`).toBeGreaterThan(-1);
    return index + 1;
};

/**
 * Garantie du CU : aucune instruction n'est ignorée en silence. Le dump passe
 * par le VRAI sqlImportToDiagram ; si l'effet attendu de sa dernière
 * instruction n'apparaît pas dans le diagramme, cette instruction doit figurer
 * dans le rapport, sur sa ligne. Sur-déclarer est sans danger, l'inverse non.
 */
export const expectEffectOrReported = async (
    context: DumpContext,
    lines: string[],
    hasEffect: (diagram: Diagram) => boolean
): Promise<void> => {
    const sql = buildDump(context, lines);
    const dialect = dialectOf(context);
    const diagram = await importDump(context, sql);

    if (hasEffect(diagram)) return;

    const statements = splitDumpStatements(sql, dialect);
    const last = statements[statements.length - 1];
    const reportedLines = buildDumpReport(sql, dialect).map((e) => e.ligne);
    expect(
        reportedLines,
        `perte silencieuse : « ${last.sql.slice(0, 80)} » (ligne ${last.line}) ` +
            "n'a aucun effet dans le diagramme et n'est pas dans le rapport"
    ).toContain(last.line);
};

export const findTable = (diagram: Diagram, name: string) =>
    (diagram.tables ?? []).find((t) => t.name === name);

// ---------------------------------------------------------------------------
// Fixtures réalistes
// ---------------------------------------------------------------------------

export const PG_KEY = 'AbC123SecretKey';

/** Un pg_dump récent : commandes psql, SET, fonction $$, COPY avec des « ; »… */
export const PG_DUMP_LINES: string[] = [
    `\\restrict ${PG_KEY}`,
    '',
    'SET statement_timeout = 0;',
    "SELECT pg_catalog.set_config('search_path', '', false);",
    'CREATE FUNCTION public.touch() RETURNS trigger',
    '    LANGUAGE plpgsql',
    '    AS $$',
    'BEGIN',
    '    -- note interne ; ne pas couper ici',
    '    NEW.updated_at := now();',
    '    RETURN NEW;',
    'END;',
    '$$;',
    'CREATE TABLE public.clients (',
    '    id integer NOT NULL,',
    "    email text DEFAULT 'a;b' NOT NULL",
    ');',
    'ALTER TABLE public.clients OWNER TO postgres;',
    'COPY public.clients (id, email) FROM stdin;',
    '1\tmarie.dupont@example.org;x',
    '2\tpaul;durand@example.org',
    '\\.',
    'ALTER TABLE ONLY public.clients',
    '    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);',
    'CREATE UNIQUE INDEX clients_email_idx ON public.clients USING btree (email);',
    'GRANT ALL ON TABLE public.clients TO app_user;',
    `\\unrestrict ${PG_KEY}`,
];

export const PG_DUMP_SQL = PG_DUMP_LINES.join('\n');

/** Un dump MySQL : commentaire conditionnel, chaîne avec \', verrous, DELIMITER. */
export const MYSQL_DUMP_LINES: string[] = [
    '-- MySQL dump 10.13',
    '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
    'DROP TABLE IF EXISTS `clients`;',
    'CREATE TABLE `clients` (',
    '  `id` int NOT NULL AUTO_INCREMENT,',
    "  `note` varchar(50) DEFAULT 'it\\'s; ok',",
    '  PRIMARY KEY (`id`)',
    ') ENGINE=InnoDB;',
    '# commentaire d’un outil de MCD',
    'LOCK TABLES `clients` WRITE;',
    "INSERT INTO `clients` VALUES (1,'marie.dupont@example.org');",
    'UNLOCK TABLES;',
    'DELIMITER ;;',
    'CREATE DEFINER=`root`@`localhost` PROCEDURE `purger`()',
    'BEGIN',
    '  DELETE FROM `clients`;',
    '  SELECT 1;',
    'END ;;',
    'DELIMITER ;',
    'CREATE INDEX `idx_note` ON `clients` (`note`);',
];

export const MYSQL_DUMP_SQL = MYSQL_DUMP_LINES.join('\n');
