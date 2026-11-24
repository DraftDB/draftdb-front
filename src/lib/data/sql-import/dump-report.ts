import { isPgDumpFormat } from './index';

// Rapport des instructions d'un dump que l'éditeur n'a pas pu traduire (CU 1.5).
//
// RG-24 : une entrée ne contient QUE la ligne, un type fait de mots-clés d'une
// liste blanche et une phrase fixe. Jamais le texte d'une instruction : un
// INSERT contient des données du client, un CREATE contient des noms.
//
// Le classement « repris » suit ce que le parser ChartDB LIT réellement (il
// dépend du dialecte et, en PostgreSQL, du chemin texte simple ou pg_dump), pas
// ce qu'il devrait lire. Les tests du dossier __tests__ le vérifient contre le
// vrai sqlImportToDiagram.

export type DumpDialect = 'mysql' | 'postgresql';

export interface DumpStatement {
    /** Ligne (à partir de 1) du premier caractère significatif. */
    line: number;
    sql: string;
    /**
     * Présent (vrai) quand l'instruction suit des données COPY ou une commande
     * psql : ces lignes n'ont pas de « ; » et le parser pg_dump les colle à
     * l'instruction suivante, qui est alors perdue.
     */
    followsClientData?: true;
}

export interface DumpReportEntry {
    ligne: number;
    type: string;
    raison: string;
}

export interface StatementContext {
    dialect: DumpDialect;
    /** Vrai si isPgDumpFormat(sql) : le parser pg_dump lit moins de choses. */
    pgDumpFormat: boolean;
}

export const MAX_TYPE_LENGTH = 50;
export const MAX_REASON_LENGTH = 500;

const isSpace = (c: string): boolean =>
    c === ' ' ||
    c === '\t' ||
    c === '\r' ||
    c === '\f' ||
    c === '\v' ||
    c === '\uFEFF';

const isIdentChar = (c: string | undefined): boolean =>
    c !== undefined && /[A-Za-z0-9_$]/.test(c);

// Suite de caractères qui ne peuvent pas ouvrir de chaîne, de commentaire ni
// de délimiteur usuel : on les avale d'un bloc, par vitesse.
const ORDINARY_RUN = /[A-Za-z0-9_.,()]+/y;

/**
 * Découpe un dump en instructions.
 *
 * Gère les chaînes '…', "…" et les backticks (guillemet doublé ; antislash en
 * MySQL seulement, et après E en PostgreSQL), les commentaires -- et les blocs
 * entre barres obliques et étoiles, le # MySQL, le commentaire conditionnel
 * MySQL (une vraie instruction, ses marqueurs sont conservés), le dollar-quoting
 * PostgreSQL, les blocs COPY ... FROM stdin jusqu'à la ligne \. , les commandes
 * psql (une instruction par ligne) et DELIMITER MySQL.
 */
