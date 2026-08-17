import type { Timeline, TimelineSample } from '../engine/sim/types';

export type TimelineMetric = 'lambda' | 'utilization' | 'p99' | 'backlog' | 'errors' | 'instances';

export const TIMELINE_METRICS: TimelineMetric[] = [
    'lambda',
    'utilization',
    'p99',
    'backlog',
    'errors',
    'instances',
];

export const TIMELINE_SYSTEM_SCOPE = 'system';

export interface TimelineCursor {
    index: number;
    sample: TimelineSample;
    value: number;
    worstNodeId: string | null;
    worstValue: number;
}

export function systemValue(sample: TimelineSample, metric: TimelineMetric): number {
    if (metric === 'lambda') return sample.lambda;
    if (metric === 'utilization') return sample.peakUtilization;
    if (metric === 'p99') return sample.worstP99Ms;
    if (metric === 'backlog') return sample.backlog;
    if (metric === 'errors') return sample.errorRate;

    return sample.instances;
}

export function nodeValue(sample: TimelineSample, nodeId: string, metric: TimelineMetric): number {
    const node = sample.nodes[nodeId];
    if (!node) return 0;

    if (metric === 'lambda') return node.lambda;
    if (metric === 'utilization') return node.utilization;
    if (metric === 'p99') return node.p99Ms;
    if (metric === 'backlog') return node.backlog;
    if (metric === 'errors') return node.errorRate;

    return node.instances;
}

export function scopedValue(sample: TimelineSample, scope: string, metric: TimelineMetric): number {
    return scope === TIMELINE_SYSTEM_SCOPE ? systemValue(sample, metric) : nodeValue(sample, scope, metric);
}

export function defaultCursorIndex(timeline: Timeline): number {
    const samples = timeline.samples;
    if (samples.length === 0) return 0;

    const breach = samples.findIndex((sample) => sample.breach);

    return breach >= 0 ? breach : samples.length - 1;
}

export function clampCursorIndex(timeline: Timeline, index: number): number {
    const last = Math.max(timeline.samples.length - 1, 0);

    return Math.min(Math.max(Math.round(index), 0), last);
}

export function cursorIndexAt(timeline: Timeline, share: number): number {
    const horizonSec = Math.max(timeline.horizonSec, timeline.stepSec);
    const timeSec = Math.min(Math.max(share, 0), 1) * horizonSec;
    const samples = timeline.samples;

    let nearest = 0;
    for (let index = 1; index < samples.length; index += 1) {
        if (Math.abs(samples[index].timeSec - timeSec) < Math.abs(samples[nearest].timeSec - timeSec)) {
            nearest = index;
        }
    }

    return nearest;
}

export function timelineCursor(
    timeline: Timeline,
    index: number,
    scope: string,
    metric: TimelineMetric,
): TimelineCursor | null {
    const sample = timeline.samples[clampCursorIndex(timeline, index)];
    if (!sample) return null;

    let worstNodeId: string | null = null;
    let worstValue = 0;

    for (const nodeId of Object.keys(sample.nodes)) {
        const value = nodeValue(sample, nodeId, metric);
        if (worstNodeId !== null && value <= worstValue) continue;

        worstNodeId = nodeId;
        worstValue = value;
    }

    return {
        index: clampCursorIndex(timeline, index),
        sample,
        value: scopedValue(sample, scope, metric),
        worstNodeId,
        worstValue,
    };
}
