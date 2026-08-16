import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import type { ProbeReading, SimResult } from '../../src/engine/sim/types';
import type { LinkSpec, NodeSpec } from '../helpers/scheme';
import { buildScheme } from '../helpers/scheme';

let result: SimResult;
let plain: SimResult;

beforeAll(() => {
    registry.reset();
    initComponents();
    result = instrumented();
    plain = bare();
});

const SAMPLES = 4000;

const BASE_NODES: NodeSpec[] = [
    { id: 'client', type: 'client-web' },
    { id: 'lb', type: 'lb-l7' },
    { id: 'svc', type: 'service' },
    { id: 'cache', type: 'redis' },
    { id: 'db', type: 'postgres' },
    { id: 'bus', type: 'kafka' },
    { id: 'worker', type: 'worker' },
];

const BASE_LINKS: LinkSpec[] = [
    { from: 'client', to: 'lb' },
    { from: 'lb', to: 'svc' },
    { from: 'svc', to: 'cache' },
    { from: 'svc', to: 'db' },
    { from: 'svc', to: 'bus' },
    { from: 'bus', to: 'worker' },
];

const PROBE_NODES: NodeSpec[] = [
    { id: 'p-rps', type: 'probe-rps' },
    { id: 'p-latency', type: 'probe-latency' },
    { id: 'p-utilization', type: 'probe-utilization' },
    { id: 'p-queue', type: 'probe-queue' },
    { id: 'p-storage', type: 'probe-storage' },
    { id: 'p-cost', type: 'probe-cost' },
    { id: 'p-slo', type: 'probe-slo' },
    { id: 'p-availability', type: 'probe-availability' },
    { id: 'p-traffic', type: 'probe-traffic-inspector' },
    { id: 'p-heatmap', type: 'probe-heatmap' },
    { id: 'p-waterfall', type: 'probe-waterfall' },
    { id: 'p-misplaced', type: 'probe-storage' },
    { id: 'p-orphan', type: 'probe-rps' },
];

const PROBE_LINKS: LinkSpec[] = [
    { from: 'svc', to: 'p-rps' },
    { from: 'svc', to: 'p-latency' },
    { from: 'svc', to: 'p-utilization' },
    { from: 'bus', to: 'p-queue' },
    { from: 'db', to: 'p-storage' },
    { from: 'svc', to: 'p-cost' },
    { from: 'svc', to: 'p-slo' },
    { from: 'lb', to: 'p-availability' },
    { from: 'svc', to: 'p-traffic' },
    { from: 'svc', to: 'p-heatmap' },
    { from: 'svc', to: 'p-waterfall' },
    { from: 'svc', to: 'p-misplaced' },
];

function instrumented(): SimResult {
    return simulate(
        buildScheme({ nodes: [...BASE_NODES, ...PROBE_NODES], links: [...BASE_LINKS, ...PROBE_LINKS] }),
        { sampleCount: SAMPLES },
    );
}

function bare(): SimResult {
    return simulate(buildScheme({ nodes: BASE_NODES, links: BASE_LINKS }), { sampleCount: SAMPLES });
}

function probeOf(result: SimResult, id: string): ProbeReading {
    const reading = result.probes[id];
    if (!reading) throw new Error(`Нет показания пробы ${id}`);
    return reading;
}