export function splitDumpStatements(
    sql: string,
    dialect: DumpDialect
): DumpStatement[] {
    const mysql = dialect === 'mysql';
    const n = sql.length;
    const out: DumpStatement[] = [];

    let i = 0;
    let line = 1;
    let startLine = 0; // 0 : aucune instruction en cours
    let buf = '';
    let delimiter = ';';
    let inConditional = false;
    // Vrai entre une commande psql ou des données COPY et l'instruction suivante.
    let clientDataPending = false;

    const eol = (from: number): number => {
        const k = sql.indexOf('\n', from);
        return k === -1 ? n : k;
    };

    // Avance sans rien ajouter à l'instruction.
    const advance = (to: number): void => {
        const end = Math.min(to, n);
        for (let k = i; k < end; k++) {
            if (sql[k] === '\n') line++;
        }
        i = end;
    };

    // Avance en ajoutant le texte parcouru à l'instruction.
    const take = (to: number): void => {
        if (startLine === 0) startLine = line;
        buf += sql.slice(i, Math.min(to, n));
        advance(to);
    };

    const flush = (): string => {
        const text = buf.trim();
        if (text !== '') {
            out.push(
                clientDataPending
                    ? { line: startLine, sql: text, followsClientData: true }
                    : { line: startLine, sql: text }
            );
            clientDataPending = false;
        }
        buf = '';
        startLine = 0;
        inConditional = false;
        return text;
    };

    // Après « COPY … FROM stdin; » : saute les données jusqu'à la ligne \.
    const skipCopyData = (): void => {
        let pos = eol(i);
        while (pos < n) {
            const lineStart = pos + 1;
            const lineEnd = eol(lineStart);
            const content = sql.slice(lineStart, lineEnd).trimEnd();
            pos = lineEnd;
            if (content === '\\.') break;
        }
        advance(pos);
        clientDataPending = true;
    };

    while (i < n) {
        const ch = sql[i];
        const inStatement = startLine !== 0;

        if (ch === '\n') {
            if (inStatement) buf += ch;
            line++;
            i++;
            continue;
        }
        if (isSpace(ch)) {
            if (inStatement) buf += ch;
            i++;
            continue;
        }

        // Commandes du client, seulement entre deux instructions.
        if (!inStatement) {
            if (!mysql && ch === '\\') {
                const end = eol(i);
                out.push({ line, sql: sql.slice(i, end).trim() });
                clientDataPending = true;
                advance(end);
                continue;
            }
            if (mysql && /^delimiter[ \t]/i.test(sql.slice(i, i + 10))) {
                const end = eol(i);
                const arg =
                    sql
                        .slice(i + 9, end)
                        .trim()
                        .split(/\s+/)[0] ?? '';
                out.push({ line, sql: `DELIMITER ${arg}`.trim() });
                if (arg !== '') delimiter = arg;
                advance(end);
                continue;
            }
        }

        // Commentaires de ligne.
        if ((ch === '-' && sql[i + 1] === '-') || (mysql && ch === '#')) {
            advance(eol(i));
            continue;
        }

        // Commentaires en bloc.
        if (ch === '/' && sql[i + 1] === '*') {
            if (
                mysql &&
                (sql[i + 2] === '!' ||
                    (sql[i + 2] === 'M' && sql[i + 3] === '!'))
            ) {
                // Commentaire conditionnel : une vraie instruction.
                const marker = /^\/\*M?!\d*/.exec(sql.slice(i, i + 16));
                take(i + (marker ? marker[0].length : 3));
                inConditional = true;
                continue;
            }
            let depth = 1;
            let k = i + 2;
            while (k < n && depth > 0) {
                if (!mysql && sql[k] === '/' && sql[k + 1] === '*') {
                    depth++;
                    k += 2;
                } else if (sql[k] === '*' && sql[k + 1] === '/') {
                    depth--;
                    k += 2;
                } else {
                    k++;
                }
            }
            advance(k);
            if (inStatement) buf += ' ';
            continue;
        }
        if (inConditional && ch === '*' && sql[i + 1] === '/') {
            take(i + 2);
            inConditional = false;
            continue;
        }

        // Chaînes et identifiants entre guillemets.
        if (ch === "'" || ch === '"' || (mysql && ch === '`')) {
            const backslashEscapes =
                ch !== '`' &&
                (mysql ||
                    (ch === "'" &&
                        /[eE]/.test(sql[i - 1] ?? '') &&
                        !isIdentChar(sql[i - 2])));
            let k = i + 1;
            while (k < n) {
                if (backslashEscapes && sql[k] === '\\') {
                    k += 2;
                    continue;
                }
                if (sql[k] === ch) {
                    if (sql[k + 1] === ch) {
                        k += 2;
                        continue;
                    }
                    k++;
                    break;
                }
                k++;
            }
            take(k);
            continue;
        }

        // Dollar-quoting PostgreSQL ($$ ou $tag$, pas $1).
        if (!mysql && ch === '$' && !isIdentChar(sql[i - 1])) {
            const open = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(
                sql.slice(i, i + 80)
            );
            if (open) {
                const tag = open[0];
                const close = sql.indexOf(tag, i + tag.length);
                take(close === -1 ? n : close + tag.length);
                continue;
            }
        }

        // Fin d'instruction.
        if (sql.startsWith(delimiter, i)) {
            if (inStatement) {
                const text = flush();
                i += delimiter.length;
                if (
                    !mysql &&
                    /^COPY\b/i.test(text) &&
                    /\bFROM\s+STDIN\b/i.test(text)
                ) {
                    skipCopyData();
                }
            } else {
                i += delimiter.length;
            }
            continue;
        }

        ORDINARY_RUN.lastIndex = i;
        const run = ORDINARY_RUN.exec(sql);
        take(run ? i + run[0].length : i + 1);
    }

    if (startLine !== 0) flush();
    return out;
}

