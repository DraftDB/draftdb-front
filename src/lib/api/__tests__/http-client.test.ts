import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
    API_URL: '',
    USER_ID: '',
}));

vi.mock('@/lib/env', () => mockEnv);

import {
    ApiError,
    apiRequest,
    getAuthHeaders,
    getServerMessage,
    isApiConfigured,
} from '../http-client';

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

const rejection = (promise: Promise<unknown>): Promise<ApiError> =>
    promise.then(
        () => {
            throw new Error('La promesse aurait dû être rejetée');
        },
        (e: unknown) => e as ApiError
    );

describe('http-client', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        mockEnv.API_URL = 'http://api.test';
        mockEnv.USER_ID = '';
        localStorage.clear();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('isApiConfigured', () => {
        it('est faux si API_URL est vide', () => {
            mockEnv.API_URL = '';
            expect(isApiConfigured()).toBe(false);
        });

        it('est vrai pour "/" et pour une URL', () => {
            mockEnv.API_URL = '/';
            expect(isApiConfigured()).toBe(true);
            mockEnv.API_URL = 'http://api.test';
            expect(isApiConfigured()).toBe(true);
        });
    });

    describe('getAuthHeaders', () => {
        it('utilise USER_ID de l’env', () => {
            mockEnv.USER_ID = 'env-user';
            expect(getAuthHeaders()).toEqual({ 'X-User-Id': 'env-user' });
        });

        it('donne priorité à localStorage', () => {
            mockEnv.USER_ID = 'env-user';
            localStorage.setItem('draftdb_user_id', 'ls-user');
            expect(getAuthHeaders()).toEqual({ 'X-User-Id': 'ls-user' });
        });

        it('ne renvoie aucun en-tête si vide', () => {
            expect(getAuthHeaders()).toEqual({});
        });
    });

    describe('apiRequest', () => {
        it('construit l’URL avec query, retire les / finaux et envoie X-User-Id', async () => {
            mockEnv.API_URL = 'http://api.test///';
            mockEnv.USER_ID = 'u1';
            fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

            const result = await apiRequest<{ ok: boolean }>('/api/x', {
                query: { a: 1, b: 'z', c: undefined },
            });

            expect(result).toEqual({ ok: true });
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe('http://api.test/api/x?a=1&b=z');
            expect(init.method).toBe('GET');
            expect(init.headers['X-User-Id']).toBe('u1');
        });

        it('garde une URL relative avec API_URL "/"', async () => {
            mockEnv.API_URL = '/';
            fetchMock.mockResolvedValue(jsonResponse({}));
            await apiRequest('/api/x');
            expect(fetchMock.mock.calls[0][0]).toBe('/api/x');
        });

        it('sérialise le body en JSON', async () => {
            fetchMock.mockResolvedValue(jsonResponse({}));
            await apiRequest('/api/x', { method: 'POST', body: { a: 1 } });
            const init = fetchMock.mock.calls[0][1];
            expect(init.method).toBe('POST');
            expect(init.body).toBe('{"a":1}');
            expect(init.headers['Content-Type']).toBe('application/json');
        });

        it('renvoie undefined pour une réponse vide', async () => {
            fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
            await expect(apiRequest('/api/x')).resolves.toBeUndefined();
        });

        it('transforme une erreur réseau en ApiError status 0', async () => {
            fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
            const error = await rejection(apiRequest('/api/x'));
            expect(error).toBeInstanceOf(ApiError);
            expect(error.status).toBe(0);
            expect(error.message).toBe('Failed to fetch');
        });

        it('lit { detail: "texte" }', async () => {
            fetchMock.mockResolvedValue(jsonResponse({ detail: 'Nope' }, 401));
            const error = await rejection(apiRequest('/api/x'));
            expect(error.status).toBe(401);
            expect(error.message).toBe('Nope');
            expect(error.code).toBeUndefined();
        });

        it('lit { detail: { code, message } }', async () => {
            fetchMock.mockResolvedValue(
                jsonResponse({ detail: { code: 'E_X', message: 'Bad' } }, 409)
            );
            const error = await rejection(apiRequest('/api/x'));
            expect(error.status).toBe(409);
            expect(error.code).toBe('E_X');
            expect(error.message).toBe('Bad');
            // details est le corps complet, pas l'objet interne.
            expect(error.details).toEqual({
                detail: { code: 'E_X', message: 'Bad' },
            });
        });

        it('lit le code d’un 409 de suppression sans message', async () => {
            const body = {
                detail: {
                    code: 'CONFIRMATION_REQUISE',
                    cles_etrangeres: [{ id: 'fk1' }],
                    index: [{ id: 'idx1' }],
                },
            };
            fetchMock.mockResolvedValue(jsonResponse(body, 409));
            const error = await rejection(apiRequest('/api/x'));
            expect(error.status).toBe(409);
            expect(error.code).toBe('CONFIRMATION_REQUISE');
            expect(error.message).toBe('HTTP 409');
            expect(error.details).toEqual(body);
            const { detail } = error.details as typeof body;
            expect(detail.cles_etrangeres).toEqual([{ id: 'fk1' }]);
            expect(detail.index).toEqual([{ id: 'idx1' }]);
        });

        it('lit le code d’un 409 d’import sans message', async () => {
            const body = {
                detail: {
                    code: 'CONFIRMATION_REQUISE',
                    nb_tables_existantes: 3,
                },
            };
            fetchMock.mockResolvedValue(jsonResponse(body, 409));
            const error = await rejection(apiRequest('/api/x'));
            expect(error.status).toBe(409);
            expect(error.code).toBe('CONFIRMATION_REQUISE');
            expect(error.message).toBe('HTTP 409');
            expect(error.details).toEqual(body);
            const { detail } = error.details as typeof body;
            expect(detail.nb_tables_existantes).toBe(3);
        });

        it('lit { code, message }', async () => {
            fetchMock.mockResolvedValue(
                jsonResponse({ code: 'E_Y', message: 'Oops' }, 422)
            );
            const error = await rejection(apiRequest('/api/x'));
            expect(error.code).toBe('E_Y');
            expect(error.message).toBe('Oops');
        });
    });

    describe('getServerMessage', () => {
        it('renvoie le detail texte', () => {
            const error = new ApiError({
                status: 400,
                message: 'x',
                details: { detail: 'Texte serveur' },
            });
            expect(getServerMessage(error)).toBe('Texte serveur');
        });

        it('renvoie le premier message pydantic avec son emplacement sans body', () => {
            const error = new ApiError({
                status: 422,
                message: 'x',
                details: {
                    detail: [
                        {
                            msg: 'Field required',
                            loc: ['body', 'fields', 0, 'name'],
                        },
                        { msg: 'Autre', loc: ['body', 'y'] },
                    ],
                },
            });
            expect(getServerMessage(error)).toBe(
                'Field required (fields.0.name)'
            );
        });

        it('renvoie le message seul si loc ne contient que body', () => {
            const error = new ApiError({
                status: 422,
                message: 'x',
                details: { detail: [{ msg: 'Bad', loc: ['body'] }] },
            });
            expect(getServerMessage(error)).toBe('Bad');
        });

        it('renvoie undefined si rien d’exploitable', () => {
            expect(getServerMessage(new Error('x'))).toBeUndefined();
            expect(getServerMessage(undefined)).toBeUndefined();
            expect(
                getServerMessage(new ApiError({ status: 500, message: 'x' }))
            ).toBeUndefined();
            expect(
                getServerMessage(
                    new ApiError({
                        status: 500,
                        message: 'x',
                        details: { detail: [{ foo: 1 }] },
                    })
                )
            ).toBeUndefined();
        });
    });
});
