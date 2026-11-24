import { describe, expect, it } from 'vitest';
import {
    buildDumpReport,
    getStatementType,
    isStatementReprised,
    MAX_REASON_LENGTH,
    MAX_TYPE_LENGTH,
    neutralizePsqlClientLines,
    prepareDumpForParser,
    RAISON_DONNEES,
    RAISON_PSQL,
    splitDumpStatements,
    stripMysqlHashComments,
    type StatementContext,
} from '../dump-report';
import {
    MYSQL_DUMP_LINES,
    MYSQL_DUMP_SQL,
    PG_DUMP_LINES,
    PG_DUMP_SQL,
    PG_KEY,
    lineOf,
} from './dump-report-test-utils';

const PG_PLAIN: StatementContext = {
    dialect: 'postgresql',
    pgDumpFormat: false,
};
const PG_DUMP: StatementContext = { dialect: 'postgresql', pgDumpFormat: true };
const MYSQL: StatementContext = { dialect: 'mysql', pgDumpFormat: false };

describe('fixtures', () => {
    it('contiennent bien les antislashs attendus', () => {
        expect(PG_DUMP_SQL).toContain(`\\restrict ${PG_KEY}`);
        expect(PG_DUMP_SQL).toContain('\n\\.\n');
        expect(MYSQL_DUMP_SQL).toContain("it\\'s; ok");
    });
});

