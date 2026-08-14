import { create } from 'zustand';

export type AppMode = 'sandbox' | 'challenges';

export interface UiState {
    mode: AppMode;
    paletteCollapsed: boolean;
    inspectorOpen: boolean;
    xray: boolean;
    selectedNodeIds: string[];
    selectedEdgeIds: string[];
    pendingAdd: string | null;
    setMode: (mode: AppMode) => void;
    togglePalette: () => void;
    toggleInspector: () => void;
    toggleXray: () => void;
    setSelection: (nodeIds: string[], edgeIds: string[]) => void;
    requestAdd: (componentType: string) => void;
    clearPendingAdd: () => void;
}

function sameIds(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

export const useUiStore = create<UiState>((set, get) => ({
    mode: 'sandbox',
    paletteCollapsed: false,
    inspectorOpen: true,
    xray: false,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    pendingAdd: null,

    setMode: (mode) => set({ mode }),
    togglePalette: () => set((state) => ({ paletteCollapsed: !state.paletteCollapsed })),
    toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
    toggleXray: () => set((state) => ({ xray: !state.xray })),
    setSelection: (nodeIds, edgeIds) => {
        const { selectedNodeIds, selectedEdgeIds } = get();
        if (sameIds(selectedNodeIds, nodeIds) && sameIds(selectedEdgeIds, edgeIds)) return;
        set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
    },
    requestAdd: (componentType) => set({ pendingAdd: componentType }),
    clearPendingAdd: () => set({ pendingAdd: null }),
}));
