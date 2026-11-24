import type { Diagram } from '@/lib/domain/diagram';
import type { DBTable } from '@/lib/domain/db-table';
import { DatabaseType } from '@/lib/domain/database-type';
import { ApiError, apiRequest, getServerMessage } from './http-client';

/** Longueur maximale d'un nom (table, colonne, index) acceptée par le back. */
const MAX_NAME_LENGTH = 63;
const PKEY_SUFFIX = '_pkey';

export type ImportDialecte = 'mysql' | 'postgresql';

/** Entrée du rapport : jamais le texte d'une instruction (RG-24). */
export interface InstructionNonReprise {
    ligne?: number | null;
    type: string;
    raison: string;
}

/**
 * Diagramme ChartDB envoyé tel quel (camelCase, ids conservés : RG-09),
 * construit à la main et non via diagramToJSONOutput qui renumérote les ids.
 * Pas de createdAt/updatedAt : le back ne les lit pas.
 */
export type ImportDiagram = Pick<Diagram, 'id' | 'name'> &
    Required<
        Pick<
            Diagram,
            | 'tables'
            | 'relationships'
            | 'areas'
            | 'notes'
            | 'customTypes'
            | 'dependencies'
        >
    > & {
        databaseType: DatabaseType.POSTGRESQL | DatabaseType.MYSQL;
    };

export interface ImportDumpRequest {
    confirme_remplacement: boolean;
    fichier: {
        nom: string;
        dialecte: ImportDialecte;
        taille_octets: number;
    };
    diagramme: ImportDiagram;
    rapport: { non_repris: InstructionNonReprise[] };
}

export interface ImportDumpResponse {
    id_import: string;
    numero_sequence: number;
    nb_elements_crees: number;
}

const isBlank = (value: string | null | undefined): boolean =>
    !value || value.trim() === '';

/**
 * Corrige la sortie de sqlImportToDiagram, refusée telle quelle par le back,
 * sans changer aucun identifiant :
 *  - un schéma vide ('' en MySQL) est retiré ;
 *  - l'index de clé primaire sans nom reçoit le nom <table>_pkey (63 car. max).
 * Un index déjà nommé est gardé tel quel ; aucun index n'est retiré.
 * Pure et idempotente.
 */
export const normalizeImportTables = (tables: DBTable[]): DBTable[] =>
    tables.map((table) => {
        const { schema, ...rest } = table;
        const base: DBTable = isBlank(schema)
            ? rest
            : { ...rest, schema: schema as string };
        return {
            ...base,
            indexes: table.indexes.map((index) =>
                index.isPrimaryKey && isBlank(index.name)
                    ? {
                          ...index,
                          name: `${table.name.slice(0, MAX_NAME_LENGTH - PKEY_SUFFIX.length)}${PKEY_SUFFIX}`,
                      }
                    : index
            ),
        };
    });

export const dialecteToDatabaseType = (
    dialecte: ImportDialecte
): ImportDiagram['databaseType'] =>
    dialecte === 'mysql' ? DatabaseType.MYSQL : DatabaseType.POSTGRESQL;

/** Dialecte pré-rempli à partir du type détecté ; undefined si non pris en charge. */
export const databaseTypeToDialecte = (
    type: DatabaseType | null | undefined
): ImportDialecte | undefined => {
    switch (type) {
        case DatabaseType.POSTGRESQL:
        case DatabaseType.COCKROACHDB:
            return 'postgresql';
        case DatabaseType.MYSQL:
        case DatabaseType.MARIADB:
            return 'mysql';
        default:
            return undefined;
    }
};

/**
 * Diagramme à envoyer : id et nom du diagramme courant, contenu analysé dont
 * les tables sont normalisées. Les listes absentes deviennent [].
 */
export const toImportDiagram = (
    current: Pick<Diagram, 'id' | 'name'>,
    parsed: Diagram,
    dialecte: ImportDialecte
): ImportDiagram => ({
    id: current.id,
    name: current.name,
    databaseType: dialecteToDatabaseType(dialecte),
    tables: normalizeImportTables(parsed.tables ?? []),
    relationships: parsed.relationships ?? [],
    areas: parsed.areas ?? [],
    notes: parsed.notes ?? [],
    customTypes: parsed.customTypes ?? [],
    dependencies: parsed.dependencies ?? [],
});

export const postImport = (
    diagramId: string,
    request: ImportDumpRequest,
    signal?: AbortSignal
): Promise<ImportDumpResponse> =>
    apiRequest<ImportDumpResponse>(
        `/api/projets/${encodeURIComponent(diagramId)}/import`,
        { method: 'POST', body: request, signal }
    );

export const CONFIRMATION_REQUISE = 'CONFIRMATION_REQUISE';

/** 409 : le projet contient déjà un schéma, il faut confirmer le remplacement. */
export const isImportConfirmationRequired = (error: unknown): boolean =>
    error instanceof ApiError &&
    (error.status === 409 || error.code === CONFIRMATION_REQUISE);

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Nombre de tables existantes lu dans le 409 (details.detail.nb_tables_existantes,
 * repli details.nb_tables_existantes) ; null si ce n'est pas un nombre.
 */
export const getExistingTablesCount = (error: unknown): number | null => {
    if (!(error instanceof ApiError) || !isRecord(error.details)) {
        return null;
    }
    const { detail } = error.details;
    const count = isRecord(detail)
        ? detail.nb_tables_existantes
        : error.details.nb_tables_existantes;
    return typeof count === 'number' && Number.isFinite(count) ? count : null;
};

export type ImportApiErrorKind =
    | 'network'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'too_large'
    | 'validation'
    | 'unknown';

/** Cas d'erreur déduit du seul statut HTTP. */
export const getImportApiErrorKind = (error: unknown): ImportApiErrorKind => {
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
        case 413:
            return 'too_large';
        case 422:
            return 'validation';
        default:
            return 'unknown';
    }
};

export interface ImportApiErrorDescription {
    kind: ImportApiErrorKind;
    titleKey: 'api_errors.import.title';
    descriptionKey: `api_errors.import.${ImportApiErrorKind}`;
    /** Motif exact du back, renseigné seulement pour un 422. */
    serverMessage?: string;
}

export const describeImportApiError = (
    error: unknown
): ImportApiErrorDescription => {
    const kind = getImportApiErrorKind(error);
    return {
        kind,
        titleKey: 'api_errors.import.title',
        descriptionKey: `api_errors.import.${kind}`,
        serverMessage:
            kind === 'validation' ? getServerMessage(error) : undefined,
    };
};
