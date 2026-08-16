import { useCallback, useEffect, useRef } from 'react';
import StorageService, { STORAGE_KEYS } from '../services/storageService';
import { fromScheme, toScheme } from '../services/schemeSerializer';
import { migrateScheme } from '../services/schemeMigrations';
import type { ParsedScheme } from '../services/schemeSerializer';
import { useGraphStore } from '../store/graphStore';
import { useSchemeStore } from '../store/schemeStore';

const DEBOUNCE_MS = 1500;

export interface AutoSaveApi {
    loadAutoSave: () => ParsedScheme | null;
    clearAutoSave: () => void;
}

export function useAutoSave(enabled: boolean): AutoSaveApi {
    const revision = useGraphStore((state) => state.revision);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!enabled || revision === 0) return;

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            const graph = useGraphStore.getState();
            const scheme = useSchemeStore.getState();
            StorageService.save(
                STORAGE_KEYS.AUTO_SAVE,
                toScheme({
                    meta: scheme.meta,
                    nodes: graph.nodes,
                    edges: graph.edges,
                    settings: scheme.settings,
                }),
            );
        }, DEBOUNCE_MS);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [enabled, revision]);

    const loadAutoSave = useCallback((): ParsedScheme | null => {
        const read = migrateScheme(StorageService.load<unknown>(STORAGE_KEYS.AUTO_SAVE));
        if (!read.ok) return null;
        return fromScheme(read.scheme);
    }, []);

    const clearAutoSave = useCallback(() => {
        StorageService.remove(STORAGE_KEYS.AUTO_SAVE);
    }, []);

    return { loadAutoSave, clearAutoSave };
}
