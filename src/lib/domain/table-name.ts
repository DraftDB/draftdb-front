import type { DBTable } from './db-table';

/** Longueur maximale d'un nom de table acceptée par le back. */
export const MAX_TABLE_NAME_LENGTH = 63;

export type TableNameError = 'empty' | 'too_long' | 'taken';

type NamedTable = Pick<DBTable, 'name' | 'schema' | 'isView'>;

/** null, absent et chaîne vide sont le même schéma (COALESCE côté back). */
const normalizeSchema = (schema: string | null | undefined): string =>
    schema ?? '';

/**
 * Comparaison du back : `t.nom = :nom AND COALESCE(t.schema_sql, '') = :schema`.
 * Nom exact, casse comprise ; le client ne doit pas être plus strict.
 */
const isNameTakenInSchema = (
    name: string,
    tables: Pick<DBTable, 'name' | 'schema'>[],
    schema: string | null | undefined
): boolean => {
    const wanted = normalizeSchema(schema);
    return tables.some(
        (t) => t.name === name && normalizeSchema(t.schema) === wanted
    );
};

/**
 * Prochain `table_N` / `view_N` libre. N part du nombre de tables (ou de vues)
 * + 1. Volontairement prudent : ni la casse ni le schéma ne comptent, un nom
 * proche d'un nom existant est évité.
 */
export const getDefaultTableName = (
    tables: NamedTable[],
    isView: boolean
): string => {
    const prefix = isView ? 'view_' : 'table_';
    const taken = new Set(tables.map((t) => t.name.toLowerCase()));
    let n = tables.filter((t) => !!t.isView === isView).length + 1;
    while (taken.has(`${prefix}${n}`)) {
        n += 1;
    }
    return `${prefix}${n}`;
};

/**
 * `base` si le nom est libre dans le schéma, sinon `base_2`, `base_3`…
 * (ex. `x_copy`, `x_copy_2`). La base est tronquée pour tenir en 63 caractères.
 * Même règle de comparaison que le back (même schéma, casse comprise).
 */
export const getUniqueTableName = ({
    tables,
    baseName,
    schema,
}: {
    tables: Pick<DBTable, 'name' | 'schema'>[];
    baseName: string;
    schema: string | null | undefined;
}): string => {
    const first = baseName.slice(0, MAX_TABLE_NAME_LENGTH);
    if (!isNameTakenInSchema(first, tables, schema)) {
        return first;
    }
    for (let n = 2; ; n += 1) {
        const suffix = `_${n}`;
        const candidate = `${baseName.slice(0, MAX_TABLE_NAME_LENGTH - suffix.length)}${suffix}`;
        if (!isNameTakenInSchema(candidate, tables, schema)) {
            return candidate;
        }
    }
};

/**
 * Valide un nom saisi : les espaces autour sont retirés avant contrôle.
 * Renvoie null si le nom est valide.
 */
export const validateTableName = (
    name: string,
    tables: Pick<DBTable, 'name' | 'schema'>[],
    schema: string | null | undefined
): TableNameError | null => {
    const trimmed = name.trim();
    if (trimmed === '') {
        return 'empty';
    }
    if (trimmed.length > MAX_TABLE_NAME_LENGTH) {
        return 'too_long';
    }
    if (isNameTakenInSchema(trimmed, tables, schema)) {
        return 'taken';
    }
    return null;
};
