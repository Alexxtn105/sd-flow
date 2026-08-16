import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ruCommon from './ru/common.json';
import ruBlocks from './ru/blocks.json';
import ruGroups from './ru/groups.json';
import ruNodes from './ru/nodes.json';
import ruParams from './ru/params.json';

import enCommon from './en/common.json';
import enBlocks from './en/blocks.json';
import enGroups from './en/groups.json';
import enNodes from './en/nodes.json';
import enParams from './en/params.json';

export interface LanguageOption {
    code: string;
    label: string;
}

export const LANGUAGES: LanguageOption[] = [
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
];

export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGE_STORAGE_KEY = 'sd-flow-language-choice';

const AUTO_CACHED_KEY = 'sd-flow-language';

function forgetAutoCachedLanguage(): void {
    if (typeof localStorage === 'undefined') return;

    localStorage.removeItem(AUTO_CACHED_KEY);
}

export function rememberLanguage(language: string): void {
    if (typeof localStorage === 'undefined') return;

    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

forgetAutoCachedLanguage();

i18n.use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            ru: { common: ruCommon, blocks: ruBlocks, groups: ruGroups, nodes: ruNodes, params: ruParams },
            en: { common: enCommon, blocks: enBlocks, groups: enGroups, nodes: enNodes, params: enParams },
        },
        defaultNS: 'common',
        fallbackLng: DEFAULT_LANGUAGE,
        react: { useSuspense: false },
        supportedLngs: LANGUAGES.map((language) => language.code),
        nonExplicitSupportedLngs: true,
        interpolation: { escapeValue: false },
        detection: {
            order: ['localStorage'],
            lookupLocalStorage: LANGUAGE_STORAGE_KEY,
            caches: [],
        },
    });

function syncDocumentLanguage(language: string): void {
    if (typeof document === 'undefined') return;

    document.documentElement.lang = language;
}

syncDocumentLanguage(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
