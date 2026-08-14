import type { ProbeHeatmap } from '../engine/sim/types';

export type HeatLevel = 'idle' | 'ok' | 'warn' | 'hot';

export const HEAT_LEVELS: HeatLevel[] = ['idle', 'ok', 'warn', 'hot'];

export const DEFAULT_HEAT_WARN = 0.7;

export const DEFAULT_HEAT_ALARM = 0.9;

export interface HeatThresholds {
    warn: number;
    alarm: number;
}

export interface HeatStop {
    level: HeatLevel;
    from: number;
    to: number | null;
}

function bounds(thresholds: HeatThresholds): HeatThresholds {
    const warn = Number.isFinite(thresholds.warn) ? thresholds.warn : DEFAULT_HEAT_WARN;
    const alarm = Number.isFinite(thresholds.alarm) ? thresholds.alarm : DEFAULT_HEAT_ALARM;

    return { warn: Math.min(warn, alarm), alarm: Math.max(warn, alarm) };
}

export function heatLevel(value: number, thresholds: HeatThresholds): HeatLevel {
    if (!Number.isFinite(value) || value <= 0) return 'idle';

    const limits = bounds(thresholds);
    if (value >= limits.alarm) return 'hot';
    if (value >= limits.warn) return 'warn';

    return 'ok';
}

export function heatScale(thresholds: HeatThresholds): HeatStop[] {
    const limits = bounds(thresholds);

    return [
        { level: 'idle', from: 0, to: 0 },
        { level: 'ok', from: 0, to: limits.warn },
        { level: 'warn', from: limits.warn, to: limits.alarm },
        { level: 'hot', from: limits.alarm, to: null },
    ];
}

export function heatValueOf(heatmap: ProbeHeatmap, nodeId: string): number | null {
    const cell = heatmap.cells.find((item) => item.nodeId === nodeId);

    return cell ? cell.value : null;
}
