import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useTheme } from '../hooks/useTheme';
import type { ThemeState } from '../hooks/useTheme';

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
    return <ThemeContext.Provider value={useTheme()}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useThemeContext(): ThemeState {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useThemeContext требует ThemeProvider');
    }
    return context;
}
