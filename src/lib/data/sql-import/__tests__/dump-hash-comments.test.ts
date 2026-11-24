import { describe, expect, it } from 'vitest';
import { DatabaseType } from '@/lib/domain/database-type';
import { sqlImportToDiagram } from '..';
import { buildDumpReport, stripMysqlHashComments } from '../dump-report';
import { lineOf } from './dump-report-test-utils';

// Script typique d'un outil de MCD : des lignes « # » de commentaire.
const MCD_LINES = [
    '# Script généré par un outil de MCD',
    '# Table CLIENT',
    'CREATE TABLE CLIENT (',
    '  ID_CLIENT INT NOT NULL,',
    '  NOM VARCHAR(50),',
    '  PRIMARY KEY (ID_CLIENT)',
    ') ENGINE=InnoDB;',
    '',
    '# Table COMMANDE',
    'CREATE TABLE COMMANDE (',
    '  ID_COMMANDE INT NOT NULL,',
    '  ID_CLIENT INT NOT NULL,',
    '  PRIMARY KEY (ID_COMMANDE),',
    '  CONSTRAINT FK_COMMANDE_CLIENT FOREIGN KEY (ID_CLIENT) REFERENCES CLIENT (ID_CLIENT)',
    ') ENGINE=InnoDB;',
    '',
    '# Données de test',
    "INSERT INTO CLIENT VALUES (1, 'Marie');",
];
const MCD_SCRIPT = MCD_LINES.join('\n');

const importMysql = (sqlContent: string) =>
    sqlImportToDiagram({
        sqlContent,
        sourceDatabaseType: DatabaseType.MYSQL,
        targetDatabaseType: DatabaseType.MYSQL,
    });

describe('non-régression : les lignes # font perdre toutes les tables à ChartDB', () => {
    it('0 table, sans erreur, sans nettoyage', async () => {
        const diagram = await importMysql(MCD_SCRIPT);
        expect(diagram.tables ?? []).toHaveLength(0);
    });

    it('2 tables et 1 relation après stripMysqlHashComments', async () => {
        const diagram = await importMysql(stripMysqlHashComments(MCD_SCRIPT));
        expect(diagram.tables).toHaveLength(2);
        expect(diagram.relationships).toHaveLength(1);
    });
});

describe('stripMysqlHashComments', () => {
    it('retire les # jusqu’à la fin de ligne et garde le nombre de lignes', () => {
        const out = stripMysqlHashComments(MCD_SCRIPT);
        expect(out.split('\n')).toHaveLength(MCD_LINES.length);
        expect(out).not.toContain('# Table');
        expect(out).toContain('CREATE TABLE CLIENT');
    });

    it('retire un # en fin de ligne, après une instruction', () => {
        expect(stripMysqlHashComments('SELECT 1; # c\nSELECT 2;')).toBe(
            'SELECT 1; \nSELECT 2;'
        );
    });

    it('garde le \\r d’une fin de ligne Windows', () => {
        expect(stripMysqlHashComments('a # c\r\nb')).toBe('a \r\nb');
    });

    it.each([
        ['chaîne simple', "SELECT 'a # b';"],
        ['chaîne double', 'SELECT "c # d";'],
        ['guillemet doublé', "SELECT 'it''s # ok';"],
        ['échappement antislash', "SELECT 'x\\' # y';"],
        ['identifiant backtick', 'SELECT `t#1` FROM `t#2`;'],
        ['commentaire --', '-- un # dans un commentaire\nSELECT 1;'],
        ['bloc /* */', '/* un # ici */ SELECT 1;'],
        ['bloc sur plusieurs lignes', '/* a\n# b\nc */\nSELECT 1;'],
        ['commentaire conditionnel', '/*!40101 SET x=1 # y */;'],
    ])('laisse intact un # dans : %s', (_label, sql) => {
        expect(stripMysqlHashComments(sql)).toBe(sql);
    });

    it("le sanity check des antislashs : la fixture contient bien \\'", () => {
        expect("SELECT 'x\\' # y';").toContain("\\'");
    });
});

describe('buildDumpReport sur un script avec des #', () => {
    it('ne signale que l’INSERT, à la bonne ligne', () => {
        const report = buildDumpReport(MCD_SCRIPT, 'mysql');
        expect(report.map((e) => [e.ligne, e.type])).toEqual([
            [lineOf(MCD_SCRIPT, 'INSERT'), 'INSERT'],
        ]);
    });

    it('donne le même rapport avec ou sans nettoyage', () => {
        expect(
            buildDumpReport(stripMysqlHashComments(MCD_SCRIPT), 'mysql')
        ).toEqual(buildDumpReport(MCD_SCRIPT, 'mysql'));
    });
});
