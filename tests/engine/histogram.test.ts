import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import {
    buildLatencyHistogram,
    DEFAULT_HISTOGRAM_BUCKETS,
    MAX_HISTOGRAM_BUCKETS,
} from '../../src/engine/sim/latency';
import { simulate } from '../../src/engine/sim/simulate';
import type { LatencyHistogram, SimResult } from '../../src/engine/sim/types';
import type { LinkSpec, NodeSpec } from '../helpers/scheme';
import { buildScheme } from '../helpers/scheme';

const SAMPLES = 2000;

const NODES: NodeSpec[] = [
    { id: 'client', type: 'client-web' },
    { id: 'lb', type: 'lb-l7' },
    { id: 'svc', type: 'service' },
    { id: 'db', type: 'postgres' },
    { id: 'p-default', type: 'probe-latency' },
    { id: 'p-linear', type: 'probe-latency', params: { buckets: 12, scale: 'linear' } },
    { id: 'p-huge', type: 'probe-latency', params: { buckets: 900, scale: 'log' } },
];

const LINKS: LinkSpec[] = [
    { from: 'client', to: 'lb' },
    { from: 'lb', to: 'svc' },
    { from: 'svc', to: 'db' },
    { from: 'svc', to: 'db' },
    { from: 'db', to: 'p-default' },
    { from: 'db', to: 'p-linear' },
    { from: 'db', to: 'p-huge' },
];

let result: SimResult;

beforeAll(() => {
    registry.reset();
    initComponents();
    result = simulate(buildScheme({ nodes: NODES, links: LINKS }), { sampleCount: SAMPLES });
});

function histogramOf(probeId: string): LatencyHistogram {
    const histogram = result.probes[probeId]?.histogram;
    if (!histogram) throw new Error(`Нет гистограммы у пробы ${probeId}`);
    return histogram;
}

function total(counts: number[]): number {
    return counts.reduce((sum, count) => sum + count, 0);
}

describe('корзины гистограммы задержки', () => {
    it('режет линейную шкалу на равные корзины от минимума до максимума', () => {
        const histogram = buildLatencyHistogram([1, 2, 3, 4], { buckets: 4, scale: 'linear' });

        expect(histogram.scale).toBe('linear');
        expect(histogram.edges).toEqual([1, 1.75, 2.5, 3.25, 4]);
        expect(histogram.counts).toEqual([1, 1, 1, 1]);
        expect(histogram.total).toBe(4);
    });

    it('режет логарифмическую шкалу на равные декады', () => {
        const histogram = buildLatencyHistogram([1, 10, 100], { buckets: 2, scale: 'log' });

        expect(histogram.scale).toBe('log');
        expect(histogram.edges[0]).toBe(1);
        expect(histogram.edges[1]).toBeCloseTo(10, 10);
        expect(histogram.edges[2]).toBe(100);
        expect(histogram.counts).toEqual([1, 2]);
    });

    it('на логарифмической шкале не выбрасывает нули, а складывает их в первую корзину', () => {
        const histogram = buildLatencyHistogram([0, 0, 1, 10], { buckets: 2, scale: 'log' });

        expect(histogram.scale).toBe('log');
        expect(histogram.zeroCount).toBe(2);
        expect(histogram.edges[0]).toBe(1);
        expect(histogram.counts).toEqual([3, 1]);
        expect(total(histogram.counts)).toBe(histogram.total);
    });

    it('без единого положительного сэмпла честно переключается на линейную шкалу', () => {
        const histogram = buildLatencyHistogram([0, 0, 0], { buckets: 4, scale: 'log' });

        expect(histogram.scale).toBe('linear');
        expect(histogram.zeroCount).toBe(3);
        expect(total(histogram.counts)).toBe(3);
        expect(histogram.edges.every((edge) => Number.isFinite(edge))).toBe(true);
    });

    it('на одинаковых сэмплах раздвигает область, а не делит на ноль', () => {
        const linear = buildLatencyHistogram([5, 5, 5], { buckets: 4, scale: 'linear' });
        const log = buildLatencyHistogram([5, 5, 5], { buckets: 4, scale: 'log' });

        expect(linear.edges[0]).toBe(5);
        expect(linear.edges[4]).toBe(6);
        expect(linear.counts).toEqual([3, 0, 0, 0]);
        expect(log.edges[0]).toBe(5);
        expect(log.edges[4]).toBeCloseTo(50, 10);
        expect(log.counts).toEqual([3, 0, 0, 0]);
    });

    it('никогда не теряет сэмплы: сумма корзин равна числу измерений', () => {
        const values = Array.from({ length: 500 }, (_, index) => (index % 7) * 0.5);

        for (const scale of ['linear', 'log'] as const) {
            const histogram = buildLatencyHistogram(values, { buckets: 40, scale });
            expect(total(histogram.counts), scale).toBe(500);
            expect(histogram.total, scale).toBe(500);
        }
    });

    it('выбрасывает нечисловые отсчёты из расчёта', () => {
        const histogram = buildLatencyHistogram([1, Number.NaN, 3, Number.POSITIVE_INFINITY], {
            buckets: 2,
            scale: 'linear',
        });

        expect(histogram.total).toBe(2);
        expect(total(histogram.counts)).toBe(2);
        expect(histogram.meanMs).toBe(2);
    });

    it('считает квантили по самим сэмплам, а не по корзинам', () => {
        const histogram = buildLatencyHistogram([1, 2, 3, 4], { buckets: 4, scale: 'linear' });

        expect(histogram.p50Ms).toBe(2.5);
        expect(histogram.p95Ms).toBeCloseTo(3.85, 10);
        expect(histogram.p99Ms).toBeCloseTo(3.97, 10);
        expect(histogram.meanMs).toBe(2.5);
    });

    it('ограничивает число корзин потолком и подменяет мусор значением по умолчанию', () => {
        expect(buildLatencyHistogram([1, 2], { buckets: 900, scale: 'linear' }).counts).toHaveLength(
            MAX_HISTOGRAM_BUCKETS,
        );
        expect(buildLatencyHistogram([1, 2], { buckets: Number.NaN, scale: 'linear' }).counts).toHaveLength(
            DEFAULT_HISTOGRAM_BUCKETS,
        );
        expect(buildLatencyHistogram([1, 2], { buckets: 0, scale: 'linear' }).counts).toHaveLength(1);
    });

    it('на пустом ряде отдаёт пустую, но пригодную к рисованию гистограмму', () => {
        const histogram = buildLatencyHistogram([], { buckets: 8, scale: 'log' });

        expect(histogram.total).toBe(0);
        expect(histogram.counts).toHaveLength(8);
        expect(total(histogram.counts)).toBe(0);
        expect(histogram.edges).toHaveLength(9);
        expect(histogram.edges.every((edge) => Number.isFinite(edge))).toBe(true);
        expect(histogram.meanMs).toBe(0);
    });
});

