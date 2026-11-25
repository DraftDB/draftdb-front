import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBField } from '@/lib/domain/db-field';
import type { DBIndex } from '@/lib/domain/db-index';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import { ApiError, apiRequest, getServerMessage } from './http-client';

/** Longueur maximale du nom d'un projet acceptée par le back. */
export const MAX_NOM_PROJET_LENGTH = 100;
/** Longueur maximale de la description d'un projet acceptée par le back. */
export const MAX_DESCRIPTION_PROJET_LENGTH = 500;

/** Corps de POST /api/projets. Le dialecte n'est pas demandé (P5). */
export interface CreerProjetRequest {
    nom: string;
    description?: string;
}

export interface ProjetResponse {
    id_projet: string;
    nom: string;
    description: string | null;
    type_base: 'generic' | (string & {});
    numero_sequence: number;
}

export interface CreerProjetValidationErrors {
    nom?: 'required' | 'too_long';
    description?: 'too_long';
}

/**
 * Contrôle client avant envoi, sur les valeurs sans espaces de début et de fin.
 * Le serveur reste l'autorité (422).
 */
export const validateCreerProjet = ({
    nom,
    description,
}: CreerProjetRequest): CreerProjetValidationErrors => {
    const errors: CreerProjetValidationErrors = {};
    const trimmedNom = nom.trim();
    if (trimmedNom === '') {
        errors.nom = 'required';
    } else if (trimmedNom.length > MAX_NOM_PROJET_LENGTH) {
        errors.nom = 'too_long';
    }
    if ((description ?? '').trim().length > MAX_DESCRIPTION_PROJET_LENGTH) {
        errors.description = 'too_long';
    }
    return errors;
};

export const hasValidationErrors = (
    errors: CreerProjetValidationErrors
): boolean => Object.keys(errors).length > 0;

/** Nom sans espaces superflus ; description retirée si vide. */
export const toCreerProjetBody = ({
    nom,
    description,
}: CreerProjetRequest): CreerProjetRequest => {
    const trimmedDescription = (description ?? '').trim();
    return {
        nom: nom.trim(),
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
    };
};

export const creerProjet = (
    request: CreerProjetRequest
): Promise<ProjetResponse> =>
    apiRequest<ProjetResponse>('/api/projets', {
        method: 'POST',
        body: toCreerProjetBody(request),
    });

export type ProjetApiErrorKind =
    | 'network'
    | 'unauthenticated'
    | 'validation'
    | 'unknown';

/** Déduit le cas d'erreur du statut HTTP : 0 réseau, 401, 422, sinon inconnu. */
export const getProjetApiErrorKind = (error: unknown): ProjetApiErrorKind => {
    if (!(error instanceof ApiError)) {
        return 'unknown';
    }
    switch (error.status) {
        case 0:
            return 'network';
        case 401:
            return 'unauthenticated';
        case 422:
            return 'validation';
        default:
            return 'unknown';
    }
};

export interface ProjetApiErrorDescription {
    kind: ProjetApiErrorKind;
    titleKey: 'api_errors.projet.title';
    descriptionKey: `api_errors.projet.${ProjetApiErrorKind}`;
    /** Motif exact du back, renseigné seulement pour un 422. */
    serverMessage?: string;
}

export const describeProjetApiError = (
    error: unknown
): ProjetApiErrorDescription => {
    const kind = getProjetApiErrorKind(error);
    return {
        kind,
        titleKey: 'api_errors.projet.title',
        descriptionKey: `api_errors.projet.${kind}`,
        serverMessage:
            kind === 'validation' ? getServerMessage(error) : undefined,
    };
};

// ---------------------------------------------------------------------------
// Ouverture d'un projet (CU 1.6) : GET /api/projets/{id_projet}
// ---------------------------------------------------------------------------

export type TypeBase = 'generic' | 'mysql' | 'postgresql';

/** Date telle que renvoyée en JSON (chaîne ISO), ou déjà convertie. */
type ApiDate = string | number | Date;

/**
 * Diagramme ChartDB renvoyé par le back : même forme que `Diagram`, mais les
 * dates arrivent en chaînes (JSON) et les tableaux peuvent manquer.
 */
export type DiagrammeApi = Omit<Diagram, 'createdAt' | 'updatedAt'> & {
    createdAt?: ApiDate | null;
    updatedAt?: ApiDate | null;
};

export interface ProjetOuvertResponse {
    id_projet: string;
    nom: string;
    description?: string | null;
    type_base: TypeBase | (string & {});
    numero_sequence: number;
    diagramme: DiagrammeApi;
}

/** GET /api/projets/{id_projet} : lecture seule, aucune écriture serveur. */
export const ouvrirProjet = (
    idProjet: string,
    { signal }: { signal?: AbortSignal } = {}
): Promise<ProjetOuvertResponse> =>
    apiRequest<ProjetOuvertResponse>(
        `/api/projets/${encodeURIComponent(idProjet)}`,
        { method: 'GET', signal }
    );

const TYPE_BASE_TO_DATABASE_TYPE: Record<TypeBase, DatabaseType> = {
    generic: DatabaseType.GENERIC,
    mysql: DatabaseType.MYSQL,
    postgresql: DatabaseType.POSTGRESQL,
};

