import { describe, expect, it } from 'vitest';
import type { FlowWaterfall, WaterfallHop } from '../../src/engine/sim/types';
import { contributionOf, layoutWaterfall } from '../../src/utils/waterfall';

function hop(nodeId: string, p99Ms: number, overrides: Partial<WaterfallHop> = {}): WaterfallHop {
    return {
        edgeId: `e-${nodeId}`,
        nodeId,
        parentNodeId: 'entry',
        depth: 1,
        arm: 'sequential',
        visitsPerRequest: 1,
        trafficShare: 1,
        callsPerRequest: 1,
        cacheMissShare: null,
        meanMs: p99Ms,
        serviceMs: p99Ms,
        waitMs: 0,
        networkMs: 0,
        retryMs: 0,
        p50Ms: p99Ms / 2,
        p95Ms: p99Ms * 0.9,
        p99Ms,
        ...overrides,
    };
}

function waterfallOf(hops: WaterfallHop[], totalMs: number): FlowWaterfall {
    const covered = {
        p50: hops.reduce((sum, item) => sum + item.p50Ms, 0),
        p95: hops.reduce((sum, item) => sum + item.p95Ms, 0),
        p99: hops.reduce((sum, item) => sum + item.p99Ms, 0),
    };

    return {
        flowId: 'flow-1',
        entryNodeId: 'entry',
        total: { mean: totalMs / 2, p50: covered.p50, p95: covered.p95, p99: totalMs },
        covered,
        hops,
    };
}

describe('раскладка водопада', () => {
    it('ставит хопы друг за другом по накопленному времени', () => {
        const layout = layoutWaterfall(waterfallOf([hop('a', 20), hop('b', 30), hop('c', 50)], 100), 'p99');

        expect(layout.bars.map((bar) => bar.offsetPercent)).toEqual([0, 20, 50]);
        expect(layout.bars.map((bar) => bar.widthPercent)).toEqual([20, 30, 50]);
        expect(layout.coveredMs).toBe(100);
        expect(layout.residualMs).toBe(0);
    });

    it('берёт вклад того квантиля, который выбран', () => {
        const hops = [hop('a', 20), hop('b', 30)];

        expect(contributionOf(hops[0], 'p50')).toBe(10);
        expect(layoutWaterfall(waterfallOf(hops, 100), 'p50').bars.map((bar) => bar.contributionMs)).toEqual([10, 15]);
        expect(layoutWaterfall(waterfallOf(hops, 100), 'p95').bars.map((bar) => bar.contributionMs)).toEqual([18, 27]);
    });

    it('показывает остаток, не покрытый хопами', () => {
        const layout = layoutWaterfall(waterfallOf([hop('a', 30), hop('b', 30)], 100), 'p99');

        expect(layout.residualMs).toBe(40);
        expect(layout.residualOffsetPercent).toBe(60);
        expect(layout.residualWidthPercent).toBe(40);
    });

    it('не выпускает полосу за правый край, когда сумма хопов больше квантиля', () => {
        const layout = layoutWaterfall(waterfallOf([hop('a', 80), hop('b', 80)], 100), 'p99');

        for (const bar of layout.bars) {
            expect(bar.offsetPercent + bar.widthPercent).toBeLessThanOrEqual(100);
        }
        expect(layout.residualMs).toBeLessThan(0);
        expect(layout.residualWidthPercent).toBe(0);
    });

    it('сворачивает самые мелкие хопы, сохраняя их вклад в счётчике', () => {
        const layout = layoutWaterfall(waterfallOf([hop('a', 5), hop('b', 60), hop('c', 35)], 100), 'p99', 2);

        expect(layout.bars.map((bar) => bar.hop.nodeId)).toEqual(['b', 'c']);
        expect(layout.hiddenCount).toBe(1);
        expect(layout.hiddenMs).toBe(5);
        expect(layout.bars[0].offsetPercent).toBe(5);
    });

    it('на нулевой задержке не выдаёт NaN', () => {
        const layout = layoutWaterfall(waterfallOf([hop('a', 0), hop('b', 0)], 0), 'p99');

        for (const bar of layout.bars) {
            expect(Number.isFinite(bar.offsetPercent)).toBe(true);
            expect(Number.isFinite(bar.widthPercent)).toBe(true);
        }
        expect(layout.residualWidthPercent).toBe(0);
    });

    it('различает последовательные и параллельные плечи', () => {
        const layout = layoutWaterfall(
            waterfallOf([hop('a', 20), hop('b', 30, { arm: 'parallel' })], 50),
            'p99',
        );

        expect(layout.bars.map((bar) => bar.hop.arm)).toEqual(['sequential', 'parallel']);
    });
});
