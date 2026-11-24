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
