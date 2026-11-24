import type { en } from './locales/en';

type EnTranslation = (typeof en)['translation'];

/**
 * Sections ajoutées par DraftDB : facultatives dans les autres locales
 * (i18next retombe sur l'anglais, `fallbackLng`).
 */
type OptionalTranslationKeys =
    | 'api_errors'
    | 'table_name_dialog'
    | 'import_dump_dialog';

export type LanguageTranslation = Omit<typeof en, 'translation'> & {
    translation: Omit<EnTranslation, OptionalTranslationKeys> &
        Partial<Pick<EnTranslation, OptionalTranslationKeys>>;
};

export type LanguageMetadata = {
    name: string;
    nativeName: string;
    code: string;
};
