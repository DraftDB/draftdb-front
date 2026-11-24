import { describe, it } from 'vitest';
import type { Diagram } from '@/lib/domain/diagram';
import {
    expectEffectOrReported,
    findTable,
    type DumpContext,
} from './dump-report-test-utils';

// Matrice du classement « repris » contre le VRAI parser : si l'effet attendu
// d'une instruction n'apparaît pas dans le diagramme, cette instruction (la
// dernière du dump) doit figurer dans le rapport, sur sa ligne.

interface MatrixCase {
    label: string;
    statement: string[];
    effect: (diagram: Diagram) => boolean;
}

const PG_SETUP = [
    'CREATE TABLE t (',
    '    id integer NOT NULL,',
    '    a integer,',
    '    b text',
    ');',
    'CREATE TABLE u (',
    '    id integer NOT NULL,',
    '    t_id integer',
    ');',
];

const MYSQL_SETUP = [
    'CREATE TABLE t (id INT NOT NULL, a INT, b VARCHAR(20)) ENGINE=InnoDB;',
    'CREATE TABLE u (id INT NOT NULL, t_id INT) ENGINE=InnoDB;',
];

const hasIndex =
    (name: string) =>
    (d: Diagram): boolean =>
        (findTable(d, 't')?.indexes ?? []).some((i) => i.name === name);

const hasView = (d: Diagram): boolean =>
    (d.tables ?? []).some((t) => t.isView && t.name === 'v');

const hasType =
    (name: string) =>
    (d: Diagram): boolean =>
        (d.customTypes ?? []).some((c) => c.name === name);

const hasPrimaryKey = (d: Diagram): boolean =>
    findTable(d, 't')?.fields.find((f) => f.name === 'id')?.primaryKey === true;

const hasUnique =
    (indexName: string) =>
    (d: Diagram): boolean => {
        const t = findTable(d, 't');
        return (
            t?.fields.find((f) => f.name === 'b')?.unique === true ||
            (t?.indexes ?? []).some((i) => i.name === indexName && i.unique)
        );
    };

const hasRelationship = (d: Diagram): boolean =>
    (d.relationships ?? []).length > 0;

const hasColumnType =
    (type: string) =>
    (d: Diagram): boolean => {
        const field = findTable(d, 't')?.fields.find((f) => f.name === 'a');
        return (
            field?.type.id.toLowerCase() === type ||
            field?.type.name.toLowerCase() === type
        );
    };

const PG_CASES: MatrixCase[] = [
    {
        label: 'CREATE INDEX',
        statement: ['CREATE INDEX idx_a ON t (a);'],
        effect: hasIndex('idx_a'),
    },
    {
        label: 'CREATE INDEX USING btree',
        statement: ['CREATE INDEX idx_a ON t USING btree (a);'],
        effect: hasIndex('idx_a'),
    },
    {
        label: 'CREATE UNIQUE INDEX',
        statement: ['CREATE UNIQUE INDEX uq_b ON t (b);'],
        effect: hasIndex('uq_b'),
    },
    {
        label: 'CREATE UNIQUE INDEX USING btree',
        statement: ['CREATE UNIQUE INDEX uq_b ON t USING btree (b);'],
        effect: hasIndex('uq_b'),
    },
    {
        label: 'CREATE VIEW',
        statement: ['CREATE VIEW v AS SELECT id, a FROM t;'],
        effect: hasView,
    },
    {
        label: 'CREATE OR REPLACE VIEW',
        statement: ['CREATE OR REPLACE VIEW v AS SELECT id, a FROM t;'],
        effect: hasView,
    },
    {
        label: 'CREATE TYPE … AS ENUM',
        statement: ["CREATE TYPE mood AS ENUM ('sad', 'ok');"],
        effect: hasType('mood'),
    },
    {
        label: 'CREATE TYPE composite',
        statement: ['CREATE TYPE pair AS (x integer, y integer);'],
        effect: hasType('pair'),
    },
    {
        label: 'ADD CONSTRAINT PRIMARY KEY',
        statement: ['ALTER TABLE t ADD CONSTRAINT t_pkey PRIMARY KEY (id);'],
        effect: hasPrimaryKey,
    },
    {
        label: 'ADD CONSTRAINT FOREIGN KEY',
        statement: [
            'ALTER TABLE u ADD CONSTRAINT fk_u_t FOREIGN KEY (t_id) REFERENCES t (id);',
        ],
        effect: hasRelationship,
    },
    {
        label: 'ADD CONSTRAINT UNIQUE',
        statement: ['ALTER TABLE t ADD CONSTRAINT uq_b UNIQUE (b);'],
        effect: hasUnique('uq_b'),
    },
    {
        label: 'ALTER COLUMN TYPE',
        statement: ['ALTER TABLE t ALTER COLUMN a TYPE bigint;'],
        effect: hasColumnType('bigint'),
    },
    {
        label: 'ALTER TABLE OWNER TO',
        statement: ['ALTER TABLE t OWNER TO postgres;'],
        effect: () => false,
    },
    {
        label: 'COMMENT ON',
        statement: ["COMMENT ON TABLE t IS 'x';"],
        effect: () => false,
    },
    {
        label: 'CREATE SEQUENCE',
        statement: ['CREATE SEQUENCE s;'],
        effect: () => false,
    },
];

