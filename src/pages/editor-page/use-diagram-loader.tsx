import { useChartDB } from '@/hooks/use-chartdb';
import { useConfig } from '@/hooks/use-config';
import { useDialog } from '@/hooks/use-dialog';
import { useFullScreenLoader } from '@/hooks/use-full-screen-spinner';
import { useRedoUndoStack } from '@/hooks/use-redo-undo-stack';
import { useStorage } from '@/hooks/use-storage';
import { useProjetConflictPrompt } from '@/hooks/use-projet-conflict-prompt';
import { toast } from '@/components/toast/use-toast';
import { isApiConfigured, isUuid } from '@/lib/api/http-client';
import { ouvrirProjet } from '@/lib/api/projets-api';
import type { Diagram } from '@/lib/domain/diagram';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { openProjet } from './open-projet';

/** État de navigation posé quand l'ouverture d'un projet a échoué. */
export interface ProjetOpenFailedState {
    projetOpenFailedId?: string;
}

interface PendingOpen {
    id: string;
    controller: AbortController;
    abortTimer?: ReturnType<typeof setTimeout>;
}

export const useDiagramLoader = () => {
    const [initialDiagram, setInitialDiagram] = useState<Diagram | undefined>();
    const { diagramId } = useParams<{ diagramId: string }>();
    const { config, updateConfig } = useConfig();
    const { loadDiagram, currentDiagram } = useChartDB();
    const { resetRedoStack, resetUndoStack } = useRedoUndoStack();
    const { showLoader, hideLoader } = useFullScreenLoader();
    const { openCreateDiagramDialog, openOpenDiagramDialog } = useDialog();
    const navigate = useNavigate();
    const location = useLocation();
    const { listDiagrams, getDiagram, replaceDiagram } = useStorage();
    const confirmOverwrite = useProjetConflictPrompt();
    const { t } = useTranslation();

    const currentDiagramLoadingRef = useRef<string | undefined>(undefined);
    // Ouverture API en cours : annulée si l'utilisateur quitte, conservée si
    // l'effet est seulement rejoué (StrictMode, nouvelles dépendances).
    const pendingOpenRef = useRef<PendingOpen | undefined>(undefined);
    // updateConfig change à chaque rendu : lu via une ref pour ne pas rejouer
    // l'effet.
    const updateConfigRef = useRef(updateConfig);
    updateConfigRef.current = updateConfig;

    const failedId = (location.state as ProjetOpenFailedState | null)
        ?.projetOpenFailedId;

    useEffect(() => {
        const pending = pendingOpenRef.current;
        if (pending?.abortTimer && pending.id === diagramId) {
            clearTimeout(pending.abortTimer);
            pending.abortTimer = undefined;
        }

        const scheduleAbort = () => {
            const current = pendingOpenRef.current;
            if (current && !current.abortTimer) {
                current.abortTimer = setTimeout(() => {
                    current.controller.abort();
                    if (pendingOpenRef.current === current) {
                        pendingOpenRef.current = undefined;
                    }
                }, 0);
            }
        };

        if (!config) {
            return scheduleAbort;
        }

        if (currentDiagram?.id === diagramId) {
            return scheduleAbort;
        }

        const openFromServer = async (id: string) => {
            const controller = new AbortController();
            const entry: PendingOpen = { id, controller };
            pendingOpenRef.current = entry;

            setInitialDiagram(undefined);
            showLoader();
            resetRedoStack();
            resetUndoStack();

            const result = await openProjet(id, {
                fetchProjet: (projetId, signal) =>
                    ouvrirProjet(projetId, { signal }),
                getLocalDiagram: (projetId) => getDiagram(projetId),
                replaceDiagram: (diagram) => replaceDiagram({ diagram }),
                confirmOverwrite: (name) => {
                    hideLoader();
                    return confirmOverwrite(name);
                },
                signal: controller.signal,
            });

            if (pendingOpenRef.current === entry) {
                if (entry.abortTimer) {
                    clearTimeout(entry.abortTimer);
                }
                pendingOpenRef.current = undefined;
            }

            if (result.kind === 'aborted') {
                hideLoader();
                return;
            }

            if (result.kind === 'redirect') {
                const { error } = result;
                const description =
                    error.kind === 'unauthenticated' && import.meta.env.DEV
                        ? `${t(error.descriptionKey)} ${t('api_errors.projet_open.unauthenticated_dev_hint')}`
                        : t(error.descriptionKey);
                toast({
                    variant: 'destructive',
                    title: t(error.titleKey),
                    description,
                });
                // Une ouverture échouée ne redevient jamais le diagramme par
                // défaut (sinon « / » y renverrait en boucle).
                if (config.defaultDiagramId === id) {
                    await updateConfigRef.current({
                        config: { defaultDiagramId: '' },
                    });
                }
                currentDiagramLoadingRef.current = undefined;
                hideLoader();
                navigate('/', {
                    replace: true,
                    state: { projetOpenFailedId: id } as ProjetOpenFailedState,
                });
                return;
            }

            if (result.kind === 'offline_local') {
                toast({
                    variant: 'destructive',
                    title: t(result.error.titleKey),
                    description: t('api_errors.projet_open.offline_local_copy'),
                });
            }

            const diagram = await loadDiagram(id);
            hideLoader();
            if (!diagram) {
                openOpenDiagramDialog({ canClose: false });
                return;
            }
            setInitialDiagram(diagram);
        };

        const loadDefaultDiagram = async () => {
            if (diagramId && isApiConfigured() && isUuid(diagramId)) {
                await openFromServer(diagramId);
                return;
            }
            if (diagramId) {
                setInitialDiagram(undefined);
                showLoader();
                resetRedoStack();
                resetUndoStack();
                const diagram = await loadDiagram(diagramId);
                if (!diagram) {
                    openOpenDiagramDialog({ canClose: false });
                    hideLoader();
                    return;
                }

                setInitialDiagram(diagram);
                hideLoader();

                return;
            } else if (
                !diagramId &&
                config.defaultDiagramId &&
                config.defaultDiagramId !== failedId
            ) {
                // Mode API : un projet se charge depuis le serveur, pas depuis
                // la copie locale.
                if (isApiConfigured() && isUuid(config.defaultDiagramId)) {
                    navigate(`/diagrams/${config.defaultDiagramId}`);
                    return;
                }
                const diagram = await loadDiagram(config.defaultDiagramId);
                if (diagram) {
                    navigate(`/diagrams/${config.defaultDiagramId}`);

                    return;
                }
            }
            const diagrams = await listDiagrams();

            if (diagrams.length > 0) {
                openOpenDiagramDialog({ canClose: false });
            } else {
                openCreateDiagramDialog();
            }
        };

        if (
            currentDiagramLoadingRef.current === (diagramId ?? '') &&
            currentDiagramLoadingRef.current !== undefined
        ) {
            return scheduleAbort;
        }
        currentDiagramLoadingRef.current = diagramId ?? '';

        loadDefaultDiagram();

        return scheduleAbort;
    }, [
        diagramId,
        openCreateDiagramDialog,
        config,
        navigate,
        listDiagrams,
        getDiagram,
        replaceDiagram,
        confirmOverwrite,
        loadDiagram,
        resetRedoStack,
        resetUndoStack,
        hideLoader,
        showLoader,
        currentDiagram?.id,
        openOpenDiagramDialog,
        failedId,
        t,
    ]);

    return { initialDiagram };
};