/** type_base du back → DatabaseType ChartDB ; valeur inconnue → GENERIC. */
export const typeBaseToDatabaseType = (typeBase: string): DatabaseType =>
    TYPE_BASE_TO_DATABASE_TYPE[typeBase as TypeBase] ?? DatabaseType.GENERIC;

const toDate = (value: ApiDate | null | undefined, fallback: Date): Date => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? fallback : value;
    }
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
};

/** createdAt des éléments : nombre (ms) dans ChartDB, chaîne tolérée. */
const toTimestamp = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value !== '') {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
            return asNumber;
        }
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.getTime();
    }
    return fallback;
};

const withTimestamp = <T extends { createdAt: number }>(
    item: T,
    fallback: number
): T => ({ ...item, createdAt: toTimestamp(item.createdAt, fallback) });

const toLocalTable = (table: DBTable, fallback: number): DBTable => ({
    ...withTimestamp(table, fallback),
    // L'ordre des colonnes et des index est celui du serveur.
    fields: (table.fields ?? []).map((field: DBField) =>
        withTimestamp(field, fallback)
    ),
    indexes: (table.indexes ?? []).map((index: DBIndex) =>
        withTimestamp(index, fallback)
    ),
});

/**
 * Réponse d'ouverture → diagramme à écrire dans Dexie. Le serveur fait foi :
 * id = id_projet, name = nom, databaseType déduit de type_base. Les ids des
 * éléments ne sont jamais régénérés.
 */
export const toLocalDiagram = (
    response: ProjetOuvertResponse,
    now: Date = new Date()
): Diagram => {
    const diagramme = response.diagramme ?? ({} as DiagrammeApi);
    const fallback = now.getTime();
    const createdAt = toDate(diagramme.createdAt, now);

    return {
        ...diagramme,
        id: response.id_projet,
        name: response.nom,
        databaseType: typeBaseToDatabaseType(response.type_base),
        tables: (diagramme.tables ?? []).map((table) =>
            toLocalTable(table, fallback)
        ),
        relationships: (diagramme.relationships ?? []).map(
            (relationship: DBRelationship) =>
                withTimestamp(relationship, fallback)
        ),
        dependencies: (diagramme.dependencies ?? []).map((dependency) =>
            withTimestamp(dependency, fallback)
        ),
        areas: diagramme.areas ?? [],
        customTypes: diagramme.customTypes ?? [],
        notes: diagramme.notes ?? [],
        createdAt,
        updatedAt: toDate(diagramme.updatedAt, createdAt),
    };
};

const NUMERO_SEQUENCE_KEY_PREFIX = 'draftdb_numero_sequence:';

/**
 * Dernier numero_sequence connu d'un projet (utile aux écritures suivantes).
 * Conservé hors de Dexie : pas de changement de schéma.
 */
export const getNumeroSequence = (idProjet: string): number | undefined => {
    try {
        const raw = localStorage.getItem(
            `${NUMERO_SEQUENCE_KEY_PREFIX}${idProjet}`
        );
        if (raw === null) {
            return undefined;
        }
        const value = Number(raw);
        return Number.isFinite(value) ? value : undefined;
    } catch {
        return undefined;
    }
};

export const setNumeroSequence = (idProjet: string, value: number): void => {
    if (!Number.isFinite(value)) {
        return;
    }
    try {
        localStorage.setItem(
            `${NUMERO_SEQUENCE_KEY_PREFIX}${idProjet}`,
            String(value)
        );
    } catch {
        // localStorage indisponible : la valeur sera relue au prochain GET.
    }
};

export type OuvrirProjetApiErrorKind =
    | 'network'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'server'
    | 'unknown';

/** Statut HTTP → cas d'erreur d'ouverture (0 = réseau). */
export const getOuvrirProjetApiErrorKind = (
    error: unknown
): OuvrirProjetApiErrorKind => {
    if (!(error instanceof ApiError)) {
        return 'unknown';
    }
    if (error.status === 0) {
        return 'network';
    }
    if (error.status >= 500) {
        return 'server';
    }
    switch (error.status) {
        case 401:
            return 'unauthenticated';
        case 403:
            return 'forbidden';
        case 404:
            return 'not_found';
        default:
            return 'unknown';
    }
};

export interface OuvrirProjetApiErrorDescription {
    kind: OuvrirProjetApiErrorKind;
    titleKey: `api_errors.projet_open.title_${OuvrirProjetApiErrorKind}`;
    descriptionKey: `api_errors.projet_open.${OuvrirProjetApiErrorKind}`;
    /**
     * Vrai pour 401, 403 et 404 : le projet ne doit pas être ouvert, même
     * depuis une copie locale.
     */
    blocking: boolean;
}

export const describeOuvrirProjetApiError = (
    error: unknown
): OuvrirProjetApiErrorDescription => {
    const kind = getOuvrirProjetApiErrorKind(error);
    return {
        kind,
        titleKey: `api_errors.projet_open.title_${kind}`,
        descriptionKey: `api_errors.projet_open.${kind}`,
        blocking:
            kind === 'unauthenticated' ||
            kind === 'forbidden' ||
            kind === 'not_found',
    };
};