/**
 * Retire les commentaires # MySQL jusqu'à la fin de ligne, en gardant les
 * sauts de ligne (les numéros de ligne restent justes). Les # dans une chaîne,
 * un identifiant, un commentaire -- ou un bloc de commentaire sont conservés.
 */
export function stripMysqlHashComments(sql: string): string {
    const n = sql.length;
    const parts: string[] = [];
    let i = 0;
    let chunkStart = 0;

    const flushChunk = (end: number): void => {
        if (end > chunkStart) parts.push(sql.slice(chunkStart, end));
    };

    while (i < n) {
        const ch = sql[i];

        if (ch === "'" || ch === '"' || ch === '`') {
            let k = i + 1;
            while (k < n) {
                if (ch !== '`' && sql[k] === '\\') {
                    k += 2;
                    continue;
                }
                if (sql[k] === ch) {
                    if (sql[k + 1] === ch) {
                        k += 2;
                        continue;
                    }
                    k++;
                    break;
                }
                k++;
            }
            i = Math.min(k, n);
            continue;
        }

        if (ch === '-' && sql[i + 1] === '-') {
            const k = sql.indexOf('\n', i);
            i = k === -1 ? n : k;
            continue;
        }

        if (ch === '/' && sql[i + 1] === '*') {
            const k = sql.indexOf('*/', i + 2);
            i = k === -1 ? n : k + 2;
            continue;
        }

        if (ch === '#') {
            flushChunk(i);
            const k = sql.indexOf('\n', i);
            i = k === -1 ? n : k;
            // Un \r de fin de ligne est gardé avec le saut de ligne.
            if (i > 0 && sql[i - 1] === '\r') {
                parts.push('\r');
            }
            chunkStart = i;
            continue;
        }

        i++;
    }
    flushChunk(n);
    return parts.join('');
}

// ---------------------------------------------------------------------------
// Classement « repris »
// ---------------------------------------------------------------------------

const ID = '(?:"[^"]*"|`[^`]*`|\\[[^\\]]*\\]|[^\\s(]+)';
const QID = `${ID}(?:\\.${ID})*`;
const ALTER_TABLE = `^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?${QID} `;
const CREATE_TABLE_HEAD = `^CREATE TABLE (?:IF NOT EXISTS )?${QID} `;

interface Matchers {
    createTable: RegExp;
    unreadableCreateTable: RegExp;
    createIndex: RegExp;
    createUniqueIndex: RegExp;
    createView: RegExp;
    createEnum: RegExp;
    addConstraint: RegExp;
    addForeignKey: RegExp;
    alterColumnType: RegExp;
}