describe('splitDumpStatements', () => {
    const split = (sql: string, dialect: 'mysql' | 'postgresql') =>
        splitDumpStatements(sql, dialect);

    it('ne coupe pas sur un ; dans une chaîne, un identifiant ou un backtick', () => {
        const sql = 'SELECT \'a;b\'; SELECT "c;d"; SELECT `e;f`;';
        expect(split(sql, 'mysql')).toHaveLength(3);
    });

    it("gère le guillemet doublé ''", () => {
        const out = split("SELECT 'it''s; ok'; SELECT 2;", 'postgresql');
        expect(out.map((s) => s.sql)).toEqual([
            "SELECT 'it''s; ok'",
            'SELECT 2',
        ]);
    });

    it("l'antislash échappe en MySQL, pas en PostgreSQL", () => {
        const sql = "SELECT 'x\\'; y'; SELECT 2;";
        expect(split(sql, 'mysql').map((s) => s.sql)).toEqual([
            "SELECT 'x\\'; y'",
            'SELECT 2',
        ]);
        // PostgreSQL (chaînes standard) : la chaîne se ferme sur le ' qui suit \
        expect(split(sql, 'postgresql')[0].sql).toBe("SELECT 'x\\'");
    });

    it("E'…' échappe avec l'antislash en PostgreSQL", () => {
        const out = split("SELECT E'x\\'; y'; SELECT 2;", 'postgresql');
        expect(out.map((s) => s.sql)).toEqual([
            "SELECT E'x\\'; y'",
            'SELECT 2',
        ]);
    });

    it('ignore les commentaires -- et /* */ (et leurs ;)', () => {
        const sql = '-- a;b\nSELECT 1; /* c;d */ SELECT 2;';
        expect(split(sql, 'postgresql').map((s) => s.sql)).toEqual([
            'SELECT 1',
            'SELECT 2',
        ]);
    });

    it('# est un commentaire en MySQL seulement', () => {
        const mysql = split('# a;b\nSELECT 1;', 'mysql');
        expect(mysql).toEqual([{ line: 2, sql: 'SELECT 1' }]);
    });

    it('le commentaire conditionnel MySQL est une vraie instruction', () => {
        const out = split('/*!40101 SET x=1 */;\nSELECT 1;', 'mysql');
        expect(out).toHaveLength(2);
        expect(out[0].line).toBe(1);
        expect(out[0].sql).toContain('/*!40101');
        expect(out[0].sql).toContain('SET x=1');
    });

    it('trois commentaires conditionnels consécutifs = une instruction', () => {
        const sql = [
            '/*!50001 CREATE ALGORITHM=UNDEFINED */',
            '/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */',
            '/*!50001 VIEW v AS select 1 */;',
            'SELECT 2;',
        ].join('\n');
        const out = split(sql, 'mysql');
        expect(out).toHaveLength(2);
        expect(out[1]).toEqual({ line: 4, sql: 'SELECT 2' });
    });

    it('reconnaît $$…$$ et $tag$…$tag$, mais pas $1', () => {
        expect(
            split('DO $$ BEGIN PERFORM 1; END $$; SELECT 2;', 'postgresql')
        ).toHaveLength(2);
        expect(
            split(
                'DO $fn1$ BEGIN PERFORM 1; END $fn1$; SELECT 2;',
                'postgresql'
            )
        ).toHaveLength(2);
        expect(split('SELECT $1; SELECT 2;', 'postgresql')).toHaveLength(2);
    });

    it('COPY … FROM stdin : les données (et leurs ;) ne sont pas découpées', () => {
        const sql = [
            'COPY t (a) FROM stdin;',
            '1;2',
            '3;4',
            '\\.',
            'SELECT 1;',
        ].join('\n');
        const out = split(sql, 'postgresql');
        expect(out).toEqual([
            { line: 1, sql: 'COPY t (a) FROM stdin' },
            { line: 5, sql: 'SELECT 1' },
        ]);
    });

    it('chaque commande psql est une instruction à elle seule', () => {
        const out = split(
            `\\restrict KEY\nSET x = 1;\n\\unrestrict KEY\n`,
            'postgresql'
        );
        expect(out).toEqual([
            { line: 1, sql: '\\restrict KEY' },
            { line: 2, sql: 'SET x = 1' },
            { line: 3, sql: '\\unrestrict KEY' },
        ]);
    });

    it("un antislash dans une chaîne n'est jamais une commande", () => {
        const out = split("SELECT 'a\n\\b';", 'postgresql');
        expect(out).toHaveLength(1);
    });

    it('DELIMITER ;; protège le corps des procédures', () => {
        const sql = [
            'DELIMITER ;;',
            'CREATE PROCEDURE p()',
            'BEGIN',
            '  SELECT 1;',
            'END ;;',
            'DELIMITER ;',
            'SELECT 2;',
        ].join('\n');
        const out = split(sql, 'mysql');
        expect(out.map((s) => [s.line, s.sql.split(' ')[0]])).toEqual([
            [1, 'DELIMITER'],
            [2, 'CREATE'],
            [6, 'DELIMITER'],
            [7, 'SELECT'],
        ]);
    });

    it('la ligne est celle du premier caractère significatif', () => {
        expect(split('\n\n-- c\n  SELECT 1;', 'postgresql')).toEqual([
            { line: 4, sql: 'SELECT 1' },
        ]);
    });

    it('émet une dernière instruction sans terminateur', () => {
        expect(split('SELECT 1;\nSELECT 2', 'mysql')).toEqual([
            { line: 1, sql: 'SELECT 1' },
            { line: 2, sql: 'SELECT 2' },
        ]);
    });
});

