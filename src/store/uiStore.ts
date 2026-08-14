import { create } from 'zustand';
import StorageService, { STORAGE_KEYS } from '../services/storageService';
import { clampPanelSize, PANEL_BOUNDS, PANEL_KEYS } from '../utils/panelSize';
import type { PanelAxis, PanelKey } from '../utils/panelSize';

export type AppMode = 'sandbox' | 'challenges';

export type PanelSizes = Record<PanelKey, number>;

export interface UiState {
    mode: AppMode;
    paletteCollapsed: boolean;
    challengeCollapsed: boolean;
    inspectorOpen: boolean;
    xray: boolean;
    panels: PanelSizes;
    selectedNodeIds: string[];
    selectedEdgeIds: string[];
    pendingAdd: string | null;
    tutorialOpen: boolean;
    setMode: (mode: AppMode) => void;
    togglePalette: () => void;
    toggleChallengePanel: () => void;
    toggleInspector: () => void;
    toggleXray: () => void;
    setPanelSize: (key: PanelKey, value: number) => void;
    resetPanelSize: (key: PanelKey) => void;
    persistPanels: () => void;
    setSelection: (nodeIds: string[], edgeIds: string[]) => void;
    requestAdd: (componentType: string) => void;
    clearPendingAdd: () => void;
    startTutorial: () => void;
    finishTutorial: () => void;
}

interface StoredPreferences {
    panels?: Partial<PanelSizes>;
    tutorialDone?: boolean;
}

const FALLBACK_VIEWPORT: Record<PanelAxis, number> = { x: 1440, y: 900 };

function viewport(axis: PanelAxis): number {
    if (typeof window === 'undefined') return FALLBACK_VIEWPORT[axis];
    const size = axis === 'x' ? window.innerWidth : window.innerHeight;
    return size > 0 ? size : FALLBACK_VIEWPORT[axis];
}

function fitPanel(key: PanelKey, value: number): number {
    return clampPanelSize(key, value, viewport(PANEL_BOUNDS[key].axis));
}

function loadPanels(): PanelSizes {
    const stored = StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES);
    const panels = {} as PanelSizes;

    for (const key of PANEL_KEYS) {
        const saved = stored?.panels?.[key];
        panels[key] = fitPanel(key, typeof saved === 'number' ? saved : PANEL_BOUNDS[key].preferred);
    }

    return panels;
}

function savePanels(panels: PanelSizes): void {
    const stored = StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES) ?? {};
    StorageService.save(STORAGE_KEYS.PREFERENCES, { ...stored, panels });
}

export function isTutorialDone(): boolean {
    return StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES)?.tutorialDone === true;
}

function saveTutorialDone(): void {
    const stored = StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES) ?? {};
    StorageService.save(STORAGE_KEYS.PREFERENCES, { ...stored, tutorialDone: true });
}

function sameIds(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

export const useUiStore = create<UiState>((set, get) => ({
    mode: 'sandbox',
    paletteCollapsed: false,
    challengeCollapsed: false,
    inspectorOpen: true,
    xray: false,
    panels: loadPanels(),
    selectedNodeIds: [],
    selectedEdgeIds: [],
    pendingAdd: null,
    tutorialOpen: !isTutorialDone(),

    setMode: (mode) => set({ mode }),
    togglePalette: () => set((state) => ({ paletteCollapsed: !state.paletteCollapsed })),
    toggleChallengePanel: () => set((state) => ({ challengeCollapsed: !state.challengeCollapsed })),
    toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
    toggleXray: () => set((state) => ({ xray: !state.xray })),

    setPanelSize: (key, value) => {
        const fitted = fitPanel(key, value);
        if (get().panels[key] === fitted) return;
        set((state) => ({ panels: { ...state.panels, [key]: fitted } }));
    },

    resetPanelSize: (key) => {
        const panels = { ...get().panels, [key]: fitPanel(key, PANEL_BOUNDS[key].preferred) };
        set({ panels });
        savePanels(panels);
    },

    persistPanels: () => savePanels(get().panels),

    setSelection: (nodeIds, edgeIds) => {
        const { selectedNodeIds, selectedEdgeIds } = get();
        if (sameIds(selectedNodeIds, nodeIds) && sameIds(selectedEdgeIds, edgeIds)) return;
        set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
    },
    requestAdd: (componentType) => set({ pendingAdd: componentType }),
    clearPendingAdd: () => set({ pendingAdd: null }),

    startTutorial: () => set({ tutorialOpen: true }),
    finishTutorial: () => {
        saveTutorialDone();
        set({ tutorialOpen: false });
    },
}));