const buildMatchers = (flags: string): Matchers => ({
    createTable: new RegExp('^CREATE TABLE (?:IF NOT EXISTS )?\\S', flags),
    // Préfixe CREATE TABLE que le parser ne transforme pas en table.
    unreadableCreateTable: new RegExp(
        `${CREATE_TABLE_HEAD}(?:\\(\\s*LIKE\\b|LIKE\\b|PARTITION OF\\b|AS\\b)`,
        flags
    ),
    createIndex: new RegExp('^CREATE INDEX\\b', flags),
    createUniqueIndex: new RegExp('^CREATE UNIQUE INDEX\\b', flags),
    createView: new RegExp('^CREATE (?:OR REPLACE )?VIEW\\b', flags),
    createEnum: new RegExp(`^CREATE TYPE ${QID} AS ENUM\\b`, flags),
    addConstraint: new RegExp(
        `${ALTER_TABLE}ADD CONSTRAINT ${ID} (?:PRIMARY KEY|FOREIGN KEY|UNIQUE)\\b`,
        flags
    ),
    addForeignKey: new RegExp(
        `${ALTER_TABLE}ADD CONSTRAINT ${ID} FOREIGN KEY\\b`,
        flags
    ),
    alterColumnType: new RegExp(
        `${ALTER_TABLE}ALTER (?:COLUMN )?${ID} (?:SET DATA )?TYPE\\b`,
        flags
    ),
});

const INSENSITIVE = buildMatchers('i');
// Le parser pg_dump compare avec startsWith, sensible à la casse.
const SENSITIVE = buildMatchers('');

const CONDITIONAL_MARKER = /\/\*M?!\d*/g;

// Texte d'une instruction prêt à être classé : marqueurs conditionnels
// retirés, espaces compactés.
const normalize = (sql: string): string =>
    sql
        .replace(CONDITIONAL_MARKER, ' ')
        .replace(/\*\//g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export function isStatementReprised(
    sql: string,
    context: StatementContext
): boolean {
    const raw = sql.trimStart();
    if (raw.startsWith('\\')) return false;

    const mysql = context.dialect === 'mysql';
    // Un commentaire conditionnel MySQL n'est jamais repris.
    if (mysql && /^\/\*M?!/.test(raw)) return false;

    const m = !mysql && context.pgDumpFormat ? SENSITIVE : INSENSITIVE;
    const text = normalize(raw);

    if (m.createTable.test(text)) {
        return !m.unreadableCreateTable.test(text);
    }
    if (m.createIndex.test(text)) return true;

    if (mysql) {
        return (
            m.createUniqueIndex.test(text) ||
            m.createView.test(text) ||
            m.addForeignKey.test(text)
        );
    }
    if (context.pgDumpFormat) {
        return m.addConstraint.test(text);
    }
    // PostgreSQL texte simple. Mesuré contre le parser : seule la clé étrangère
    // est lue dans un ADD CONSTRAINT, ni PRIMARY KEY ni UNIQUE.
    return (
        m.createUniqueIndex.test(text) ||
        m.createView.test(text) ||
        m.createEnum.test(text) ||
        m.addForeignKey.test(text) ||
        m.alterColumnType.test(text)
    );
}

// ---------------------------------------------------------------------------
// Type et raison (RG-24 : mots-clés d'une liste blanche et phrases fixes)
// ---------------------------------------------------------------------------

const VERBS = new Set([
    'CREATE',
    'DROP',
    'ALTER',
    'RENAME',
    'TRUNCATE',
    'INSERT',
    'REPLACE',
    'UPDATE',
    'DELETE',
    'COPY',
    'SET',
    'RESET',
    'SHOW',
    'SELECT',
    'USE',
    'GRANT',
    'REVOKE',
    'COMMENT',
    'LOCK',
    'UNLOCK',
    'BEGIN',
    'START',
    'COMMIT',
    'ROLLBACK',
    'SAVEPOINT',
    'RELEASE',
    'ANALYZE',
    'VACUUM',
    'REINDEX',
    'REFRESH',
    'CLUSTER',
    'CALL',
    'DO',
    'EXECUTE',
    'PREPARE',
    'DECLARE',
    'WITH',
    'DELIMITER',
]);