describe('neutralizePsqlClientLines', () => {
    const lines = (sql: string) => sql.split('\n');

    it('vide les données COPY et la ligne \\., garde la ligne COPY et le nombre de lignes', () => {
        const sql = [
            'COPY t (a, b) FROM stdin;',
            '1\tx;y',
            '2\t\\N',
            '\\.',
            'ALTER TABLE ONLY t ADD CONSTRAINT t_pkey PRIMARY KEY (a);',
        ].join('\n');
        const out = neutralizePsqlClientLines(sql);
        expect(lines(out)).toEqual([
            'COPY t (a, b) FROM stdin;',
            '',
            '',
            '',
            'ALTER TABLE ONLY t ADD CONSTRAINT t_pkey PRIMARY KEY (a);',
        ]);
    });

    it('vide les commandes psql, sans laisser la clé de \\restrict', () => {
        const sql = [
            `\\restrict ${PG_KEY}`,
            'SET x = 1;',
            '\\connect db',
            'CREATE TABLE t (id integer);',
            `\\unrestrict ${PG_KEY}`,
        ].join('\n');
        const out = neutralizePsqlClientLines(sql);
        expect(lines(out)).toEqual([
            '',
            'SET x = 1;',
            '',
            'CREATE TABLE t (id integer);',
            '',
        ]);
        expect(out).not.toContain(PG_KEY);
    });

    it('vide la fin de la ligne COPY après le ;', () => {
        const out = neutralizePsqlClientLines(
            'COPY t (a) FROM stdin; -- reste\n1\n\\.\nSELECT 1;'
        );
        expect(lines(out)).toEqual([
            'COPY t (a) FROM stdin;',
            '',
            '',
            'SELECT 1;',
        ]);
    });

    it('COPY sans \\. (dump tronqué) : tout le reste est vidé', () => {
        const out = neutralizePsqlClientLines('COPY t (a) FROM stdin;\n1\n2;');
        expect(lines(out)).toEqual(['COPY t (a) FROM stdin;', '', '']);
    });

    it('fins de ligne Windows : même nombre de lignes, lignes vidées vides', () => {
        const sql =
            '\\restrict K\r\nCOPY t (a) FROM stdin;\r\n1\r\n\\.\r\nSELECT 1;\r\n';
        const out = neutralizePsqlClientLines(sql);
        expect(out.split('\n')).toHaveLength(sql.split('\n').length);
        expect(lines(out)).toEqual([
            '',
            // La fin de la ligne COPY (ici le \r) fait partie du bloc sauté.
            'COPY t (a) FROM stdin;',
            '',
            '',
            'SELECT 1;\r',
            '',
        ]);
    });

    it.each([
        ['chaîne', "SELECT 'a\n\\b';"],
        ['dollar-quoting', 'DO $$\nBEGIN\n\\x\nEND $$;'],
        ['bloc de commentaire', '/*\n\\x\n*/\nSELECT 1;'],
        ['COPY sans stdin', "COPY t TO '/tmp/x';\nSELECT 1;"],
    ])('laisse intact un antislash dans : %s', (_label, sql) => {
        expect(neutralizePsqlClientLines(sql)).toBe(sql);
    });

    it('sur un pg_dump réaliste, ne vide que les lignes client, à leur place', () => {
        // Le rapport reste calculé sur l'original : le texte neutralisé n'a
        // plus de « \. », il n'est fait que pour le parser.
        const prepared = neutralizePsqlClientLines(PG_DUMP_SQL).split('\n');
        const copy = PG_DUMP_LINES.findIndex((l) => l.startsWith('COPY'));
        const end = PG_DUMP_LINES.indexOf('\\.');
        const blanked = new Set([
            0,
            ...Array.from({ length: end - copy }, (_, k) => copy + 1 + k),
            PG_DUMP_LINES.length - 1,
        ]);
        expect(prepared).toEqual(
            PG_DUMP_LINES.map((l, k) => (blanked.has(k) ? '' : l))
        );
    });

    it('prepareDumpForParser : # retirés en MySQL, lignes client vidées en PostgreSQL', () => {
        expect(prepareDumpForParser(MYSQL_DUMP_SQL, 'mysql')).toBe(
            stripMysqlHashComments(MYSQL_DUMP_SQL)
        );
        expect(prepareDumpForParser(PG_DUMP_SQL, 'postgresql')).toBe(
            neutralizePsqlClientLines(PG_DUMP_SQL)
        );
    });
});

