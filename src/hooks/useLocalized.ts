import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalizedText } from '../engine/challenges/types';

export function pickLanguage(code: string): keyof LocalizedText {
    return code.startsWith('en') ? 'en' : 'ru';
}

export default function useLocalized(): (text: LocalizedText) => string {
    const { i18n } = useTranslation();
    const language = pickLanguage(i18n.language);

    return useCallback((text: LocalizedText) => text[language], [language]);
}
