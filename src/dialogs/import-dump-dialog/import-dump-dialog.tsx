import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useDialog } from '@/hooks/use-dialog';
import { useChartDB } from '@/hooks/use-chartdb';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogInternalContent,
    DialogTitle,
} from '@/components/dialog/dialog';
import { Button } from '@/components/button/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/alert/alert';
import { FileUploader } from '@/components/file-uploader/file-uploader';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/select/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/table/table';
import { cn } from '@/lib/utils';
import type { Diagram } from '@/lib/domain/diagram';
import { detectDatabaseType, sqlImportToDiagram } from '@/lib/data/sql-import';
import {
    buildDumpReport,
    stripMysqlHashComments,
} from '@/lib/data/sql-import/dump-report';
import type {
    ImportApiErrorDescription,
    ImportDialecte,
    ImportDumpRequest,
    ImportDumpResponse,
    InstructionNonReprise,
} from '@/lib/api/import-api';
import {
    databaseTypeToDialecte,
    describeImportApiError,
    dialecteToDatabaseType,
    getExistingTablesCount,
    isImportConfirmationRequired,
    normalizeImportTables,
    postImport,
    toImportDiagram,
} from '@/lib/api/import-api';
import type { BaseDialogProps } from '../common/base-dialog-props';

export interface ImportDumpDialogProps extends BaseDialogProps {}

type Step = 'select' | 'confirm' | 'done';

type DialogError =
    | { kind: 'parse'; message: string }
    | { kind: 'no_tables' }
    | { kind: 'api'; description: ImportApiErrorDescription };

/** Nombre maximal d'entrées du rapport affichées. */
export const MAX_REPORT_ROWS = 200;

/** Longueur maximale du nom de fichier transmis (fichier.nom). */
const MAX_FILE_NAME_LENGTH = 255;

/** Requête prête à être (re)envoyée, avec le diagramme qui sera chargé en local. */
interface Attempt {
    request: ImportDumpRequest;
    diagram: Diagram;
}