describe('isStatementReprised', () => {
    const rows: [string, StatementContext, string, boolean][] = [
        // Tous contextes
        ['CREATE TABLE', PG_PLAIN, 'CREATE TABLE t (id int)', true],
        ['CREATE TABLE', PG_DUMP, 'CREATE TABLE t (id int)', true],
        ['CREATE TABLE', MYSQL, 'CREATE TABLE t (id int)', true],
        [
            'IF NOT EXISTS',
            PG_PLAIN,
            'CREATE TABLE IF NOT EXISTS t (id int)',
            true,
        ],
        [
            'IF NOT EXISTS',
            PG_DUMP,
            'CREATE TABLE IF NOT EXISTS t (id int)',
            true,
        ],
        ['IF NOT EXISTS', MYSQL, 'CREATE TABLE IF NOT EXISTS t (id int)', true],
        ['TEMP', PG_PLAIN, 'CREATE TEMP TABLE t (id int)', false],
        ['TEMPORARY', PG_PLAIN, 'CREATE TEMPORARY TABLE t (id int)', false],
        ['TEMPORARY', MYSQL, 'CREATE TEMPORARY TABLE t (id int)', false],
        ['GLOBAL', PG_PLAIN, 'CREATE GLOBAL TEMPORARY TABLE t (id int)', false],
        ['LOCAL', PG_DUMP, 'CREATE LOCAL TEMPORARY TABLE t (id int)', false],
        // Le parser crée une table fausse (colonne « LIKE » ou aucune colonne).
        ['LIKE', PG_PLAIN, 'CREATE TABLE x (LIKE t INCLUDING ALL)', false],
        ['AS SELECT', PG_PLAIN, 'CREATE TABLE x AS SELECT * FROM t', false],
        [
            'PARTITION OF',
            PG_PLAIN,
            'CREATE TABLE x PARTITION OF p FOR VALUES FROM (1) TO (10)',
            false,
        ],
        ['LIKE', MYSQL, 'CREATE TABLE x LIKE t', false],
        [
            'PARTITION BY',
            MYSQL,
            'CREATE TABLE x (id INT) PARTITION BY HASH (id) PARTITIONS 4',
            true,
        ],
        ['UNLOGGED', PG_PLAIN, 'CREATE UNLOGGED TABLE t (id int)', false],
        ['UNLOGGED', PG_DUMP, 'CREATE UNLOGGED TABLE t (id int)', false],
        ['CREATE INDEX', PG_PLAIN, 'CREATE INDEX i ON t (a)', true],
        ['CREATE INDEX', PG_DUMP, 'CREATE INDEX i ON t (a)', true],
        ['CREATE INDEX', MYSQL, 'CREATE INDEX i ON t (a)', true],
        // MySQL
        ['UNIQUE INDEX', MYSQL, 'CREATE UNIQUE INDEX i ON t (a)', true],
        ['VIEW', MYSQL, 'CREATE VIEW v AS SELECT 1', true],
        [
            'OR REPLACE VIEW',
            MYSQL,
            'CREATE OR REPLACE VIEW v AS SELECT 1',
            true,
        ],
        [
            'VIEW avec ALGORITHM',
            MYSQL,
            'CREATE ALGORITHM=UNDEFINED VIEW v AS SELECT 1',
            false,
        ],
        [
            'FOREIGN KEY',
            MYSQL,
            'ALTER TABLE u ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES t (id)',
            true,
        ],
        ['ADD PRIMARY KEY', MYSQL, 'ALTER TABLE t ADD PRIMARY KEY (id)', false],
        [
            'ADD CONSTRAINT PRIMARY KEY',
            MYSQL,
            'ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id)',
            false,
        ],
        ['ADD UNIQUE', MYSQL, 'ALTER TABLE t ADD UNIQUE (a)', false],
        [
            'ADD CONSTRAINT UNIQUE',
            MYSQL,
            'ALTER TABLE t ADD CONSTRAINT uq UNIQUE (a)',
            false,
        ],
        ['ADD INDEX', MYSQL, 'ALTER TABLE t ADD INDEX i (a)', false],
        ['ADD KEY', MYSQL, 'ALTER TABLE t ADD KEY i (a)', false],
        ['conditionnel', MYSQL, '/*!50001 CREATE VIEW v AS SELECT 1 */', false],
        ['conditionnel SET', MYSQL, '/*!40101 SET x=1 */', false],
        ['ENUM', MYSQL, "CREATE TYPE m AS ENUM ('a')", false],
        // PostgreSQL texte simple
        ['UNIQUE INDEX', PG_PLAIN, 'CREATE UNIQUE INDEX i ON t (a)', true],
        ['VIEW', PG_PLAIN, 'CREATE VIEW v AS SELECT 1', true],
        [
            'OR REPLACE VIEW',
            PG_PLAIN,
            'CREATE OR REPLACE VIEW v AS SELECT 1',
            true,
        ],
        ['ENUM', PG_PLAIN, "CREATE TYPE mood AS ENUM ('a', 'b')", true],
        [
            'type composite',
            PG_PLAIN,
            'CREATE TYPE pair AS (x int, y int)',
            false,
        ],
        // Mesuré contre le parser : le chemin texte simple ne lit que la clé
        // étrangère dans un ADD CONSTRAINT.
        [
            'PRIMARY KEY',
            PG_PLAIN,
            'ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id)',
            false,
        ],
        [
            'FOREIGN KEY',
            PG_PLAIN,
            'ALTER TABLE u ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES t (id)',
            true,
        ],
        [
            'UNIQUE',
            PG_PLAIN,
            'ALTER TABLE t ADD CONSTRAINT uq UNIQUE (a)',
            false,
        ],
        [
            'ALTER COLUMN TYPE',
            PG_PLAIN,
            'ALTER TABLE t ALTER COLUMN a TYPE bigint',
            true,
        ],
        ['OWNER TO', PG_PLAIN, 'ALTER TABLE t OWNER TO postgres', false],
        ['COMMENT ON', PG_PLAIN, "COMMENT ON TABLE t IS 'x'", false],
        ['CREATE SEQUENCE', PG_PLAIN, 'CREATE SEQUENCE s', false],
        ['CREATE SCHEMA', PG_PLAIN, 'CREATE SCHEMA s', false],
        ['INSERT', PG_PLAIN, "INSERT INTO t VALUES (1, 'x')", false],
        ['commande psql', PG_PLAIN, '\\restrict KEY', false],
        // PostgreSQL pg_dump
        ['UNIQUE INDEX', PG_DUMP, 'CREATE UNIQUE INDEX i ON t (a)', false],
        ['VIEW', PG_DUMP, 'CREATE VIEW v AS SELECT 1', false],
        ['ENUM', PG_DUMP, "CREATE TYPE mood AS ENUM ('a', 'b')", false],
        [
            'PRIMARY KEY',
            PG_DUMP,
            'ALTER TABLE ONLY t ADD CONSTRAINT pk PRIMARY KEY (id)',
            true,
        ],
        [
            'FOREIGN KEY',
            PG_DUMP,
            'ALTER TABLE ONLY u ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES t (id)',
            true,
        ],
        [
            'UNIQUE',
            PG_DUMP,
            'ALTER TABLE ONLY t ADD CONSTRAINT uq UNIQUE (a)',
            true,
        ],
        [
            'ALTER COLUMN TYPE',
            PG_DUMP,
            'ALTER TABLE t ALTER COLUMN a TYPE bigint',
            false,
        ],
        ['OWNER TO', PG_DUMP, 'ALTER TABLE ONLY t OWNER TO postgres', false],
        ['GRANT', PG_DUMP, 'GRANT ALL ON TABLE t TO u', false],
    ];

    const contextName = (c: StatementContext): string =>
        c.dialect === 'mysql'
            ? 'MySQL'
            : c.pgDumpFormat
              ? 'PostgreSQL pg_dump'
              : 'PostgreSQL texte simple';

    it.each(
        rows.map(([label, context, sql, expected]) => [
            label,
            contextName(context),
            sql,
            context,
            expected,
        ])
    )('%s — %s : %s', (_label, _name, sql, context, expected) => {
        expect(
            isStatementReprised(sql as string, context as StatementContext)
        ).toBe(expected);
    });
});