describe('гистограмма пробы задержки', () => {
    it('снимает распределение по всем сэмплам Monte-Carlo', () => {
        const histogram = histogramOf('p-default');

        expect(histogram.total).toBe(SAMPLES);
        expect(total(histogram.counts)).toBe(SAMPLES);
        expect(histogram.counts).toHaveLength(DEFAULT_HISTOGRAM_BUCKETS);
        expect(histogram.p50Ms).toBeLessThanOrEqual(histogram.p95Ms);
        expect(histogram.p95Ms).toBeLessThanOrEqual(histogram.p99Ms);
    });

    it('складывает поэлементно все обращения к блоку, а не берёт одно', () => {
        const reading = result.probes['p-default'];
        const waterfall = result.waterfalls.find((item) => item.flowId === reading.flowId);
        const hops = waterfall?.hops.filter((hop) => hop.nodeId === 'db') ?? [];

        expect(hops).toHaveLength(2);
        expect(histogramOf('p-default').meanMs).toBeCloseTo(
            hops.reduce((sum, hop) => sum + hop.meanMs, 0),
            6,
        );
    });

    it('параметры buckets и scale правят разбиение, а не лежат мёртвым грузом', () => {
        const linear = histogramOf('p-linear');
        const log = histogramOf('p-default');

        expect(linear.scale).toBe('linear');
        expect(linear.counts).toHaveLength(12);
        expect(linear.edges).toHaveLength(13);
        expect(log.scale).toBe('log');
        expect(log.edges[0]).toBeLessThan(log.edges[1]);
        expect(linear.edges).not.toEqual(log.edges.slice(0, 13));
    });

    it('обрезает запрошенное число корзин потолком', () => {
        expect(histogramOf('p-huge').counts).toHaveLength(MAX_HISTOGRAM_BUCKETS);
    });

    it('везёт в результат счётчики, а не сами сэмплы', () => {
        const histogram = histogramOf('p-default');
        const payload = JSON.parse(JSON.stringify(histogram)) as LatencyHistogram;

        expect(payload.counts).toEqual(histogram.counts);
        expect(JSON.stringify(histogram).length).toBeLessThan(SAMPLES);
    });
});