export const ImportDumpDialog: React.FC<ImportDumpDialogProps> = ({
    dialog,
}) => {
    const { t } = useTranslation();
    const { closeImportDumpDialog } = useDialog();
    const { currentDiagram, diagramId, updateDiagramData } = useChartDB();

    const [step, setStep] = useState<Step>('select');
    const [file, setFile] = useState<File | null>(null);
    const [sqlText, setSqlText] = useState<string | null>(null);
    const [dialect, setDialect] = useState<ImportDialecte | undefined>();
    const [error, setError] = useState<DialogError | null>(null);
    const [existingCount, setExistingCount] = useState<number | null>(null);
    const [result, setResult] = useState<ImportDumpResponse | null>(null);
    const [report, setReport] = useState<InstructionNonReprise[]>([]);
    const [sending, setSending] = useState(false);

    // Anti double envoi : le ref est synchrone, le state ne sert qu'à l'affichage.
    const sendingRef = useRef(false);
    // Requête à renvoyer avec confirme_remplacement: true après un 409.
    const attemptRef = useRef<Attempt | null>(null);
    const readTokenRef = useRef(0);

    useEffect(() => {
        if (!dialog.open) return;
        readTokenRef.current += 1;
        sendingRef.current = false;
        attemptRef.current = null;
        setStep('select');
        setFile(null);
        setSqlText(null);
        setDialect(undefined);
        setError(null);
        setExistingCount(null);
        setResult(null);
        setReport([]);
        setSending(false);
    }, [dialog.open]);

    const handleFilesChange = useCallback((files: File[]) => {
        const next = files[0] ?? null;
        const token = ++readTokenRef.current;
        setFile(next);
        setSqlText(null);
        setDialect(undefined);
        setError(null);
        if (!next) return;

        next.text().then(
            (text) => {
                if (token !== readTokenRef.current) return;
                setSqlText(text);
                setDialect(databaseTypeToDialecte(detectDatabaseType(text)));
            },
            (e: unknown) => {
                if (token !== readTokenRef.current) return;
                setError({
                    kind: 'parse',
                    message: e instanceof Error ? e.message : String(e),
                });
            }
        );
    }, []);

    // Une seule opération à la fois (analyse, envoi ou renvoi).
    const runExclusive = useCallback(async (task: () => Promise<void>) => {
        if (sendingRef.current) return;
        sendingRef.current = true;
        setSending(true);
        try {
            await task();
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }, []);

    // Envoie la requête ; le schéma local n'est remplacé QU'APRÈS le 201.
    const post = useCallback(
        async ({ request, diagram }: Attempt) => {
            try {
                const response = await postImport(diagramId, request);
                await updateDiagramData({
                    ...currentDiagram,
                    databaseType: diagram.databaseType,
                    tables: diagram.tables ?? [],
                    relationships: diagram.relationships ?? [],
                    dependencies: diagram.dependencies ?? [],
                    areas: diagram.areas ?? [],
                    customTypes: diagram.customTypes ?? [],
                    notes: diagram.notes ?? [],
                    updatedAt: new Date(),
                });
                attemptRef.current = null;
                setReport(request.rapport.non_repris);
                setResult(response);
                setStep('done');
            } catch (e) {
                // Un 409 n'a rien écrit : la même requête est renvoyée après
                // confirmation. Au second envoi, c'est une erreur ordinaire.
                if (
                    !request.confirme_remplacement &&
                    isImportConfirmationRequired(e)
                ) {
                    attemptRef.current = {
                        request: { ...request, confirme_remplacement: true },
                        diagram,
                    };
                    setExistingCount(getExistingTablesCount(e));
                    setStep('confirm');
                    return;
                }
                attemptRef.current = null;
                setError({
                    kind: 'api',
                    description: describeImportApiError(e),
                });
                setStep('select');
            }
        },
        [diagramId, currentDiagram, updateDiagramData]
    );

    const handleImport = useCallback(async () => {
        if (!file || sqlText === null || !dialect) return;
        await runExclusive(async () => {
            setError(null);
            const databaseType = dialecteToDatabaseType(dialect);

            let parsed: Diagram;
            try {
                parsed = await sqlImportToDiagram({
                    sqlContent:
                        dialect === 'mysql'
                            ? stripMysqlHashComments(sqlText)
                            : sqlText,
                    sourceDatabaseType: databaseType,
                    targetDatabaseType: databaseType,
                });
            } catch (e) {
                setError({
                    kind: 'parse',
                    message: e instanceof Error ? e.message : String(e),
                });
                return;
            }
            if ((parsed.tables ?? []).length === 0) {
                setError({ kind: 'no_tables' });
                return;
            }

            // Diagramme normalisé : le MÊME sert au corps de la requête et à
            // l'état local, qui reste identique à l'état du serveur.
            const diagram: Diagram = {
                ...parsed,
                id: currentDiagram.id,
                name: currentDiagram.name,
                databaseType,
                tables: normalizeImportTables(parsed.tables ?? []),
            };
            const request: ImportDumpRequest = {
                confirme_remplacement: false,
                fichier: {
                    nom: file.name.slice(0, MAX_FILE_NAME_LENGTH),
                    dialecte: dialect,
                    taille_octets: file.size,
                },
                diagramme: toImportDiagram(currentDiagram, diagram, dialect),
                // Rapport calculé sur le texte ORIGINAL ; jamais de SQL dedans.
                rapport: { non_repris: buildDumpReport(sqlText, dialect) },
            };
            await post({ request, diagram });
        });
    }, [file, sqlText, dialect, runExclusive, currentDiagram, post]);

    const handleReplace = useCallback(async () => {
        const attempt = attemptRef.current;
        if (!attempt) return;
        await runExclusive(() => post(attempt));
    }, [runExclusive, post]);

    const handleCancelConfirm = useCallback(() => {
        attemptRef.current = null;
        setStep('select');
    }, []);

    const canImport =
        file !== null && sqlText !== null && !!dialect && !sending;

    const renderError = () => {
        if (!error) return null;
        if (error.kind === 'api') {
            const { titleKey, descriptionKey, serverMessage } =
                error.description;
            return (
                <Alert variant="destructive" className="mt-2">
                    <AlertCircle className="size-4" />
                    <AlertTitle>{t(titleKey)}</AlertTitle>
                    <AlertDescription>
                        {t(descriptionKey)}
                        {serverMessage ? (
                            <span className="mt-1 block whitespace-pre-line">
                                {serverMessage}
                            </span>
                        ) : null}
                    </AlertDescription>
                </Alert>
            );
        }
        if (error.kind === 'no_tables') {
            return (
                <Alert variant="destructive" className="mt-2">
                    <AlertCircle className="size-4" />
                    <AlertDescription>
                        {t('import_dump_dialog.no_tables')}
                    </AlertDescription>
                </Alert>
            );
        }
        return (
            <Alert variant="destructive" className="mt-2">
                <AlertCircle className="size-4" />
                <AlertTitle>
                    {t('import_dump_dialog.parse_error_title')}
                </AlertTitle>
                <AlertDescription>
                    {t('import_dump_dialog.parse_error_description')}
                    {error.message ? (
                        <span className="mt-1 block whitespace-pre-line">
                            {error.message}
                        </span>
                    ) : null}
                </AlertDescription>
            </Alert>
        );
    };

    const shownReport = report.slice(0, MAX_REPORT_ROWS);

    return (
        <Dialog
            {...dialog}
            onOpenChange={(open) => {
                // Pas de fermeture pendant l'envoi.
                if (!open && !sendingRef.current) {
                    closeImportDumpDialog();
                }
            }}
        >
            <DialogContent
                className="flex max-h-screen flex-col"
                showClose={!sending}
            >
                <DialogHeader>
                    <DialogTitle>{t('import_dump_dialog.title')}</DialogTitle>
                    <DialogDescription>
                        {t('import_dump_dialog.description')}
                    </DialogDescription>
                </DialogHeader>
                <DialogInternalContent>
                    {/* Toujours monté (masqué hors de l'étape select) : le
                        FileUploader garde son propre état de fichier. */}
                    <div
                        className={cn(
                            'flex flex-col gap-3 p-1',
                            step !== 'select' && 'hidden'
                        )}
                    >
                        <FileUploader
                            supportedExtensions={['.sql']}
                            onFilesChange={handleFilesChange}
                        />
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium">
                                {t('import_dump_dialog.dialect')}
                            </label>
                            <Select
                                value={dialect ?? ''}
                                onValueChange={(value) =>
                                    setDialect(value as ImportDialecte)
                                }
                                disabled={sending}
                            >
                                <SelectTrigger>
                                    <SelectValue
                                        placeholder={t(
                                            'import_dump_dialog.dialect_placeholder'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="postgresql">
                                        PostgreSQL
                                    </SelectItem>
                                    <SelectItem value="mysql">MySQL</SelectItem>
                                </SelectContent>
                            </Select>
                            {file && sqlText !== null && !dialect ? (
                                <p className="text-xs text-muted-foreground">
                                    {t('import_dump_dialog.dialect_required')}
                                </p>
                            ) : null}
                        </div>
                        {renderError()}
                    </div>

                    {step === 'confirm' ? (
                        <div className="flex flex-col gap-2 p-1">
                            <p className="font-medium">
                                {t('import_dump_dialog.confirm_title')}
                            </p>
                            <p className="text-sm text-muted-foreground">
                                {existingCount !== null
                                    ? t(
                                          'import_dump_dialog.confirm_description',
                                          {
                                              count: existingCount,
                                          }
                                      )
                                    : t(
                                          'import_dump_dialog.confirm_description_unknown'
                                      )}
                            </p>
                        </div>
                    ) : null}

                    {step === 'done' && result ? (
                        <div className="flex flex-col gap-3 p-1">
                            <div>
                                <p className="font-medium">
                                    {t('import_dump_dialog.success_title')}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {t(
                                        'import_dump_dialog.success_description',
                                        {
                                            count: result.nb_elements_crees,
                                            sequence: result.numero_sequence,
                                        }
                                    )}
                                </p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <p className="font-medium">
                                    {t('import_dump_dialog.report_title')}
                                </p>
                                {report.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        {t('import_dump_dialog.report_empty')}
                                    </p>
                                ) : (
                                    <>
                                        <p className="text-sm text-muted-foreground">
                                            {t(
                                                'import_dump_dialog.report_summary',
                                                { count: report.length }
                                            )}
                                        </p>
                                        <div className="max-h-64 overflow-auto rounded-md border">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>
                                                            {t(
                                                                'import_dump_dialog.report_line'
                                                            )}
                                                        </TableHead>
                                                        <TableHead>
                                                            {t(
                                                                'import_dump_dialog.report_type'
                                                            )}
                                                        </TableHead>
                                                        <TableHead>
                                                            {t(
                                                                'import_dump_dialog.report_reason'
                                                            )}
                                                        </TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {shownReport.map(
                                                        (entry, index) => (
                                                            <TableRow
                                                                key={`${entry.ligne ?? 'x'}-${index}`}
                                                            >
                                                                <TableCell>
                                                                    {entry.ligne ??
                                                                        ''}
                                                                </TableCell>
                                                                <TableCell>
                                                                    {entry.type}
                                                                </TableCell>
                                                                <TableCell>
                                                                    {
                                                                        entry.raison
                                                                    }
                                                                </TableCell>
                                                            </TableRow>
                                                        )
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </div>
                                        {report.length > MAX_REPORT_ROWS ? (
                                            <p className="text-xs text-muted-foreground">
                                                {t(
                                                    'import_dump_dialog.report_truncated',
                                                    {
                                                        shown: MAX_REPORT_ROWS,
                                                        total: report.length,
                                                    }
                                                )}
                                            </p>
                                        ) : null}
                                    </>
                                )}
                            </div>
                        </div>
                    ) : null}
                </DialogInternalContent>
                <DialogFooter className="flex gap-1 md:justify-between">
                    {step === 'select' ? (
                        <>
                            <Button
                                variant="secondary"
                                disabled={sending}
                                onClick={closeImportDumpDialog}
                            >
                                {t('import_dump_dialog.cancel')}
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={!canImport}
                            >
                                {sending ? (
                                    <Loader2 className="mr-1 size-4 animate-spin" />
                                ) : null}
                                {t('import_dump_dialog.import')}
                            </Button>
                        </>
                    ) : null}
                    {step === 'confirm' ? (
                        <>
                            <Button
                                variant="secondary"
                                disabled={sending}
                                onClick={handleCancelConfirm}
                            >
                                {t('import_dump_dialog.cancel')}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleReplace}
                                disabled={sending}
                            >
                                {sending ? (
                                    <Loader2 className="mr-1 size-4 animate-spin" />
                                ) : null}
                                {t('import_dump_dialog.replace')}
                            </Button>
                        </>
                    ) : null}
                    {step === 'done' ? (
                        <Button onClick={closeImportDumpDialog}>
                            {t('import_dump_dialog.close')}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
