import { useCallback, useEffect, useState } from 'react';
import StorageService, { STORAGE_KEYS } from '../services/storageService';

export type ThemeName = 'light' | 'dark';

export interface ThemeState {
    isDarkTheme: boolean;
    theme: ThemeName;
    toggleTheme: () => void;
    setTheme: (theme: ThemeName) => void;
}

export function useTheme(): ThemeState {
    const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
        const saved = StorageService.load<ThemeName>(STORAGE_KEYS.THEME);
        return saved !== 'light';
    });

    useEffect(() => {
        const theme: ThemeName = isDarkTheme ? 'dark' : 'light';
        StorageService.save(STORAGE_KEYS.THEME, theme);
        document.documentElement.setAttribute('data-theme', theme);
        document.body.classList.toggle('dark-theme', isDarkTheme);
    }, [isDarkTheme]);

    const toggleTheme = useCallback(() => setIsDarkTheme((previous) => !previous), []);
    const setTheme = useCallback((theme: ThemeName) => setIsDarkTheme(theme === 'dark'), []);

    return { isDarkTheme, theme: isDarkTheme ? 'dark' : 'light', toggleTheme, setTheme };
}