describe('измерители', () => {
    it('снимает показание с каждой прикреплённой пробы', () => {
        const measured = [
            'p-rps',
            'p-latency',
            'p-utilization',
            'p-queue',
            'p-storage',
            'p-cost',
            'p-slo',
            'p-availability',
            'p-traffic',
            'p-heatmap',
            'p-waterfall',
        ];

        for (const id of measured) {
            const reading = probeOf(result, id);
            expect(reading.status, `${id}: статус`).not.toBe('no-data');
            expect(Number.isFinite(reading.value), `${id}: значение ${reading.value}`).toBe(true);
            expect(reading.unit, `${id}: единица`).not.toBe('none');
            expect(reading.explain.formula.length, `${id}: формула`).toBeGreaterThan(0);
            expect(Object.keys(reading.explain.inputs).length, `${id}: подставленные значения`).toBeGreaterThan(0);
        }
    });

    it('RPS-метр показывает пропускную способность точки', () => {
        const reading = probeOf(result, 'p-rps');
        expect(reading.unit).toBe('rps');
        expect(reading.value).toBeCloseTo(result.nodes.svc.throughput, 6);
        expect(reading.targetNodeId).toBe('svc');
    });

    it('датчик утилизации сравнивает ρ со своими порогами', () => {
        const reading = probeOf(result, 'p-utilization');
        expect(reading.unit).toBe('percent');
        expect(reading.value).toBeCloseTo(result.nodes.svc.utilization * 100, 6);

        const warn = Number(reading.explain.inputs.warnThreshold);
        const alarm = Number(reading.explain.inputs.alarmThreshold);
        const expected =
            result.nodes.svc.utilization >= alarm ? 'breach' : result.nodes.svc.utilization >= warn ? 'warn' : 'ok';
        expect(reading.status).toBe(expected);
    });

    it('проекция хранилища растёт вместе с горизонтом', () => {
        const reading = probeOf(result, 'p-storage');
        expect(reading.unit).toBe('gb');
        expect(reading.value).toBeGreaterThan(0);
        expect(Number(reading.explain.inputs.horizonYears)).toBe(3);
    });

    it('счётчик стоимости суммирует поддерево, а не один блок', () => {
        const reading = probeOf(result, 'p-cost');
        expect(reading.unit).toBe('usdMonth');
        expect(reading.value).toBeGreaterThan(result.nodes.svc.cost.total);
        expect(Number(reading.explain.inputs.blocks)).toBeGreaterThan(1);
    });

    it('индикатор доступности перемножает девятки по поддереву', () => {
        const reading = probeOf(result, 'p-availability');
        expect(reading.unit).toBe('percent');
        expect(reading.value).toBeGreaterThan(0);
        expect(reading.value).toBeLessThanOrEqual(100);
        expect(Number(reading.explain.inputs.nines)).toBeGreaterThan(1);
    });

    it('SLO-индикатор привязан к потоку, проходящему через точку', () => {
        const reading = probeOf(result, 'p-slo');
        expect(reading.flowId).toBe('client');
        expect(reading.value).toBeCloseTo(result.flows[0].latency.p99, 6);
    });

    it('водопад открывает поток своей точки крепления', () => {
        const reading = probeOf(result, 'p-waterfall');
        expect(reading.flowId).toBe('client');
        expect(Number(reading.explain.inputs.hops)).toBeGreaterThan(0);
    });

    it('проба без привязки сообщает «нет данных», а не ноль', () => {
        const reading = probeOf(result, 'p-orphan');
        expect(reading.status).toBe('no-data');
        expect(reading.reason).toBe('unattached');
        expect(reading.value).toBeNaN();
    });

    it('проба на неподходящем блоке сообщает «нет данных», а не ноль', () => {
        const reading = probeOf(result, 'p-misplaced');
        expect(reading.targetNodeId).toBe('svc');
        expect(reading.status).toBe('no-data');
        expect(reading.reason).toBe('unsupported-target');
        expect(reading.value).toBeNaN();
    });

    it('не меняет расчёт схемы', () => {
        expect(result.seed).toBe(plain.seed);
        expect(result.flows[0].latency.p99).toBe(plain.flows[0].latency.p99);
        expect(result.totals.costMonth).toBe(plain.totals.costMonth);
        expect(result.totals.networkGbps).toBe(plain.totals.networkGbps);
        expect(result.totals.egressGbDay).toBe(plain.totals.egressGbDay);
    });
});

describe('водопад задержки', () => {
    it('раскладывает поток по хопам в порядке обхода', () => {
        const waterfall = plain.waterfalls[0];
        expect(plain.waterfalls).toHaveLength(plain.flows.length);
        expect(waterfall.flowId).toBe(plain.flows[0].id);
        expect(waterfall.hops.length).toBeGreaterThan(1);

        for (const hop of waterfall.hops) {
            expect(['sequential', 'parallel']).toContain(hop.arm);
            expect(hop.visitsPerRequest).toBeGreaterThan(0);
            expect(hop.p99Ms).toBeGreaterThanOrEqual(0);
        }
    });

    it('сумма вкладов хопов сходится с p99 потока', () => {
        const waterfall = plain.waterfalls[0];
        const total = plain.flows[0].latency.p99;
        expect(waterfall.covered.p99).toBeGreaterThan(0);
        expect(Math.abs(waterfall.covered.p99 - total) / total).toBeLessThan(0.1);
    });

    it('сумма вкладов хопов сходится с p50 и p95 потока', () => {
        const waterfall = plain.waterfalls[0];
        for (const percentile of ['p50', 'p95'] as const) {
            const total = plain.flows[0].latency[percentile];
            const covered = waterfall.covered[percentile];
            expect(Math.abs(covered - total) / total, percentile).toBeLessThan(0.1);
        }
    });

    it('помечает долю промахов кэша на кэшируемом хопе', () => {
        const waterfall = plain.waterfalls[0];
        const toDatabase = waterfall.hops.find((hop) => hop.nodeId === 'db');
        expect(toDatabase).toBeDefined();
        expect(toDatabase!.cacheMissShare).not.toBeNull();
        expect(toDatabase!.cacheMissShare!).toBeGreaterThan(0);
        expect(toDatabase!.cacheMissShare!).toBeLessThanOrEqual(1);

        const toCache = waterfall.hops.find((hop) => hop.nodeId === 'cache');
        expect(toCache?.cacheMissShare).toBeNull();
    });

    it('показывает расхождение обхода с делением трафика по весам', () => {
        const balanced = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web' },
                    { id: 'lb', type: 'lb-l7' },
                    { id: 'left', type: 'service' },
                    { id: 'right', type: 'service' },
                ],
                links: [
                    { from: 'client', to: 'lb' },
                    { from: 'lb', to: 'left' },
                    { from: 'lb', to: 'right' },
                ],
            }),
            { sampleCount: SAMPLES },
        );

        const arms = balanced.waterfalls[0].hops.filter((hop) => hop.parentNodeId === 'lb');
        expect(arms).toHaveLength(2);
        for (const arm of arms) {
            expect(arm.trafficShare).toBeCloseTo(0.5, 6);
            expect(arm.arm).toBe('sequential');
        }
    });
});
