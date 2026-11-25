import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/button/button';
import {
    DialogClose,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogInternalContent,
    DialogTitle,
} from '@/components/dialog/dialog';
import { Input } from '@/components/input/input';
import { Label } from '@/components/label/label';
import { Textarea } from '@/components/textarea/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/toast/use-toast';
import { useConfig } from '@/hooks/use-config';
import { useDialog } from '@/hooks/use-dialog';
import { useStorage } from '@/hooks/use-storage';
import {
    MAX_DESCRIPTION_PROJET_LENGTH,
    MAX_NOM_PROJET_LENGTH,
    creerProjet,
    describeProjetApiError,
    hasValidationErrors,
    validateCreerProjet,
} from '@/lib/api/projets-api';
import type { CreerProjetValidationErrors } from '@/lib/api/projets-api';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';

export interface CreateProjetFormProps {
    hasExistingDiagram: boolean;
    /** Informe le dialogue parent qu'un envoi est en cours (fermeture bloquée). */
    onBusyChange?: (busy: boolean) => void;
}

/**
 * Création de projet en mode API : POST /api/projets, puis diagramme vide
 * enregistré en local avec id = id_projet. Rien n'est créé en local si l'API
 * échoue.
 */
export const CreateProjetForm: React.FC<CreateProjetFormProps> = ({
    hasExistingDiagram,
    onBusyChange,
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { addDiagram } = useStorage();
    const { updateConfig } = useConfig();
    const { closeCreateDiagramDialog } = useDialog();

    const [nom, setNom] = useState('');
    const [description, setDescription] = useState('');
    const [errors, setErrors] = useState<CreerProjetValidationErrors>({});
    const [submitted, setSubmitted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Garde anti double-clic : un seul envoi à la fois.
    const submittingRef = useRef(false);

    useEffect(() => {
        onBusyChange?.(isSubmitting);
    }, [isSubmitting, onBusyChange]);

    // Au démontage (fermeture du dialogue), le parent ne doit pas rester bloqué.
    useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

    const revalidate = useCallback(
        (nextNom: string, nextDescription: string) => {
            if (submitted) {
                setErrors(
                    validateCreerProjet({
                        nom: nextNom,
                        description: nextDescription,
                    })
                );
            }
        },
        [submitted]
    );

    const handleSubmit = useCallback(
        async (e?: React.FormEvent) => {
            e?.preventDefault();
            if (submittingRef.current) {
                return;
            }

            const validation = validateCreerProjet({ nom, description });
            setSubmitted(true);
            setErrors(validation);
            if (hasValidationErrors(validation)) {
                return;
            }

            submittingRef.current = true;
            setIsSubmitting(true);
            try {
                let projet;
                try {
                    projet = await creerProjet({ nom, description });
                } catch (error) {
                    const described = describeProjetApiError(error);
                    toast({
                        variant: 'destructive',
                        title: t(described.titleKey),
                        description:
                            described.serverMessage ??
                            t(described.descriptionKey),
                    });
                    return;
                }

                const now = new Date();
                const diagram: Diagram = {
                    id: projet.id_projet,
                    name: projet.nom,
                    databaseType: DatabaseType.GENERIC,
                    createdAt: now,
                    updatedAt: now,
                };

                try {
                    await addDiagram({ diagram });
                    await updateConfig({
                        config: { defaultDiagramId: diagram.id },
                    });
                } catch {
                    toast({
                        variant: 'destructive',
                        title: t('api_errors.projet.title'),
                        description: t('api_errors.projet.local_storage'),
                    });
                    return;
                }

                closeCreateDiagramDialog();
                navigate(`/diagrams/${diagram.id}`);
            } finally {
                submittingRef.current = false;
                setIsSubmitting(false);
            }
        },
        [
            nom,
            description,
            t,
            addDiagram,
            updateConfig,
            closeCreateDiagramDialog,
            navigate,
        ]
    );

    return (
        <form onSubmit={handleSubmit} noValidate className="contents">
            <DialogHeader>
                <DialogTitle>{t('new_project_form.title')}</DialogTitle>
                <DialogDescription>
                    {t('new_project_form.description')}
                </DialogDescription>
            </DialogHeader>
            <DialogInternalContent>
                <div className="grid gap-4 py-1">
                    <div className="grid gap-2">
                        <Label htmlFor="projet-nom">
                            {t('new_project_form.name_label')}
                        </Label>
                        <Input
                            id="projet-nom"
                            value={nom}
                            autoFocus
                            autoComplete="off"
                            disabled={isSubmitting}
                            placeholder={t('new_project_form.name_placeholder')}
                            aria-invalid={errors.nom !== undefined}
                            aria-describedby={
                                errors.nom ? 'projet-nom-error' : undefined
                            }
                            onChange={(e) => {
                                setNom(e.target.value);
                                revalidate(e.target.value, description);
                            }}
                        />
                        {errors.nom ? (
                            <p
                                id="projet-nom-error"
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {errors.nom === 'required'
                                    ? t('new_project_form.errors.required')
                                    : t(
                                          'new_project_form.errors.name_too_long',
                                          { max: MAX_NOM_PROJET_LENGTH }
                                      )}
                            </p>
                        ) : null}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="projet-description">
                            {t('new_project_form.description_label')}
                        </Label>
                        <Textarea
                            id="projet-description"
                            value={description}
                            rows={4}
                            disabled={isSubmitting}
                            placeholder={t(
                                'new_project_form.description_placeholder'
                            )}
                            aria-invalid={errors.description !== undefined}
                            aria-describedby={
                                errors.description
                                    ? 'projet-description-error'
                                    : undefined
                            }
                            onChange={(e) => {
                                setDescription(e.target.value);
                                revalidate(nom, e.target.value);
                            }}
                        />
                        {errors.description ? (
                            <p
                                id="projet-description-error"
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {t(
                                    'new_project_form.errors.description_too_long',
                                    { max: MAX_DESCRIPTION_PROJET_LENGTH }
                                )}
                            </p>
                        ) : null}
                    </div>
                </div>
            </DialogInternalContent>
            <DialogFooter className="mt-4 flex gap-2 sm:justify-between">
                {hasExistingDiagram ? (
                    <DialogClose asChild>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={isSubmitting}
                        >
                            {t('new_project_form.cancel')}
                        </Button>
                    </DialogClose>
                ) : (
                    <span />
                )}
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                        <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            {t('new_project_form.creating')}
                        </>
                    ) : (
                        t('new_project_form.create')
                    )}
                </Button>
            </DialogFooter>
        </form>
    );
};