describe('getStatementType', () => {
    it.each([
        ['CREATE FUNCTION f() RETURNS int', 'CREATE FUNCTION'],
        ['CREATE OR REPLACE FUNCTION f() RETURNS int', 'CREATE FUNCTION'],
        ['CREATE UNLOGGED TABLE t (id int)', 'CREATE UNLOGGED TABLE'],
        ['DROP TABLE IF EXISTS t', 'DROP TABLE'],
        ['LOCK TABLES t WRITE', 'LOCK TABLES'],
        ['UNLOCK TABLES', 'UNLOCK TABLES'],
        ["INSERT INTO t VALUES (1, 'marie')", 'INSERT'],
        ["COMMENT ON TABLE t IS 'x'", 'COMMENT ON'],
        ['ALTER TABLE t OWNER TO postgres', 'ALTER TABLE'],
        [
            'CREATE DEFINER=`root`@`localhost` PROCEDURE p() BEGIN END',
            'CREATE PROCEDURE',
        ],
        [
            'CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW v AS SELECT 1',
            'CREATE VIEW',
        ],
        ['/*!40101 SET x=1 */', 'SET'],
        ["SELECT pg_catalog.set_config('search_path', '', false)", 'SELECT'],
        ['\\restrict AbC123', '\\RESTRICT'],
        ['\\unrestrict AbC123', '\\UNRESTRICT'],
        ['DELIMITER ;;', 'DELIMITER'],
        ['maTable_secrete quelque chose', 'INCONNU'],
    ])('%s → %s', (sql, expected) => {
        expect(getStatementType(sql)).toBe(expected);
    });

    it('est coupé à 50 caractères', () => {
        const type = getStatementType(
            'CREATE UNLOGGED UNLOGGED UNLOGGED UNLOGGED UNLOGGED UNLOGGED UNLOGGED TABLE t (a int)'
        );
        expect(type.length).toBeLessThanOrEqual(MAX_TYPE_LENGTH);
    });
});

