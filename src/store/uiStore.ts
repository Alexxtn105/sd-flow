import { create } from 'zustand';
import StorageService, { STORAGE_KEYS } from '../services/storageService';
import { DEFAULT_SETTINGS } from '../engine/types/scheme';
import type { SchemeSettings } from '../engine/types/scheme';
import type { RegionView } from '../utils/canvasView';
import { DEFAULT_EDGE_LABEL_MODE, isEdgeLabelMode } from '../utils/edgeLabel';
import type { EdgeLabelMode } from '../utils/edgeLabel';
import { clampPanelSize, PANEL_BOUNDS, PANEL_KEYS } from '../utils/panelSize';
import type { PanelAxis, PanelKey } from '../utils/panelSize';

export type AppMode = 'sandbox' | 'challenges';

export type PanelSizes = Record<PanelKey, number>;

export interface ConnectionSource {
    nodeId: string;
    componentType: string;
    handleId: string;
    handleType: 'source' | 'target';
}

export interface UiState {
    mode: AppMode;
    paletteCollapsed: boolean;
    challengeCollapsed: boolean;
    inspectorOpen: boolean;
    xray: boolean;
    panels: PanelSizes;
    selectedNodeIds: string[];
    selectedEdgeIds: string[];
    focusRequest: number;
    pendingAdd: string | null;
    probeWindowIds: string[];
    heatmapProbeId: string | null;
    tutorialOpen: boolean;
    helpBlockType: string | null;
    paramHints: boolean;
    heatmapOn: boolean;
    minimapOn: boolean;
    edgeLabels: EdgeLabelMode;
    defaultConsistencyModel: SchemeSettings['consistencyModel'];
    paramPopoverNodeId: string | null;
    collapsedGroupIds: string[];
    regionView: RegionView;
    activeRegionId: string | null;
    connectionSource: ConnectionSource | null;
    setMode: (mode: AppMode) => void;
    togglePalette: () => void;
    toggleChallengePanel: () => void;
    toggleInspector: () => void;
    openInspector: () => void;
    toggleParamPopover: (nodeId: string) => void;
    closeParamPopover: () => void;
    toggleGroupCollapsed: (nodeId: string) => void;
    setRegionView: (view: RegionView) => void;
    setActiveRegion: (nodeId: string | null) => void;
    toggleXray: () => void;
    setPanelSize: (key: PanelKey, value: number) => void;
    resetPanelSize: (key: PanelKey) => void;
    persistPanels: () => void;
    setSelection: (nodeIds: string[], edgeIds: string[]) => void;
    focusNodes: (nodeIds: string[], edgeIds: string[]) => void;
    requestAdd: (componentType: string) => void;
    clearPendingAdd: () => void;
    toggleProbeWindow: (probeId: string) => void;
    closeProbeWindow: (probeId: string) => void;
    toggleHeatmapProbe: (probeId: string) => void;
    startTutorial: () => void;
    finishTutorial: () => void;
    openBlockHelp: (componentType: string) => void;
    closeBlockHelp: () => void;
    toggleParamHints: () => void;
    toggleHeatmap: () => void;
    toggleMinimap: () => void;
    setEdgeLabels: (mode: EdgeLabelMode) => void;
    setDefaultConsistencyModel: (mode: SchemeSettings['consistencyModel']) => void;
    startConnection: (source: ConnectionSource) => void;
    endConnection: () => void;
}

interface StoredPreferences {
    panels?: Partial<PanelSizes>;
    tutorialDone?: boolean;
    paramHints?: boolean;
    heatmapOn?: boolean;
    minimapOn?: boolean;
    edgeLabels?: EdgeLabelMode;
    defaultConsistencyModel?: SchemeSettings['consistencyModel'];
}

const FALLBACK_VIEWPORT: Record<PanelAxis, number> = { x: 1440, y: 900 };

const MINIMAP_MIN_VIEWPORT = 768;

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

function savePreference(patch: StoredPreferences): void {
    const stored = StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES) ?? {};
    StorageService.save(STORAGE_KEYS.PREFERENCES, { ...stored, ...patch });
}

export function isTutorialDone(): boolean {
    return StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES)?.tutorialDone === true;
}

function loadParamHints(): boolean {
    return StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES)?.paramHints === true;
}

function loadHeatmapOn(): boolean {
    return StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES)?.heatmapOn !== false;
}

function loadMinimapOn(): boolean {
    const stored = StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES)?.minimapOn;
    return typeof stored === 'boolean' ? stored : viewport('x') > MINIMAP_MIN_VIEWPORT;
}

function loadEdgeLabels(): EdgeLabelMode {
    const stored = StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES)?.edgeLabels;
    return isEdgeLabelMode(stored) ? stored : DEFAULT_EDGE_LABEL_MODE;
}