// Verbes suivis d'un mot désignant le type d'objet.
const OBJECT_VERBS = new Set([
    'CREATE',
    'DROP',
    'ALTER',
    'RENAME',
    'TRUNCATE',
    'LOCK',
    'UNLOCK',
    'START',
    'COMMENT',
    'REFRESH',
]);

const OBJECTS = new Set([
    'TABLE',
    'TABLES',
    'INDEX',
    'VIEW',
    'FUNCTION',
    'PROCEDURE',
    'TRIGGER',
    'SEQUENCE',
    'SCHEMA',
    'TYPE',
    'EXTENSION',
    'DATABASE',
    'EVENT',
    'USER',
    'ROLE',
    'DOMAIN',
    'POLICY',
    'RULE',
    'AGGREGATE',
    'OPERATOR',
    'COLLATION',
    'TABLESPACE',
    'SERVER',
    'PUBLICATION',
    'SUBSCRIPTION',
    'TRANSACTION',
    'ON',
]);

// Mots conservés dans le type (utiles : « CREATE UNLOGGED TABLE »).
const KEPT_MODIFIERS = new Set([
    'UNIQUE',
    'TEMP',
    'TEMPORARY',
    'GLOBAL',
    'LOCAL',
    'UNLOGGED',
    'MATERIALIZED',
]);

// Mots sautés sans rien garder.
const SKIPPED_MODIFIERS = new Set(['OR', 'REPLACE', 'RECURSIVE']);

const QUOTED_NAME = '(?:`[^`]*`|\'[^\']*\'|"[^"]*"|[^\\s@]+)';
const DEFINER = new RegExp(
    `\\bDEFINER\\s*=\\s*${QUOTED_NAME}(?:@${QUOTED_NAME})?(?:\\(\\))?`,
    'gi'
);
const ALGORITHM = /\bALGORITHM\s*=\s*\w+/gi;
const SQL_SECURITY = /\bSQL\s+SECURITY\s+\w+/gi;

const HEAD_LENGTH = 400;

// Tête de l'instruction sans DEFINER=…, ALGORITHM=… ni SQL SECURITY …
const head = (sql: string): string =>
    normalize(sql.trimStart().slice(0, HEAD_LENGTH * 2))
        .replace(DEFINER, ' ')
        .replace(ALGORITHM, ' ')
        .replace(SQL_SECURITY, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, HEAD_LENGTH);

/** Type de l'instruction : ses mots-clés de tête, jamais un identifiant. */
export function getStatementType(sql: string): string {
    const text = head(sql);

    const psql = /^\\[A-Za-z]*/.exec(text);
    if (psql) return psql[0].toUpperCase().slice(0, MAX_TYPE_LENGTH);

    let rest = text;
    const nextWord = (): string | null => {
        const m = /^\s*([A-Za-z_]+)/.exec(rest);
        if (!m) return null;
        rest = rest.slice(m[0].length);
        return m[1].toUpperCase();
    };

    const verb = nextWord();
    if (verb === null || !VERBS.has(verb)) return 'INCONNU';
    const parts = [verb];

    if (OBJECT_VERBS.has(verb)) {
        let word = nextWord();
        while (
            word !== null &&
            (KEPT_MODIFIERS.has(word) || SKIPPED_MODIFIERS.has(word))
        ) {
            if (KEPT_MODIFIERS.has(word)) parts.push(word);
            word = nextWord();
        }
        if (word !== null && OBJECTS.has(word)) parts.push(word);
    }
    return parts.join(' ').slice(0, MAX_TYPE_LENGTH);
}

export const RAISON_DONNEES =
    'Instruction de données (insertion, copie ou modification de lignes), sans effet sur le schéma : non reprise.';
export const RAISON_SESSION =
    'Paramètre de session ou de connexion, sans effet sur le schéma : non repris.';
export const RAISON_TRANSACTION =
    'Gestion de transaction ou de verrou, sans effet sur le schéma : non reprise.';