describe('buildDumpReport : pg_dump', () => {
    const report = buildDumpReport(PG_DUMP_SQL, 'postgresql');

    it('liste exactement les instructions non reprises, avec leur ligne', () => {
        expect(report.map((e) => [e.ligne, e.type])).toEqual([
            [lineOf(PG_DUMP_SQL, '\\restrict'), '\\RESTRICT'],
            [lineOf(PG_DUMP_SQL, 'SET statement_timeout'), 'SET'],
            [lineOf(PG_DUMP_SQL, 'SELECT pg_catalog.set_config'), 'SELECT'],
            [lineOf(PG_DUMP_SQL, 'CREATE FUNCTION'), 'CREATE FUNCTION'],
            [
                lineOf(PG_DUMP_SQL, 'ALTER TABLE public.clients OWNER'),
                'ALTER TABLE',
            ],
            [lineOf(PG_DUMP_SQL, 'COPY'), 'COPY'],
            // L'ADD CONSTRAINT … PRIMARY KEY qui suit les données est lu.
            [lineOf(PG_DUMP_SQL, 'CREATE UNIQUE INDEX'), 'CREATE UNIQUE INDEX'],
            [lineOf(PG_DUMP_SQL, 'GRANT'), 'GRANT'],
            [lineOf(PG_DUMP_SQL, '\\unrestrict'), '\\UNRESTRICT'],
        ]);
    });

    it('ne reporte pas le CREATE TABLE (repris)', () => {
        const lines = report.map((e) => e.ligne);
        expect(lines).not.toContain(lineOf(PG_DUMP_SQL, 'CREATE TABLE'));
    });

    it("la clé primaire qui suit les données COPY n'est plus rapportée (lue par le parser)", () => {
        const lines = report.map((e) => e.ligne);
        expect(lines).not.toContain(lineOf(PG_DUMP_SQL, 'ALTER TABLE ONLY'));
    });

    it('le COPY garde son entrée de données', () => {
        const copy = report.find((e) => e.type === 'COPY');
        expect(copy?.ligne).toBe(lineOf(PG_DUMP_SQL, 'COPY'));
        expect(copy?.raison).toBe(RAISON_DONNEES);
    });

    it("la commande psql a sa propre entrée, le SET qui suit n'est pas avalé", () => {
        const restrict = report.find((e) => e.type === '\\RESTRICT');
        const set = report.find((e) => e.type === 'SET');
        expect(restrict?.ligne).toBe(1);
        expect(restrict?.raison).toBe(RAISON_PSQL);
        expect(set?.ligne).toBe(lineOf(PG_DUMP_SQL, 'SET statement_timeout'));
        expect(report.find((e) => e.type === '\\UNRESTRICT')?.raison).toBe(
            RAISON_PSQL
        );
    });

    it("n'expose la clé des commandes psql nulle part", () => {
        expect(JSON.stringify(report)).not.toContain(PG_KEY);
    });

    it('SELECT set_config est une instruction de session, pas de données', () => {
        const select = report.find((e) => e.type === 'SELECT');
        const set = report.find((e) => e.type === 'SET');
        expect(select?.raison).toBe(set?.raison);
    });
});