function loadDefaultConsistencyModel(): SchemeSettings['consistencyModel'] {
    const stored = StorageService.load<StoredPreferences>(STORAGE_KEYS.PREFERENCES)?.defaultConsistencyModel;
    return stored === 'off' || stored === 'attribute' || stored === 'anomalies'
        ? stored
        : DEFAULT_SETTINGS.consistencyModel;
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
    focusRequest: 0,
    pendingAdd: null,
    probeWindowIds: [],
    heatmapProbeId: null,
    tutorialOpen: !isTutorialDone(),
    helpBlockType: null,
    paramHints: loadParamHints(),
    heatmapOn: loadHeatmapOn(),
    minimapOn: loadMinimapOn(),
    edgeLabels: loadEdgeLabels(),
    defaultConsistencyModel: loadDefaultConsistencyModel(),
    paramPopoverNodeId: null,
    collapsedGroupIds: [],
    regionView: 'all',
    activeRegionId: null,
    connectionSource: null,

    setMode: (mode) => set({ mode }),
    togglePalette: () => set((state) => ({ paletteCollapsed: !state.paletteCollapsed })),
    toggleChallengePanel: () => set((state) => ({ challengeCollapsed: !state.challengeCollapsed })),
    toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
    openInspector: () => set({ inspectorOpen: true }),

    toggleParamPopover: (nodeId) =>
        set((state) => ({ paramPopoverNodeId: state.paramPopoverNodeId === nodeId ? null : nodeId })),
    closeParamPopover: () => {
        if (get().paramPopoverNodeId === null) return;
        set({ paramPopoverNodeId: null });
    },
    toggleXray: () => set((state) => ({ xray: !state.xray })),

    setPanelSize: (key, value) => {
        const fitted = fitPanel(key, value);
        if (get().panels[key] === fitted) return;
        set((state) => ({ panels: { ...state.panels, [key]: fitted } }));
    },

    resetPanelSize: (key) => {
        const panels = { ...get().panels, [key]: fitPanel(key, PANEL_BOUNDS[key].preferred) };
        set({ panels });
        savePreference({ panels });
    },

    persistPanels: () => savePreference({ panels: get().panels }),

    setSelection: (nodeIds, edgeIds) => {
        const { selectedNodeIds, selectedEdgeIds } = get();
        if (sameIds(selectedNodeIds, nodeIds) && sameIds(selectedEdgeIds, edgeIds)) return;
        set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
    },
    focusNodes: (nodeIds, edgeIds) =>
        set((state) => ({
            selectedNodeIds: nodeIds,
            selectedEdgeIds: edgeIds,
            focusRequest: state.focusRequest + 1,
        })),

    requestAdd: (componentType) => set({ pendingAdd: componentType }),
    clearPendingAdd: () => set({ pendingAdd: null }),

    toggleProbeWindow: (probeId) =>
        set((state) => {
            if (!state.probeWindowIds.includes(probeId)) {
                return { probeWindowIds: [...state.probeWindowIds, probeId] };
            }

            return {
                probeWindowIds: state.probeWindowIds.filter((id) => id !== probeId),
                heatmapProbeId: state.heatmapProbeId === probeId ? null : state.heatmapProbeId,
            };
        }),

    closeProbeWindow: (probeId) =>
        set((state) => ({
            probeWindowIds: state.probeWindowIds.filter((id) => id !== probeId),
            heatmapProbeId: state.heatmapProbeId === probeId ? null : state.heatmapProbeId,
        })),

    toggleHeatmapProbe: (probeId) =>
        set((state) => ({ heatmapProbeId: state.heatmapProbeId === probeId ? null : probeId })),

    startTutorial: () => set({ tutorialOpen: true }),
    finishTutorial: () => {
        savePreference({ tutorialDone: true });
        set({ tutorialOpen: false });
    },

    openBlockHelp: (componentType) => set({ helpBlockType: componentType }),
    closeBlockHelp: () => set({ helpBlockType: null }),

    toggleHeatmap: () => {
        const heatmapOn = !get().heatmapOn;
        savePreference({ heatmapOn });
        set({ heatmapOn });
    },

    toggleMinimap: () => {
        const minimapOn = !get().minimapOn;
        savePreference({ minimapOn });
        set({ minimapOn });
    },

    setEdgeLabels: (edgeLabels) => {
        if (get().edgeLabels === edgeLabels) return;
        savePreference({ edgeLabels });
        set({ edgeLabels });
    },

    setDefaultConsistencyModel: (mode) => {
        savePreference({ defaultConsistencyModel: mode });
        set({ defaultConsistencyModel: mode });
    },

    toggleParamHints: () => {
        const paramHints = !get().paramHints;
        savePreference({ paramHints });
        set({ paramHints });
    },

    toggleGroupCollapsed: (nodeId) =>
        set((state) => ({
            collapsedGroupIds: state.collapsedGroupIds.includes(nodeId)
                ? state.collapsedGroupIds.filter((id) => id !== nodeId)
                : [...state.collapsedGroupIds, nodeId],
        })),

    setRegionView: (regionView) => set({ regionView }),
    setActiveRegion: (activeRegionId) => set({ activeRegionId }),

    startConnection: (source) => set({ connectionSource: source }),
    endConnection: () => {
        if (get().connectionSource === null) return;
        set({ connectionSource: null });
    },
}));
