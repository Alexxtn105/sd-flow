import { describe, expect, it } from 'vitest';
import type { LatencyHistogram } from '../../src/engine/sim/types';
import { HISTOGRAM_HEIGHT, HISTOGRAM_WIDTH, layoutHistogram, positionOf } from '../../src/utils/histogram';

const BOX = { width: 100, height: 10 };

function histogram(overrides: Partial<LatencyHistogram> = {}): LatencyHistogram {
    return {
        scale: 'linear',
        edges: [1, 1.75, 2.5, 3.25, 4],
        counts: [1, 1, 1, 1],
        total: 4,
        zeroCount: 0,
        meanMs: 2.5,
        p50Ms: 2.5,
        p95Ms: 3.85,
        p99Ms: 3.97,
        ...overrides,
    };
}

describe('раскладка гистограммы', () => {
    it('раскладывает столбцы равномерно по ширине', () => {
        const layout = layoutHistogram(histogram(), BOX);

        expect(layout.bars.map((bar) => bar.x)).toEqual([0, 25, 50, 75]);
        expect(layout.bars.every((bar) => bar.width === 25)).toBe(true);
        expect(layout.buckets).toBe(4);
        expect(layout.lowMs).toBe(1);
        expect(layout.highMs).toBe(4);
    });

    it('меряет высоту столбца долей от самого населённого', () => {
        const layout = layoutHistogram(histogram({ counts: [4, 2, 0, 1], total: 7 }), BOX);

        expect(layout.peakCount).toBe(4);
        expect(layout.bars.map((bar) => bar.height)).toEqual([10, 5, 0, 2.5]);
        expect(layout.bars.map((bar) => bar.y)).toEqual([0, 5, 10, 7.5]);
    });

    it('оставляет видимую высоту одинокому сэмплу на фоне тысячи', () => {
        const layout = layoutHistogram(histogram({ counts: [1000, 1, 0, 0], total: 1001 }), BOX);

        expect(layout.bars[1].height).toBe(1);
        expect(layout.bars[2].height).toBe(0);
    });

    it('считает долю каждого столбца от всех сэмплов', () => {
        const layout = layoutHistogram(histogram({ counts: [2, 1, 1, 0], total: 4 }), BOX);

        expect(layout.bars.map((bar) => bar.share)).toEqual([0.5, 0.25, 0.25, 0]);
    });

    it('ставит метки квантилей на их место по оси', () => {
        const layout = layoutHistogram(histogram(), BOX);

        expect(layout.markers.map((marker) => marker.key)).toEqual(['p50', 'p95', 'p99']);
        expect(layout.markers.map((marker) => marker.x)).toEqual([50, 95, 99]);
    });

    it('подсвечивает хвост правее p95', () => {
        const layout = layoutHistogram(histogram({ p95Ms: 2.5 }), BOX);

        expect(layout.tail).toEqual({ x: 50, width: 50 });
        expect(layout.bars.map((bar) => bar.tail)).toEqual([false, false, true, true]);
    });

    it('на логарифмической шкале расстояние считается по логарифму, а не по разнице', () => {
        const log = histogram({ scale: 'log', edges: [1, 10, 100], counts: [1, 1], total: 2 });

        expect(positionOf(log, 10)).toBe(0.5);
        expect(positionOf(log, 10 ** 1.5)).toBeCloseTo(0.75, 10);
        expect(positionOf(log, 3.1622776601683795)).toBeCloseTo(0.25, 10);
    });

    it('прижимает значения за пределами области к краям', () => {
        const layout = histogram();

        expect(positionOf(layout, 0.1)).toBe(0);
        expect(positionOf(layout, 1000)).toBe(1);
        expect(positionOf(layout, Number.NaN)).toBe(0);
    });

    it('на пустой гистограмме не рисует ни столбцов, ни меток', () => {
        const layout = layoutHistogram(
            histogram({ counts: [0, 0, 0, 0], total: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 }),
            BOX,
        );

        expect(layout.peakCount).toBe(0);
        expect(layout.bars.every((bar) => bar.height === 0)).toBe(true);
        expect(layout.markers).toEqual([]);
        expect(layout.tail).toBeNull();
    });

    it('гистограмма без корзин не ломает раскладку', () => {
        const layout = layoutHistogram(histogram({ edges: [], counts: [], total: 0 }), BOX);

        expect(layout.bars).toEqual([]);
        expect(layout.markers).toEqual([]);
        expect(Number.isFinite(layout.lowMs)).toBe(true);
        expect(Number.isFinite(layout.highMs)).toBe(true);
    });

    it('размечает ось по границам корзин', () => {
        const layout = layoutHistogram(histogram(), { ...BOX, ticks: 2 });

        expect(layout.ticks.map((tick) => tick.value)).toEqual([1, 2.5, 4]);
        expect(layout.ticks.map((tick) => tick.x)).toEqual([0, 50, 100]);
    });

    it('не повторяет засечки, когда их просят больше, чем корзин', () => {
        const layout = layoutHistogram(histogram(), { ...BOX, ticks: 40 });
        const indexes = layout.ticks.map((tick) => tick.index);

        expect(new Set(indexes).size).toBe(indexes.length);
        expect(indexes[indexes.length - 1]).toBe(4);
    });

    it('берёт размер по умолчанию и отвергает неположительный', () => {
        expect(layoutHistogram(histogram())).toMatchObject({
            width: HISTOGRAM_WIDTH,
            height: HISTOGRAM_HEIGHT,
        });
        expect(layoutHistogram(histogram(), { width: 0, height: -4 })).toMatchObject({
            width: HISTOGRAM_WIDTH,
            height: HISTOGRAM_HEIGHT,
        });
    });

    it('держит столбцы внутри рамки на предельном числе корзин', () => {
        const counts = Array.from({ length: 200 }, (_, index) => index);
        const edges = Array.from({ length: 201 }, (_, index) => index);
        const layout = layoutHistogram(histogram({ counts, edges, total: 19900 }), BOX);

        for (const bar of layout.bars) {
            expect(bar.x).toBeGreaterThanOrEqual(0);
            expect(bar.x + bar.width).toBeLessThanOrEqual(BOX.width + 0.01);
            expect(bar.y).toBeGreaterThanOrEqual(0);
            expect(bar.y + bar.height).toBeLessThanOrEqual(BOX.height + 0.01);
        }
    });
});
