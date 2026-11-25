import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
    API_URL: '',
    USER_ID: '',
}));

vi.mock('@/lib/env', () => mockEnv);

import { ApiError } from '../http-client';
import {
    MAX_DESCRIPTION_PROJET_LENGTH,
    MAX_NOM_PROJET_LENGTH,
    creerProjet,
    describeProjetApiError,
    getProjetApiErrorKind,
    hasValidationErrors,
    toCreerProjetBody,
    validateCreerProjet,
} from '../projets-api';

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

const rejection = (promise: Promise<unknown>): Promise<ApiError> =>
    promise.then(
        () => {
            throw new Error('La promesse aurait dû être rejetée');
        },
        (e: unknown) => e as ApiError
    );

const projet = {
    id_projet: '3f2b8c1e-0000-4000-8000-000000000001',
    nom: 'Boutique',
    description: null,
    type_base: 'generic',
    numero_sequence: 0,
};

describe('validateCreerProjet', () => {
    it('refuse un nom vide ou fait d’espaces', () => {
        expect(validateCreerProjet({ nom: '' })).toEqual({ nom: 'required' });
        expect(validateCreerProjet({ nom: '   ' })).toEqual({
            nom: 'required',
        });
    });

    it('accepte un nom de 100 caractères et refuse 101', () => {
        expect(
            validateCreerProjet({ nom: 'a'.repeat(MAX_NOM_PROJET_LENGTH) })
        ).toEqual({});
        expect(
            validateCreerProjet({ nom: 'a'.repeat(MAX_NOM_PROJET_LENGTH + 1) })
        ).toEqual({ nom: 'too_long' });
    });

    it('ignore les espaces de début et de fin pour la longueur', () => {
        expect(
            validateCreerProjet({
                nom: `  ${'a'.repeat(MAX_NOM_PROJET_LENGTH)}  `,
            })
        ).toEqual({});
    });

    it('accepte une description de 500 caractères et refuse 501', () => {
        expect(
            validateCreerProjet({
                nom: 'p',
                description: 'd'.repeat(MAX_DESCRIPTION_PROJET_LENGTH),
            })
        ).toEqual({});
        expect(
            validateCreerProjet({
                nom: 'p',
                description: 'd'.repeat(MAX_DESCRIPTION_PROJET_LENGTH + 1),
            })
        ).toEqual({ description: 'too_long' });
    });

    it('signale les deux champs à la fois', () => {
        const errors = validateCreerProjet({
            nom: '',
            description: 'd'.repeat(MAX_DESCRIPTION_PROJET_LENGTH + 1),
        });
        expect(errors).toEqual({ nom: 'required', description: 'too_long' });
        expect(hasValidationErrors(errors)).toBe(true);
        expect(hasValidationErrors({})).toBe(false);
    });
});

describe('toCreerProjetBody', () => {
    it('retire les espaces et omet une description vide', () => {
        expect(
            toCreerProjetBody({ nom: ' Boutique ', description: '  ' })
        ).toEqual({ nom: 'Boutique' });
        expect(
            toCreerProjetBody({ nom: 'Boutique', description: ' Ventes ' })
        ).toEqual({ nom: 'Boutique', description: 'Ventes' });
    });
});

describe('creerProjet', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        mockEnv.API_URL = 'http://api.test';
        mockEnv.USER_ID = 'user-1';
        localStorage.clear();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('envoie un POST sur /api/projets avec X-User-Id et le corps (201)', async () => {
        fetchMock.mockResolvedValue(jsonResponse(projet, 201));

        const result = await creerProjet({
            nom: ' Boutique ',
            description: 'Ventes',
        });

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://api.test/api/projets');
        expect(init.method).toBe('POST');
        expect(init.headers['X-User-Id']).toBe('user-1');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({
            nom: 'Boutique',
            description: 'Ventes',
        });
        expect(result).toEqual(projet);
    });

    it('utilise l’identifiant du localStorage en priorité', async () => {
        localStorage.setItem('draftdb_user_id', 'user-ls');
        fetchMock.mockResolvedValue(jsonResponse(projet, 201));

        await creerProjet({ nom: 'Boutique' });

        expect(fetchMock.mock.calls[0][1].headers['X-User-Id']).toBe('user-ls');
    });

    it('rejette avec une ApiError 401', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ detail: 'Utilisateur non identifié' }, 401)
        );
        const error = await rejection(creerProjet({ nom: 'Boutique' }));
        expect(error).toBeInstanceOf(ApiError);
        expect(error.status).toBe(401);
        expect(describeProjetApiError(error).kind).toBe('unauthenticated');
    });

    it('rejette avec une ApiError 422 dont le motif est lisible', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(
                {
                    detail: [
                        {
                            loc: ['body', 'nom'],
                            msg: 'String should have at most 100 characters',
                            type: 'string_too_long',
                        },
                    ],
                },
                422
            )
        );
        const error = await rejection(creerProjet({ nom: 'Boutique' }));
        expect(error.status).toBe(422);
        expect(describeProjetApiError(error).serverMessage).toBe(
            'String should have at most 100 characters (nom)'
        );
    });

    it('rejette avec une ApiError status 0 en cas d’erreur réseau', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        const error = await rejection(creerProjet({ nom: 'Boutique' }));
        expect(error).toBeInstanceOf(ApiError);
        expect(error.status).toBe(0);
        expect(getProjetApiErrorKind(error)).toBe('network');
    });
});

describe('getProjetApiErrorKind', () => {
    const apiError = (status: number) =>
        new ApiError({ status, message: `HTTP ${status}` });

    it.each([
        [0, 'network'],
        [401, 'unauthenticated'],
        [422, 'validation'],
        [403, 'unknown'],
        [500, 'unknown'],
    ])('statut %i → %s', (status, kind) => {
        expect(getProjetApiErrorKind(apiError(status))).toBe(kind);
    });

    it('renvoie unknown pour une erreur qui n’est pas une ApiError', () => {
        expect(getProjetApiErrorKind(new Error('boom'))).toBe('unknown');
    });
});

describe('describeProjetApiError', () => {
    it('donne les clés i18n api_errors.projet.*', () => {
        const error = new ApiError({ status: 401, message: 'HTTP 401' });
        expect(describeProjetApiError(error)).toEqual({
            kind: 'unauthenticated',
            titleKey: 'api_errors.projet.title',
            descriptionKey: 'api_errors.projet.unauthenticated',
            serverMessage: undefined,
        });
    });

    it('renseigne le message du serveur pour un 422 texte', () => {
        const error = new ApiError({
            status: 422,
            message: 'Nom invalide',
            details: { detail: 'Nom invalide' },
        });
        expect(describeProjetApiError(error)).toMatchObject({
            kind: 'validation',
            descriptionKey: 'api_errors.projet.validation',
            serverMessage: 'Nom invalide',
        });
    });

    it('ne renseigne pas le message du serveur hors 422', () => {
        const error = new ApiError({
            status: 401,
            message: 'Non identifié',
            details: { detail: 'Non identifié' },
        });
        expect(describeProjetApiError(error).serverMessage).toBeUndefined();
    });

    it('gère une erreur inconnue', () => {
        expect(describeProjetApiError('oops').descriptionKey).toBe(
            'api_errors.projet.unknown'
        );
    });
});