const MYSQL_CASES: MatrixCase[] = [
    {
        label: 'CREATE INDEX',
        statement: ['CREATE INDEX idx_a ON t (a);'],
        effect: hasIndex('idx_a'),
    },
    {
        label: 'CREATE INDEX USING BTREE',
        statement: ['CREATE INDEX idx_a ON t (a) USING BTREE;'],
        effect: hasIndex('idx_a'),
    },
    {
        label: 'CREATE UNIQUE INDEX',
        statement: ['CREATE UNIQUE INDEX uq_b ON t (b);'],
        effect: hasIndex('uq_b'),
    },
    {
        label: 'CREATE VIEW',
        statement: ['CREATE VIEW v AS SELECT id, a FROM t;'],
        effect: hasView,
    },
    {
        label: 'CREATE OR REPLACE VIEW',
        statement: ['CREATE OR REPLACE VIEW v AS SELECT id, a FROM t;'],
        effect: hasView,
    },
    {
        label: 'ADD CONSTRAINT FOREIGN KEY',
        statement: [
            'ALTER TABLE u ADD CONSTRAINT fk_u_t FOREIGN KEY (t_id) REFERENCES t (id);',
        ],
        effect: hasRelationship,
    },
    {
        label: 'ADD PRIMARY KEY',
        statement: ['ALTER TABLE t ADD PRIMARY KEY (id);'],
        effect: hasPrimaryKey,
    },
    {
        label: 'ADD CONSTRAINT PRIMARY KEY',
        statement: ['ALTER TABLE t ADD CONSTRAINT pk_t PRIMARY KEY (id);'],
        effect: hasPrimaryKey,
    },
    {
        label: 'ADD UNIQUE',
        statement: ['ALTER TABLE t ADD UNIQUE (b);'],
        effect: hasUnique('b'),
    },
    {
        label: 'ADD UNIQUE KEY',
        statement: ['ALTER TABLE t ADD UNIQUE KEY uq_b (b);'],
        effect: hasUnique('uq_b'),
    },
    {
        label: 'ADD CONSTRAINT UNIQUE',
        statement: ['ALTER TABLE t ADD CONSTRAINT uq_b UNIQUE (b);'],
        effect: hasUnique('uq_b'),
    },
    {
        label: 'ADD INDEX',
        statement: ['ALTER TABLE t ADD INDEX idx_a (a);'],
        effect: hasIndex('idx_a'),
    },
    {
        label: 'ADD KEY',
        statement: ['ALTER TABLE t ADD KEY idx_a (a);'],
        effect: hasIndex('idx_a'),
    },
    {
        label: 'vue mysqldump sur une ligne',
        statement: [
            '/*!50001 CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW v AS select id, a from t */;',
        ],
        effect: hasView,
    },
    {
        label: 'vue mysqldump en trois commentaires',
        statement: [
            '/*!50001 CREATE ALGORITHM=UNDEFINED */',
            '/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */',
            '/*!50001 VIEW v AS select id, a from t */;',
        ],
        effect: hasView,
    },
];

// Chaque cas PostgreSQL est joué en texte simple ET en pg_dump.
describe.each<[DumpContext, string[], MatrixCase[]]>([
    ['pg-plain', PG_SETUP, PG_CASES],
    ['pg-dump', PG_SETUP, PG_CASES],
    ['mysql', MYSQL_SETUP, MYSQL_CASES],
])('matrice contre le vrai parser — %s', (context, setup, cases) => {
    it.each(cases)('$label', async ({ statement, effect }) => {
        await expectEffectOrReported(context, [...setup, ...statement], effect);
    });
});
