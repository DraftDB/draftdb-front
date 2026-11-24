import { describe, it } from 'vitest';
import {
    PG_DUMP_LINES,
    expectEffectOrReported,
    findTable,
    type DumpContext,
} from './dump-report-test-utils';

// Garantie du CU : aucune instruction n'est ignorée en silence. Pour chaque
// variante de CREATE TABLE, le dump passe par le vrai sqlImportToDiagram ; si
// la table n'apparaît pas, la dernière instruction doit être dans le rapport.

interface TableCase {
    label: string;
    setup?: string[];
    statement: string;
}

const PG_SETUP = [
    'CREATE TABLE t (',
    '    id integer NOT NULL,',
    '    a integer',
    ');',
];
const MYSQL_SETUP = ['CREATE TABLE t (id INT NOT NULL, a INT) ENGINE=InnoDB;'];

const PG_CASES: TableCase[] = [
    { label: 'CREATE TABLE', statement: 'CREATE TABLE x (id integer);' },
    {
        label: 'IF NOT EXISTS',
        statement: 'CREATE TABLE IF NOT EXISTS x (id integer);',
    },
    { label: 'TEMP', statement: 'CREATE TEMP TABLE x (id integer);' },
    { label: 'TEMPORARY', statement: 'CREATE TEMPORARY TABLE x (id integer);' },
    {
        label: 'GLOBAL TEMPORARY',
        statement: 'CREATE GLOBAL TEMPORARY TABLE x (id integer);',
    },
    {
        label: 'LOCAL TEMPORARY',
        statement: 'CREATE LOCAL TEMPORARY TABLE x (id integer);',
    },
    { label: 'UNLOGGED', statement: 'CREATE UNLOGGED TABLE x (id integer);' },
    {
        label: 'LIKE',
        statement: 'CREATE TABLE x (LIKE t INCLUDING ALL);',
    },
    {
        label: 'PARTITION OF',
        setup: [
            'CREATE TABLE parent (id integer, a integer) PARTITION BY RANGE (id);',
        ],
        statement:
            'CREATE TABLE x PARTITION OF parent FOR VALUES FROM (1) TO (10);',
    },
    { label: 'AS SELECT', statement: 'CREATE TABLE x AS SELECT * FROM t;' },
    {
        label: 'schéma qualifié',
        statement: 'CREATE TABLE public.x (id integer);',
    },
    { label: 'minuscules', statement: 'create table x (id integer);' },
];

const MYSQL_CASES: TableCase[] = [
    {
        label: 'CREATE TABLE',
        statement: 'CREATE TABLE x (id INT) ENGINE=InnoDB;',
    },
    {
        label: 'IF NOT EXISTS',
        statement: 'CREATE TABLE IF NOT EXISTS x (id INT) ENGINE=InnoDB;',
    },
    {
        label: 'TEMPORARY',
        statement: 'CREATE TEMPORARY TABLE x (id INT);',
    },
    { label: 'LIKE', statement: 'CREATE TABLE x LIKE t;' },
    { label: 'LIKE entre parenthèses', statement: 'CREATE TABLE x (LIKE t);' },
    {
        label: 'PARTITION',
        statement:
            'CREATE TABLE x (id INT NOT NULL) PARTITION BY HASH (id) PARTITIONS 4;',
    },
    { label: 'AS SELECT', statement: 'CREATE TABLE x AS SELECT * FROM t;' },
    { label: 'minuscules', statement: 'create table x (id INT);' },
];

const hasTableX = (d: Parameters<typeof findTable>[0]): boolean => {
    const table = findTable(d, 'x');
    return table !== undefined && !table.isView;
};

describe.each<[DumpContext, string[], TableCase[]]>([
    ['pg-plain', PG_SETUP, PG_CASES],
    ['pg-dump', PG_SETUP, PG_CASES],
    ['mysql', MYSQL_SETUP, MYSQL_CASES],
])('CREATE TABLE et variantes — %s', (context, baseSetup, cases) => {
    it.each(cases)('$label', async ({ setup, statement }) => {
        await expectEffectOrReported(
            context,
            [...baseSetup, ...(setup ?? []), statement],
            hasTableX
        );
    });
});

describe('instruction qui suit une commande psql ou un COPY vide', () => {
    const tableX = (d: Parameters<typeof findTable>[0]): boolean =>
        findTable(d, 'x') !== undefined;

    it.each<DumpContext>(['pg-plain', 'pg-dump'])(
        'CREATE TABLE juste après \\connect — %s',
        async (context) => {
            await expectEffectOrReported(
                context,
                ['\\connect db', 'CREATE TABLE x (id integer);'],
                tableX
            );
        }
    );

    it('clé primaire juste après un COPY sans donnée (pg_dump)', async () => {
        await expectEffectOrReported(
            'pg-dump',
            [
                ...PG_SETUP,
                'COPY t (id) FROM stdin;',
                '\\.',
                'ALTER TABLE ONLY t ADD CONSTRAINT t_pkey PRIMARY KEY (id);',
            ],
            (d) =>
                findTable(d, 't')?.fields.find((f) => f.name === 'id')
                    ?.primaryKey === true
        );
    });
});

describe('instruction qui suit un bloc COPY (pg_dump)', () => {
    it('la clé primaire ajoutée juste après les données est reprise ou rapportée', async () => {
        // Dump réaliste coupé juste après ADD CONSTRAINT PRIMARY KEY, qui suit
        // directement le bloc COPY (données et ligne \.).
        const end = PG_DUMP_LINES.findIndex((l) =>
            l.startsWith('CREATE UNIQUE INDEX')
        );
        await expectEffectOrReported(
            'pg-dump',
            PG_DUMP_LINES.slice(0, end),
            (d) =>
                findTable(d, 'clients')?.fields.find((f) => f.name === 'id')
                    ?.primaryKey === true
        );
    });
});