export const RAISON_DROITS =
    "Gestion des droits d'accès, sans effet sur le schéma : non reprise.";
export const RAISON_SUPPRESSION =
    "Suppression d'un objet : non reprise, le schéma importé ne contient que les objets créés par le dump.";
export const RAISON_OBJET =
    "Objet non pris en charge par l'éditeur (séquence, fonction, procédure, déclencheur, schéma, table temporaire, etc.) : non repris.";
export const RAISON_MODIFICATION =
    "Modification d'un objet non reprise par l'analyse du dump.";
export const RAISON_PSQL = 'Commande du client psql, sans effet sur le schéma';
export const RAISON_DELIMITER =
    'Commande du client mysql, sans effet sur le schéma';
export const RAISON_INCONNUE = 'Instruction non reconnue : non reprise.';
export const RAISON_APRES_DONNEES =
    "Instruction placée juste après des données COPY ou une commande psql : l'analyseur ne la lit pas, elle n'est pas reprise.";

const SESSION_SELECT = /^SELECT (?:pg_catalog\.)?(?:set_config|setval)\b/i;

/** Phrase fixe selon la catégorie de l'instruction. */
export function getStatementReason(sql: string): string {
    const type = getStatementType(sql);
    if (type.startsWith('\\')) return RAISON_PSQL;
    if (type === 'DELIMITER') return RAISON_DELIMITER;

    const verb = type.split(' ')[0];
    switch (verb) {
        case 'INSERT':
        case 'REPLACE':
        case 'UPDATE':
        case 'DELETE':
        case 'TRUNCATE':
        case 'COPY':
            return RAISON_DONNEES;
        case 'SET':
        case 'RESET':
        case 'SHOW':
        case 'USE':
            return RAISON_SESSION;
        case 'SELECT':
            return SESSION_SELECT.test(head(sql))
                ? RAISON_SESSION
                : RAISON_INCONNUE;
        case 'BEGIN':
        case 'START':
        case 'COMMIT':
        case 'ROLLBACK':
        case 'SAVEPOINT':
        case 'RELEASE':
        case 'LOCK':
        case 'UNLOCK':
            return RAISON_TRANSACTION;
        case 'GRANT':
        case 'REVOKE':
            return RAISON_DROITS;
        case 'DROP':
            return RAISON_SUPPRESSION;
        case 'CREATE':
            return RAISON_OBJET;
        case 'ALTER':
        case 'RENAME':
        case 'COMMENT':
        case 'REFRESH':
        case 'REINDEX':
        case 'ANALYZE':
        case 'VACUUM':
        case 'CLUSTER':
            return RAISON_MODIFICATION;
        default:
            return RAISON_INCONNUE;
    }
}

/**
 * Une entrée par instruction que le parser ChartDB ne reprend pas. Aucune
 * instruction n'est ignorée en silence.
 */
export function buildDumpReport(
    sql: string,
    dialect: DumpDialect
): DumpReportEntry[] {
    const context: StatementContext = {
        dialect,
        pgDumpFormat: dialect === 'postgresql' && isPgDumpFormat(sql),
    };
    const report: DumpReportEntry[] = [];
    for (const statement of splitDumpStatements(sql, dialect)) {
        const reprised = isStatementReprised(statement.sql, context);
        // Le parser pg_dump colle les données COPY et les commandes psql (sans
        // « ; ») à l'instruction suivante, qu'il ne reconnaît plus : elle est
        // perdue même si son type est lu. Perte annoncée, jamais silencieuse.
        const lost =
            reprised && context.pgDumpFormat && statement.followsClientData;
        if (reprised && !lost) continue;
        report.push({
            ligne: statement.line,
            type: getStatementType(statement.sql),
            raison: lost
                ? RAISON_APRES_DONNEES
                : getStatementReason(statement.sql),
        });
    }
    return report;
}
