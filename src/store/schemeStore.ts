import { create } from 'zustand';
import StorageService, { STORAGE_KEYS } from '../services/storageService';
import { fromScheme, isScheme, toScheme } from '../services/schemeSerializer';
import { nextId } from '../engine/ids';
import { DEFAULT_SETTINGS } from '../engine/types/scheme';
import type { SchemeMeta, SchemeSettings, SchemeV1 } from '../engine/types/scheme';
import { useGraphStore } from './graphStore';

export interface StoredSchemeInfo {
    id: string;
    name: string;
    updatedAt: string;
    nodeCount: number;
}

type SchemeLibrary = Record<string, SchemeV1>;

function now(): string {
    return new Date().toISOString();
}

function createMeta(name: string): SchemeMeta {
    const timestamp = now();
    return { id: nextId('scheme'), name, createdAt: timestamp, updatedAt: timestamp };
}

function readLibrary(): SchemeLibrary {
    return StorageService.load<SchemeLibrary>(STORAGE_KEYS.SCHEMES) ?? {};
}

function toInfo(library: SchemeLibrary): StoredSchemeInfo[] {
    return Object.values(library)
        .map((scheme) => ({
            id: scheme.meta.id,
            name: scheme.meta.name,
            updatedAt: scheme.meta.updatedAt,
            nodeCount: scheme.nodes.length,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface SchemeState {
    meta: SchemeMeta;
    settings: SchemeSettings;
    savedRevision: number;
    library: StoredSchemeInfo[];
    refreshLibrary: () => void;
    createNew: () => void;
    saveAs: (name: string) => boolean;
    save: () => boolean;
    load: (id: string) => boolean;
    remove: (id: string) => void;
    setSetting: <K extends keyof SchemeSettings>(key: K, value: SchemeSettings[K]) => void;
    exportScheme: () => SchemeV1;
    importScheme: (raw: unknown) => boolean;
}

export const useSchemeStore = create<SchemeState>((set, get) => ({
    meta: createMeta(''),
    settings: { ...DEFAULT_SETTINGS },
    savedRevision: 0,
    library: [],

    refreshLibrary: () => {
        set({ library: toInfo(readLibrary()) });
    },

    createNew: () => {
        useGraphStore.getState().clear();
        set({ meta: createMeta(''), settings: { ...DEFAULT_SETTINGS }, savedRevision: useGraphStore.getState().revision });
    },

    saveAs: (name) => {
        const graph = useGraphStore.getState();
        const meta: SchemeMeta = { ...get().meta, id: nextId('scheme'), name, updatedAt: now() };
        const scheme = toScheme({ meta, nodes: graph.nodes, edges: graph.edges, settings: get().settings });

        const library = readLibrary();
        library[meta.id] = scheme;
        const result = StorageService.save(STORAGE_KEYS.SCHEMES, library);
        if (!result.success) return false;

        set({ meta, savedRevision: graph.revision, library: toInfo(library) });
        return true;
    },

    save: () => {
        const { meta } = get();
        if (!meta.name) return false;

        const graph = useGraphStore.getState();
        const updated: SchemeMeta = { ...meta, updatedAt: now() };
        const scheme = toScheme({ meta: updated, nodes: graph.nodes, edges: graph.edges, settings: get().settings });

        const library = readLibrary();
        library[updated.id] = scheme;
        const result = StorageService.save(STORAGE_KEYS.SCHEMES, library);
        if (!result.success) return false;

        set({ meta: updated, savedRevision: graph.revision, library: toInfo(library) });
        return true;
    },

    load: (id) => {
        const library = readLibrary();
        const scheme = library[id];
        if (!scheme) return false;

        const parsed = fromScheme(scheme);
        useGraphStore.getState().replaceGraph(parsed.nodes, parsed.edges);
        set({
            meta: parsed.meta,
            settings: parsed.settings,
            savedRevision: useGraphStore.getState().revision,
            library: toInfo(library),
        });
        return true;
    },

    remove: (id) => {
        const library = readLibrary();
        delete library[id];
        StorageService.save(STORAGE_KEYS.SCHEMES, library);
        set({ library: toInfo(library) });
    },

    setSetting: (key, value) => {
        set((state) => ({ settings: { ...state.settings, [key]: value } }));
    },

    exportScheme: () => {
        const graph = useGraphStore.getState();
        return toScheme({
            meta: { ...get().meta, updatedAt: now() },
            nodes: graph.nodes,
            edges: graph.edges,
            settings: get().settings,
        });
    },

    importScheme: (raw) => {
        if (!isScheme(raw)) return false;

        const parsed = fromScheme(raw);
        useGraphStore.getState().replaceGraph(parsed.nodes, parsed.edges);
        set({
            meta: { ...parsed.meta, id: nextId('scheme') },
            settings: parsed.settings,
            savedRevision: useGraphStore.getState().revision,
        });
        return true;
    },
}));

export function useIsDirty(): boolean {
    const revision = useGraphStore((state) => state.revision);
    const savedRevision = useSchemeStore((state) => state.savedRevision);
    return revision !== savedRevision;
}
