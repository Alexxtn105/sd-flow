export type PanelKey = 'palette' | 'inspector' | 'dashboard';

export type PanelAxis = 'x' | 'y';

export interface PanelBounds {
    axis: PanelAxis;
    min: number;
    max: number;
    preferred: number;
    viewportShare: number;
}

export const PANEL_BOUNDS: Record<PanelKey, PanelBounds> = {
    palette: { axis: 'x', min: 176, max: 460, preferred: 240, viewportShare: 0.35 },
    inspector: { axis: 'x', min: 224, max: 560, preferred: 272, viewportShare: 0.4 },
    dashboard: { axis: 'y', min: 132, max: 640, preferred: 230, viewportShare: 0.62 },
};

export const PANEL_KEYS: PanelKey[] = ['palette', 'inspector', 'dashboard'];

export function resolvePanelMax(key: PanelKey, viewport: number): number {
    const bounds = PANEL_BOUNDS[key];
    return Math.round(Math.max(bounds.min, Math.min(bounds.max, viewport * bounds.viewportShare)));
}

export function clampPanelSize(key: PanelKey, value: number, viewport: number): number {
    const bounds = PANEL_BOUNDS[key];
    if (!Number.isFinite(value)) return bounds.preferred;
    return Math.round(Math.min(resolvePanelMax(key, viewport), Math.max(bounds.min, value)));
}
