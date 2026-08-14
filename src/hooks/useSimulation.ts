import { useEffect, useRef } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useSchemeStore } from '../store/schemeStore';
import { useSimStore } from '../store/simStore';
import { toScheme } from '../services/schemeSerializer';

const DEBOUNCE_MS = 250;

export function useSimulation(): void {
    const revision = useGraphStore((state) => state.revision);
    const scenario = useSimStore((state) => state.scenario);
    const settings = useSchemeStore((state) => state.settings);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);

        timer.current = setTimeout(() => {
            const { nodes, edges } = useGraphStore.getState();
            const { meta } = useSchemeStore.getState();

            useSimStore.getState().run(toScheme({ meta, nodes, edges, settings }));
        }, DEBOUNCE_MS);

        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, [revision, scenario, settings]);
}
