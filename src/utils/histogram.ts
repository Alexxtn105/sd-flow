import type { HistogramScale, LatencyHistogram } from '../engine/sim/types';

export type HistogramMarkerKey = 'p50' | 'p95' | 'p99';

export const HISTOGRAM_MARKERS: HistogramMarkerKey[] = ['p50', 'p95', 'p99'];

export const HISTOGRAM_WIDTH = 240;

export const HISTOGRAM_HEIGHT = 72;

export const HISTOGRAM_TICKS = 4;

export interface HistogramOptions {
    width?: number;
    height?: number;
    ticks?: number;
}

export interface HistogramBar {
    index: number;
    fromMs: number;
    toMs: number;
    count: number;
    share: number;
    x: number;
    y: number;
    width: number;
    height: number;
    tail: boolean;
}

export interface HistogramTick {
    index: number;
    value: number;
    x: number;
}

export interface HistogramMarker {
    key: HistogramMarkerKey;
    value: number;
    x: number;
}

export interface HistogramTail {
    x: number;
    width: number;
}

export interface HistogramLayout {
    width: number;
    height: number;
    scale: HistogramScale;
    buckets: number;
    total: number;
    peakCount: number;
    lowMs: number;
    highMs: number;
    zeroCount: number;
    bars: HistogramBar[];
    ticks: HistogramTick[];
    markers: HistogramMarker[];
    tail: HistogramTail | null;
}

const COORDINATE_DIGITS = 2;

const MIN_BAR_HEIGHT = 1;

const TAIL_MARKER: HistogramMarkerKey = 'p95';

function round(value: number): number {
    return Number(value.toFixed(COORDINATE_DIGITS));
}

function positive(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function valueOf(histogram: LatencyHistogram, key: HistogramMarkerKey): number {
    if (key === 'p50') return histogram.p50Ms;
    if (key === 'p95') return histogram.p95Ms;
    return histogram.p99Ms;
}

function fractionWithin(low: number, high: number, value: number, scale: HistogramScale): number {
    if (scale === 'log' && low > 0 && high > low) {
        return (Math.log10(value) - Math.log10(low)) / (Math.log10(high) - Math.log10(low));
    }

    return high > low ? (value - low) / (high - low) : 0;
}

export function positionOf(histogram: LatencyHistogram, value: number): number {
    const buckets = histogram.counts.length;
    if (buckets === 0 || histogram.edges.length !== buckets + 1) return 0;
    if (!Number.isFinite(value) || value <= histogram.edges[0]) return 0;
    if (value >= histogram.edges[buckets]) return 1;

    let index = 0;
    while (index < buckets - 1 && value >= histogram.edges[index + 1]) index += 1;

    const inside = fractionWithin(histogram.edges[index], histogram.edges[index + 1], value, histogram.scale);

    return (index + Math.min(Math.max(inside, 0), 1)) / buckets;
}

function tickIndexes(buckets: number, requested: number): number[] {
    const steps = Math.max(1, Math.round(requested));
    const indexes: number[] = [];

    for (let step = 0; step <= steps; step += 1) {
        const index = Math.min(buckets, Math.round((step * buckets) / steps));
        if (!indexes.includes(index)) indexes.push(index);
    }

    return indexes;
}

export function layoutHistogram(histogram: LatencyHistogram, options: HistogramOptions = {}): HistogramLayout {
    const width = positive(options.width, HISTOGRAM_WIDTH);
    const height = positive(options.height, HISTOGRAM_HEIGHT);
    const buckets = histogram.counts.length;
    const peakCount = histogram.counts.reduce((peak, count) => Math.max(peak, count), 0);
    const barWidth = buckets > 0 ? width / buckets : width;
    const tailFrom = histogram.total > 0 ? valueOf(histogram, TAIL_MARKER) : Number.POSITIVE_INFINITY;

    const bars: HistogramBar[] = histogram.counts.map((count, index) => {
        const filled = peakCount > 0 ? (count / peakCount) * height : 0;
        const barHeight = count > 0 ? Math.max(MIN_BAR_HEIGHT, filled) : 0;

        return {
            index,
            fromMs: histogram.edges[index],
            toMs: histogram.edges[index + 1],
            count,
            share: histogram.total > 0 ? count / histogram.total : 0,
            x: round(index * barWidth),
            y: round(height - barHeight),
            width: round(barWidth),
            height: round(barHeight),
            tail: histogram.edges[index] >= tailFrom,
        };
    });

    const ticks: HistogramTick[] = tickIndexes(buckets, options.ticks ?? HISTOGRAM_TICKS).map((index) => ({
        index,
        value: histogram.edges[index] ?? 0,
        x: round(buckets > 0 ? (index / buckets) * width : 0),
    }));

    const markers: HistogramMarker[] =
        histogram.total > 0
            ? HISTOGRAM_MARKERS.map((key) => {
                  const value = valueOf(histogram, key);

                  return { key, value, x: round(positionOf(histogram, value) * width) };
              })
            : [];

    const tailX = histogram.total > 0 ? round(positionOf(histogram, tailFrom) * width) : width;

    return {
        width,
        height,
        scale: histogram.scale,
        buckets,
        total: histogram.total,
        peakCount,
        lowMs: histogram.edges[0] ?? 0,
        highMs: histogram.edges[buckets] ?? 0,
        zeroCount: histogram.zeroCount,
        bars,
        ticks,
        markers,
        tail: tailX < width ? { x: tailX, width: round(width - tailX) } : null,
    };
}