describe('buildDumpReport : contexte du texte préparé', () => {
    it('un marqueur pg_dump présent seulement dans des données COPY ne bascule pas le classement', () => {
        // « FROM STDIN » en majuscules n'est pas un marqueur pg_dump ; la donnée
        // « ALTER TABLE ONLY » en est un, mais le parser ne la voit pas.
        const sql = [
            'CREATE TABLE t (id integer NOT NULL);',
            'COPY t (id) FROM STDIN;',
            'ALTER TABLE ONLY dans les données',
            '\\.',
            'CREATE INDEX i ON t (id);',
            'ALTER TABLE t ADD CONSTRAINT t_pkey PRIMARY KEY (id);',
        ].join('\n');
        // Le parser lit le texte simple : la clé primaire n'y est pas lue.
        const lines = buildDumpReport(sql, 'postgresql').map((e) => e.ligne);
        expect(lines).toContain(lineOf(sql, 'ALTER TABLE t ADD CONSTRAINT'));
    });
});

describe('buildDumpReport : MySQL', () => {
    const report = buildDumpReport(MYSQL_DUMP_SQL, 'mysql');

    it('liste exactement les instructions non reprises, avec leur ligne', () => {
        expect(report.map((e) => [e.ligne, e.type])).toEqual([
            [lineOf(MYSQL_DUMP_SQL, '/*!40101'), 'SET'],
            [lineOf(MYSQL_DUMP_SQL, 'DROP TABLE'), 'DROP TABLE'],
            [lineOf(MYSQL_DUMP_SQL, 'LOCK TABLES'), 'LOCK TABLES'],
            [lineOf(MYSQL_DUMP_SQL, 'INSERT'), 'INSERT'],
            [lineOf(MYSQL_DUMP_SQL, 'UNLOCK TABLES'), 'UNLOCK TABLES'],
            [lineOf(MYSQL_DUMP_SQL, 'DELIMITER ;;'), 'DELIMITER'],
            [lineOf(MYSQL_DUMP_SQL, 'CREATE DEFINER'), 'CREATE PROCEDURE'],
            [MYSQL_DUMP_LINES.indexOf('DELIMITER ;') + 1, 'DELIMITER'],
        ]);
    });

    it('ne reporte ni le CREATE TABLE ni le CREATE INDEX (repris)', () => {
        const lines = report.map((e) => e.ligne);
        expect(lines).not.toContain(lineOf(MYSQL_DUMP_SQL, 'CREATE TABLE'));
        expect(lines).not.toContain(lineOf(MYSQL_DUMP_SQL, 'CREATE INDEX'));
    });

    it("le # et la chaîne 'it\\'s; ok' ne créent pas d'entrée parasite", () => {
        expect(report).toHaveLength(8);
    });
});

describe('buildDumpReport : garanties communes', () => {
    const reports = [
        buildDumpReport(PG_DUMP_SQL, 'postgresql'),
        buildDumpReport(MYSQL_DUMP_SQL, 'mysql'),
    ];

    it('type ≤ 50 et raison ≤ 500', () => {
        for (const entry of reports.flat()) {
            expect(entry.type.length).toBeLessThanOrEqual(MAX_TYPE_LENGTH);
            expect(entry.raison.length).toBeLessThanOrEqual(MAX_REASON_LENGTH);
            expect(entry.raison.length).toBeGreaterThan(0);
        }
    });

    it('seulement les clés ligne, raison et type', () => {
        for (const entry of reports.flat()) {
            expect(Object.keys(entry).sort()).toEqual([
                'ligne',
                'raison',
                'type',
            ]);
        }
    });

    it('aucune donnée du dump dans le JSON du rapport (RG-24)', () => {
        const json = JSON.stringify(reports);
        for (const secret of [
            'marie',
            'dupont',
            'durand',
            'example.org',
            'clients',
            'email',
            'purger',
            'idx_note',
            'touch',
            'app_user',
            PG_KEY,
        ]) {
            expect(json).not.toContain(secret);
        }
    });

    it('le rapport est vide quand tout est repris', () => {
        const sql = [
            'CREATE TABLE t (id INT NOT NULL, a INT, PRIMARY KEY (id));',
            'CREATE INDEX idx_a ON t (a);',
        ].join('\n');
        expect(buildDumpReport(sql, 'mysql')).toEqual([]);
        expect(buildDumpReport(sql, 'postgresql')).toEqual([]);
    });
});
