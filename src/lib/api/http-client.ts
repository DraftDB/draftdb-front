import { API_URL, PROJECT_ID, USER_ID } from '@/lib/env';

export interface ApiErrorInit {
    status: number;
    code?: string;
    message: string;
    details?: unknown;
}

/** status 0 = erreur réseau (pas de réponse du serveur). */
export class ApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;

    constructor({ status, code, message, details }: ApiErrorInit) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

const USER_ID_STORAGE_KEY = 'draftdb_user_id';

const baseUrl = (): string => (API_URL ?? '').trim().replace(/\/+$/, '');

/** Vrai si API_URL n'est pas vide, "/" compris. */
export const isApiConfigured = (): boolean => (API_URL ?? '').trim() !== '';

/** PROVISOIRE : remplacé par l'authentification. */
export const getAuthHeaders = (): Record<string, string> => {
    let id = '';
    try {
        id = localStorage.getItem(USER_ID_STORAGE_KEY)?.trim() ?? '';
    } catch {
        // localStorage indisponible
    }
    id = id || (USER_ID ?? '').trim();
    return id ? { 'X-User-Id': id } : {};
};

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vrai si l'id a la forme d'un UUID, comme les id_projet du back. */
export const isUuid = (id: string | undefined | null): id is string =>
    typeof id === 'string' && UUID_PATTERN.test(id);

/**
 * Source de l'{id_projet} de tous les appels. Un diagramme dont l'id est un
 * UUID est un projet ouvert depuis le serveur : son id fait foi.
 * PROVISOIRE (comme PROJECT_ID) : un diagramme ChartDB local n'a pas d'UUID,
 * PROJECT_ID désigne alors le projet existant visé par le back.
 */
export const getProjetId = (diagramId: string): string =>
    isUuid(diagramId) ? diagramId : (PROJECT_ID ?? '').trim() || diagramId;

export interface ApiRequestOptions {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined | null>;
    signal?: AbortSignal;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const buildError = (status: number, payload: unknown): ApiError => {
    const fallback = `HTTP ${status}`;
    if (isRecord(payload)) {
        const { detail } = payload;
        if (typeof detail === 'string') {
            return new ApiError({
                status,
                message: detail,
                details: payload,
            });
        }
        // detail objet : le code est lu même sans message (ex. les 409
        // CONFIRMATION_REQUISE du back). details reste le corps complet, comme
        // dans les autres branches, pour getServerMessage et les appelants.
        if (
            isRecord(detail) &&
            (typeof detail.code === 'string' ||
                typeof detail.message === 'string')
        ) {
            return new ApiError({
                status,
                code: typeof detail.code === 'string' ? detail.code : undefined,
                message:
                    typeof detail.message === 'string'
                        ? detail.message
                        : fallback,
                details: payload,
            });
        }
        if (typeof payload.message === 'string') {
            return new ApiError({
                status,
                code:
                    typeof payload.code === 'string' ? payload.code : undefined,
                message: payload.message,
                details: payload,
            });
        }
    }
    return new ApiError({ status, message: fallback, details: payload });
};

export async function apiRequest<T>(
    path: string,
    { method = 'GET', body, query, signal }: ApiRequestOptions = {}
): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null) {
            params.append(key, String(value));
        }
    }
    const qs = params.toString();
    const url = `${baseUrl()}${path.startsWith('/') ? '' : '/'}${path}${
        qs ? `?${qs}` : ''
    }`;

    const headers: Record<string, string> = {
        Accept: 'application/json',
        ...getAuthHeaders(),
    };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal,
        });
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
            throw e;
        }
        throw new ApiError({
            status: 0,
            message: e instanceof Error ? e.message : 'Network error',
            details: e,
        });
    }

    const text = await response.text().catch(() => '');
    let payload: unknown;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = text;
        }
    }

    if (!response.ok) {
        throw buildError(response.status, payload);
    }
    return payload as T;
}

/**
 * Message lisible renvoyé par le serveur : le detail texte, ou le premier
 * message pydantic suivi de son emplacement sans « body »
 * (ex. « Field required (fields.0.name) »). undefined si rien d'exploitable.
 */
export const getServerMessage = (error: unknown): string | undefined => {
    if (!(error instanceof ApiError) || !isRecord(error.details)) {
        return undefined;
    }
    const { detail } = error.details;
    if (typeof detail === 'string') {
        return detail || undefined;
    }
    if (Array.isArray(detail)) {
        const first = detail.find(
            (d): d is Record<string, unknown> =>
                isRecord(d) && typeof d.msg === 'string'
        );
        if (first) {
            const loc = Array.isArray(first.loc)
                ? first.loc.filter((p) => p !== 'body').join('.')
                : '';
            return loc ? `${first.msg} (${loc})` : String(first.msg);
        }
    }
    return undefined;
};
