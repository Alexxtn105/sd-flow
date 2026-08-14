import type { FlowWaterfall, WaterfallHop } from '../engine/sim/types';

export type WaterfallPercentile = 'p50' | 'p95' | 'p99';

export const WATERFALL_PERCENTILES: WaterfallPercentile[] = ['p50', 'p95', 'p99'];

export interface WaterfallBar {
    key: string;
    hop: WaterfallHop;
    contributionMs: number;
    offsetPercent: number;
    widthPercent: number;
}

export interface WaterfallLayout {
    percentile: WaterfallPercentile;
    totalMs: number;
    coveredMs: number;
    residualMs: number;
    residualOffsetPercent: number;
    residualWidthPercent: number;
    hiddenCount: number;
    hiddenMs: number;
    bars: WaterfallBar[];
}

const MIN_BAR_PERCENT = 0.6;

export function contributionOf(hop: WaterfallHop, percentile: WaterfallPercentile): number {
    if (percentile === 'p50') return hop.p50Ms;
    if (percentile === 'p95') return hop.p95Ms;
    return hop.p99Ms;
}

function keptHops(hops: WaterfallHop[], percentile: WaterfallPercentile, limit: number): Set<number> {
    const ranked = hops
        .map((hop, index) => ({ index, contribution: contributionOf(hop, percentile) }))
        .sort((left, right) => right.contribution - left.contribution)
        .slice(0, limit);

    return new Set(ranked.map((item) => item.index));
}

export function layoutWaterfall(
    waterfall: FlowWaterfall,
    percentile: WaterfallPercentile,
    limit = Number.POSITIVE_INFINITY,
): WaterfallLayout {
    const totalMs = waterfall.total[percentile];
    const coveredMs = waterfall.covered[percentile];
    const scaleMs = Math.max(totalMs, coveredMs);
    const visible = waterfall.hops.length > limit ? keptHops(waterfall.hops, percentile, limit) : null;

    const bars: WaterfallBar[] = [];
    let elapsedMs = 0;
    let hiddenCount = 0;
    let hiddenMs = 0;

    waterfall.hops.forEach((hop, index) => {
        const contributionMs = contributionOf(hop, percentile);

        if (visible && !visible.has(index)) {
            hiddenCount += 1;
            hiddenMs += contributionMs;
            elapsedMs += contributionMs;
            return;
        }

        const offsetPercent = scaleMs > 0 ? Math.min(100, (elapsedMs / scaleMs) * 100) : 0;
        const rawWidth = scaleMs > 0 ? (contributionMs / scaleMs) * 100 : 0;

        bars.push({
            key: `${hop.edgeId}-${hop.nodeId}-${index}`,
            hop,
            contributionMs,
            offsetPercent,
            widthPercent: Math.max(MIN_BAR_PERCENT, Math.min(100 - offsetPercent, rawWidth)),
        });

        elapsedMs += contributionMs;
    });

    const residualMs = totalMs - coveredMs;
    const residualOffsetPercent = scaleMs > 0 ? Math.min(100, (coveredMs / scaleMs) * 100) : 0;
    const residualWidthPercent =
        scaleMs > 0 ? Math.max(0, Math.min(100 - residualOffsetPercent, (residualMs / scaleMs) * 100)) : 0;

    return {
        percentile,
        totalMs,
        coveredMs,
        residualMs,
        residualOffsetPercent,
        residualWidthPercent,
        hiddenCount,
        hiddenMs,
        bars,
    };
}
