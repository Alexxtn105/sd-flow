export type SparklineLevel = 'ok' | 'warn' | 'alarm';

export type SparklineAlert = 'warn' | 'alarm';

export interface SparklineOptions {
    width?: number;
    height?: number;
    min?: number;
    max?: number;
    warn?: number;
    alarm?: number;
}

export interface SparklinePoint {
    index: number;
    value: number;
    x: number;
    y: number;
    level: SparklineLevel;
}

export interface SparklineCrossing {
    index: number;
    value: number;
    x: number;
    level: SparklineAlert;
}

export interface SparklineSpan {
    level: SparklineAlert;
    fromIndex: number;
    toIndex: number;
    x: number;
    width: number;
}

export interface SparklineLayout {
    width: number;
    height: number;
    min: number;
    max: number;
    last: number | null;
    lastLevel: SparklineLevel;
    peak: number | null;
    points: SparklinePoint[];
    line: string;
    area: string;
    warnY: number | null;
    alarmY: number | null;
    crossings: SparklineCrossing[];
    spans: SparklineSpan[];
}

export const SPARKLINE_WIDTH = 240;

export const SPARKLINE_HEIGHT = 60;

const COORDINATE_DIGITS = 2;

const SEVERITY: Record<SparklineLevel, number> = { ok: 0, warn: 1, alarm: 2 };

interface Sample {
    index: number;
    value: number;
}

interface AlertRun {
    level: SparklineAlert;
    fromIndex: number;
    toIndex: number;
}

function round(value: number): number {
    return Number(value.toFixed(COORDINATE_DIGITS));
}

function positive(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function bound(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function levelAt(value: number, warn: number | null, alarm: number | null): SparklineLevel {
    if (alarm !== null && value >= alarm) return 'alarm';
    if (warn !== null && value >= warn) return 'warn';
    return 'ok';
}

function finiteSamples(values: number[]): Sample[] {
    return values
        .map((value, index) => ({ index, value }))
        .filter((sample) => Number.isFinite(sample.value));
}

function extremesOf(samples: Sample[]): { low: number; high: number } {
    if (samples.length === 0) return { low: 0, high: 0 };

    return samples.reduce(
        (extremes, sample) => ({
            low: Math.min(extremes.low, sample.value),
            high: Math.max(extremes.high, sample.value),
        }),
        { low: samples[0].value, high: samples[0].value },
    );
}

function alertRuns(points: SparklinePoint[]): AlertRun[] {
    const runs: AlertRun[] = [];

    for (const point of points) {
        if (point.level === 'ok') continue;

        const open = runs[runs.length - 1];
        if (open && open.level === point.level && open.toIndex === point.index - 1) {
            open.toIndex = point.index;
            continue;
        }

        runs.push({ level: point.level, fromIndex: point.index, toIndex: point.index });
    }

    return runs;
}

function escalations(points: SparklinePoint[]): SparklineCrossing[] {
    const crossings: SparklineCrossing[] = [];
    let previous: SparklineLevel = 'ok';

    for (const point of points) {
        if (point.level !== 'ok' && SEVERITY[point.level] > SEVERITY[previous]) {
            crossings.push({ index: point.index, value: point.value, x: point.x, level: point.level });
        }
        previous = point.level;
    }

    return crossings;
}

export function layoutSparkline(values: number[], options: SparklineOptions = {}): SparklineLayout {
    const width = positive(options.width, SPARKLINE_WIDTH);
    const height = positive(options.height, SPARKLINE_HEIGHT);
    const warn = bound(options.warn);
    const alarm = bound(options.alarm);

    const samples = finiteSamples(values);
    const extremes = extremesOf(samples);

    const min = bound(options.min) ?? Math.min(0, extremes.low);
    const ceiling = bound(options.max) ?? extremes.high;
    const max = Math.max(ceiling, warn ?? ceiling, alarm ?? ceiling, min);
    const span = max - min;

    const stepX = width / Math.max(values.length - 1, 1);
    const scaleY = (value: number): number =>
        span > 0 ? height - Math.min(Math.max((value - min) / span, 0), 1) * height : height;

    const points: SparklinePoint[] = samples.map((sample) => ({
        index: sample.index,
        value: sample.value,
        x: round(sample.index * stepX),
        y: round(scaleY(sample.value)),
        level: levelAt(sample.value, warn, alarm),
    }));

    const drawn = points.length === 1 ? [points[0], { ...points[0], x: round(width) }] : points;
    const line = drawn.map((point) => `${point.x},${point.y}`).join(' ');
    const baseline = round(height);
    const area =
        drawn.length > 0
            ? `${line} ${drawn[drawn.length - 1].x},${baseline} ${drawn[0].x},${baseline}`
            : '';

    const spans: SparklineSpan[] = alertRuns(points).map((run) => {
        const from = Math.max(0, run.fromIndex * stepX - stepX / 2);
        const to = Math.min(width, run.toIndex * stepX + stepX / 2);

        return { ...run, x: round(from), width: round(Math.max(to - from, 0)) };
    });

    const last = points.length > 0 ? points[points.length - 1] : null;

    return {
        width,
        height,
        min,
        max,
        last: last === null ? null : last.value,
        lastLevel: last === null ? 'ok' : last.level,
        peak: samples.length > 0 ? extremes.high : null,
        points,
        line,
        area,
        warnY: warn === null ? null : round(scaleY(warn)),
        alarmY: alarm === null ? null : round(scaleY(alarm)),
        crossings: escalations(points),
        spans,
    };
}
