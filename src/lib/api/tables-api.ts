import type { DBTable } from '@/lib/domain/db-table';
import type { DBIndex } from '@/lib/domain/db-index';
import { ApiError, apiRequest, getServerMessage } from './http-client';

/** Longueur maximale d'un nom (table, colonne, index) acceptée par le back. */
export const MAX_NAME_LENGTH = 63;

/** Seul code d'avertissement connu ; le type reste ouvert pour les futurs codes. */
export const TABLE_SANS_CLE_PRIMAIRE = 'TABLE_SANS_CLE_PRIMAIRE';

export interface TableAvertissement {
    code: typeof TABLE_SANS_CLE_PRIMAIRE | (string & {});
    message: string;
}

export interface PostTableResponse {
    table: DBTable;
    numero_sequence: number;
    /** Toujours présent dans la réponse : null s'il n'y a rien à signaler. */
    avertissement: TableAvertissement | null;
}

export type TableBody = Omit<DBTable, 'schema'> & { schema?: string };

const isBlank = (value: string | null | undefined): boolean =>
    !value || value.trim() === '';

/** prefix + base + suffix, la base étant tronquée pour tenir en 63 caractères. */
const buildIndexName = (prefix: string, base: string, suffix: string): string =>
    `${prefix}${base.slice(0, MAX_NAME_LENGTH - prefix.length - suffix.length)}${suffix}`;

/**
 * Corps envoyé à POST /api/projets/{id}/tables : le DBTable de ChartDB tel quel
 * (camelCase, ids conservés), avec deux corrections que le back exige :
 *  - un schéma vide, null ou absent est retiré (le back refuse '') ;
 *  - un index sans nom (l'index de clé primaire auto-généré par ChartDB est
 *    nommé '') reçoit un nom : <table>_pkey pour la clé primaire,
 *    idx_<table>_<n> pour un autre.
 * La table passée n'est jamais modifiée : l'état local garde ses noms vides.
 */
export const toTableBody = (table: DBTable): TableBody => {
    const { schema, indexes, ...rest } = table;

    let unnamedIndexCount = 0;
    const namedIndexes: DBIndex[] = indexes.map((index) => {
        if (!isBlank(index.name)) {
            return index;
        }
        if (index.isPrimaryKey) {
            return {
                ...index,
                name: buildIndexName('', table.name, '_pkey'),
            };
        }
        unnamedIndexCount += 1;
        return {
            ...index,
            name: buildIndexName('idx_', table.name, `_${unnamedIndexCount}`),
        };
    });

    return {
        ...rest,
        ...(isBlank(schema) ? {} : { schema: schema as string }),
        indexes: namedIndexes,
    };
};

/** En mode API, l'id du diagramme est l'id du projet (UUID renvoyé par POST /api/projets). */
export const postTable = (
    diagramId: string,
    table: DBTable
): Promise<PostTableResponse> =>
    apiRequest<PostTableResponse>(
        `/api/projets/${encodeURIComponent(diagramId)}/tables`,
        { method: 'POST', body: toTableBody(table) }
    );

export interface DeleteTableResponse {
    id_table: string;
    numero_sequence: number;
}

export interface TableForeignKeyLink {
    id: string;
    name: string;
    sourceTableId: string;
    targetTableId: string;
    sourceFieldId: string;
    targetFieldId: string;
}

export interface TableIndexLink {
    id: string;
    name: string;
}

/** Liens de la table renvoyés par le serveur dans le 409 (jamais calculés ici). */
export interface TableLinks {
    cles_etrangeres: TableForeignKeyLink[];
    index: TableIndexLink[];
}

/** Seul code métier du back : première demande de suppression, sans confirmation. */
export const CONFIRMATION_REQUISE = 'CONFIRMATION_REQUISE';

/**
 * DELETE /api/projets/{id}/tables/{id_table}?confirme_suppression=false|true.
 * Le paramètre est envoyé à chaque appel. Pas de corps de requête.
 */
export const deleteTable = (
    projetId: string,
    tableId: string,
    { confirmation }: { confirmation: boolean },
    signal?: AbortSignal
): Promise<DeleteTableResponse> =>
    apiRequest<DeleteTableResponse>(
        `/api/projets/${encodeURIComponent(projetId)}/tables/${encodeURIComponent(tableId)}`,
        {
            method: 'DELETE',
            query: { confirme_suppression: confirmation ? 'true' : 'false' },
            signal,
        }
    );

export const isConfirmationRequired = (error: unknown): error is ApiError =>
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === CONFIRMATION_REQUISE;

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Liens du 409 : lit uniquement details.detail.cles_etrangeres et .index.
 * Un tableau absent devient [] ; si les deux manquent, null (réponse inattendue).
 */
export const getTableLinksFromConfirmation = (
    error: unknown
): TableLinks | null => {
    if (!isConfirmationRequired(error) || !isRecord(error.details)) {
        return null;
    }
    const { detail } = error.details;
    if (!isRecord(detail)) {
        return null;
    }
    const { cles_etrangeres, index } = detail;
    if (!Array.isArray(cles_etrangeres) && !Array.isArray(index)) {
        return null;
    }
    return {
        cles_etrangeres: Array.isArray(cles_etrangeres)
            ? (cles_etrangeres.filter(
                  isRecord
              ) as unknown as TableForeignKeyLink[])
            : [],
        index: Array.isArray(index)
            ? (index.filter(isRecord) as unknown as TableIndexLink[])
            : [],
    };
};

export type TableApiErrorKind =
    | 'network'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'validation'
    | 'unknown';

/**
 * Déduit le cas d'erreur du seul statut HTTP (le back n'a pas de code métier) :
 * 0 réseau, 401, 403, 404, 422, sinon inconnu.
 */
export const getTableApiErrorKind = (error: unknown): TableApiErrorKind => {
    if (!(error instanceof ApiError)) {
        return 'unknown';
    }
    switch (error.status) {
        case 0:
            return 'network';
        case 401:
            return 'unauthenticated';
        case 403:
            return 'forbidden';
        case 404:
            return 'not_found';
        case 422:
            return 'validation';
        default:
            return 'unknown';
    }
};

export type TableApiOperation = 'create' | 'delete';

type TableApiErrorNamespace = 'api_errors.table' | 'api_errors.table_delete';

export interface TableApiErrorDescription {
    kind: TableApiErrorKind;
    titleKey: `${TableApiErrorNamespace}.title`;
    descriptionKey: `${TableApiErrorNamespace}.${TableApiErrorKind}`;
    /** Motif exact du back, renseigné seulement pour un 422. */
    serverMessage?: string;
}

export const describeTableApiError = (
    error: unknown,
    operation: TableApiOperation = 'create'
): TableApiErrorDescription => {
    const kind = getTableApiErrorKind(error);
    const namespace: TableApiErrorNamespace =
        operation === 'delete' ? 'api_errors.table_delete' : 'api_errors.table';
    return {
        kind,
        titleKey: `${namespace}.title`,
        descriptionKey: `${namespace}.${kind}`,
        serverMessage:
            kind === 'validation' ? getServerMessage(error) : undefined,
    };
};
