import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const COARSE_POINTER = '(pointer: coarse)';
const TouchContext = createContext(false);

export function TouchProvider({ children }: { children: ReactNode }) {
    const [isTouch, setIsTouch] = useState(() => window.matchMedia(COARSE_POINTER).matches);

    useEffect(() => {
        const query = window.matchMedia(COARSE_POINTER);
        const handler = (event: MediaQueryListEvent) => setIsTouch(event.matches);
        query.addEventListener('change', handler);
        return () => query.removeEventListener('change', handler);
    }, []);

    return <TouchContext.Provider value={isTouch}>{children}</TouchContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTouchContext(): boolean {
    return useContext(TouchContext);
}
