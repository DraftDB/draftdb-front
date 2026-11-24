import type { Diagram } from '@/lib/domain/diagram';
import type {
    ProjetApiErrorDescription,
    ProjetOuvertResponse,
} from '@/lib/api/projets-api';
import {
    describeProjetApiError,
    setNumeroSequence,
    toLocalDiagram,
} from '@/lib/api/projets-api';
import { isSameDiagramContent } from '@/lib/api/projet-diff';
import type { ProjetConflictChoice } from '@/dialogs/projet-conflict-dialog/projet-conflict-dialog';

export type OpenProjetResult =
    /** Diagramme prêt dans Dexie : version du serveur ou copie locale gardée. */
    | { kind: 'opened'; source: 'server' | 'local' }
    /** Ne rien ouvrir : retour à l'accueil (401, 403, 404, ou rien en local). */
    | { kind: 'redirect'; error: ProjetApiErrorDescription }
    /** Serveur indisponible : la copie locale est ouverte. */
    | { kind: 'offline_local'; error: ProjetApiErrorDescription }
    /** L'utilisateur a quitté : ne rien faire. */
    | { kind: 'aborted' };

export interface OpenProjetDeps {
    fetchProjet: (
        id: string,
        signal?: AbortSignal
    ) => Promise<ProjetOuvertResponse>;
    /** Lecture seule de la copie locale (Dexie). */
    getLocalDiagram: (id: string) => Promise<Diagram | undefined>;
    /** Écriture atomique dans Dexie. */
    replaceDiagram: (diagram: Diagram) => Promise<void>;
    /** Copie locale différente : demande quelle version ouvrir. */
    confirmOverwrite: (projetName: string) => Promise<ProjetConflictChoice>;
    signal?: AbortSignal;
}

const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException && error.name === 'AbortError';

/**
 * Ouverture d'un projet en mode API. Seul GET au serveur ; Dexie n'est écrit
 * qu'avec la version du serveur, et jamais en cas d'erreur, d'annulation ou de
 * refus d'écrasement.
 */
export const openProjet = async (
    id: string,
    {
        fetchProjet,
        getLocalDiagram,
        replaceDiagram,
        confirmOverwrite,
        signal,
    }: OpenProjetDeps
): Promise<OpenProjetResult> => {
    const local = await getLocalDiagram(id);
    if (signal?.aborted) {
        return { kind: 'aborted' };
    }

    let response: ProjetOuvertResponse;
    try {
        response = await fetchProjet(id, signal);
    } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
            return { kind: 'aborted' };
        }
        const description = describeProjetApiError(error);
        if (description.blocking || !local) {
            return { kind: 'redirect', error: description };
        }
        return { kind: 'offline_local', error: description };
    }
    if (signal?.aborted) {
        return { kind: 'aborted' };
    }

    setNumeroSequence(id, response.numero_sequence);
    const server = toLocalDiagram(response);

    if (local && !isSameDiagramContent(local, server)) {
        const choice = await confirmOverwrite(local.name || server.name);
        if (choice !== 'server') {
            return { kind: 'opened', source: 'local' };
        }
    }
    if (signal?.aborted) {
        return { kind: 'aborted' };
    }

    try {
        await replaceDiagram(server);
    } catch (error) {
        // Transaction annulée : l'ancienne copie locale est intacte.
        const description = describeProjetApiError(error);
        return local
            ? { kind: 'offline_local', error: description }
            : { kind: 'redirect', error: description };
    }
    return { kind: 'opened', source: 'server' };
};
