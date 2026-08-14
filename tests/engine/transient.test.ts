import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { SCENARIOS, TRANSIENT_SCENARIOS } from '../../src/engine/sim/scenarios';
import type { SimResult, Timeline } from '../../src/engine/sim/types';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 500;

function queueScheme(): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { dau: 43200, requestsPerSession: 40 } },
            { id: 'api', type: 'service', params: { autoscale: false, instances: 4 } },
            { id: 'bus', type: 'kafka', params: { partitions: 12 } },
            {
                id: 'worker',
                type: 'worker',
                params: { instances: 5, concurrency: 4, processingTimeMs: 100, autoscale: false },
            },
        ],
        links: [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'bus' },
            { from: 'bus', to: 'worker' },
        ],
    };
}

function autoscaleScheme(scaleUpLagSec: number): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { dau: 43200, requestsPerSession: 40 } },
            {
                id: 'api',
                type: 'service',
                params: {
                    instances: 2,
                    autoscale: true,
                    autoscaleMax: 40,
                    serviceTimeMs: 50,
                    cpuShare: 0.5,
                    cpuCores: 2,
                    concurrencyPerInstance: 20,
                    scaleUpLagSec,
                },
            },
        ],
        links: [{ from: 'client', to: 'api' }],
    };
}

function timelineOf(result: SimResult): Timeline {
    expect(result.timeline).not.toBeNull();
    return result.timeline as Timeline;
}

function seriesOf(timeline: Timeline, nodeId: string, pick: (sample: Timeline['samples'][number]) => number) {
    return timeline.samples.map((sample) => ({ timeSec: sample.timeSec, value: pick(sample), nodeId }));
}

describe('transient-прогон', () => {
    it('детерминирован по seed', () => {
        const scheme = buildScheme(queueScheme());

        const first = timelineOf(simulate(scheme, { sampleCount: SAMPLES, scenario: 'spike' }));
        const second = timelineOf(simulate(scheme, { sampleCount: SAMPLES, scenario: 'spike' }));

        expect(second.samples).toEqual(first.samples);
        expect(second.peakBacklog).toBe(first.peakBacklog);
    });

    it('меняет ряд вместе с seed схемы', () => {
        const scheme = buildScheme(queueScheme());
        const reseeded = buildScheme({ ...queueScheme(), settings: { seed: 42 } });

        const base = timelineOf(simulate(scheme, { sampleCount: SAMPLES, scenario: 'spike' }));
        const other = timelineOf(simulate(reseeded, { sampleCount: SAMPLES, scenario: 'spike' }));

        expect(other.samples).not.toEqual(base.samples);
    });

    it('на spike очередь растёт и рассасывается не мгновенно', () => {
        const result = simulate(buildScheme(queueScheme()), { sampleCount: SAMPLES, scenario: 'spike' });
        const timeline = timelineOf(result);

        const backlog = timeline.samples.map((sample) => sample.nodes.worker.backlog);
        const peakIndex = backlog.indexOf(Math.max(...backlog));

        expect(Math.max(...backlog)).toBeGreaterThan(0);

        const draining = timeline.samples.filter(
            (sample, index) => index > peakIndex && sample.nodes.worker.backlog > 0,
        );

        expect(draining.length).toBeGreaterThanOrEqual(3);
        expect(backlog[backlog.length - 1]).toBeLessThan(Math.max(...backlog) * 0.05);
        expect(timeline.recoveredAtSec).not.toBeNull();
    });

    it('лаг автоскейлинга роняет SLO там, где мгновенный автоскейлинг держит', () => {
        const instant = simulate(buildScheme(autoscaleScheme(0)), {
            sampleCount: SAMPLES,
            scenario: 'spike',
        });
        const lagged = simulate(buildScheme(autoscaleScheme(240)), {
            sampleCount: SAMPLES,
            scenario: 'spike',
        });

        const fast = timelineOf(instant);
        const slow = timelineOf(lagged);

        const peakUtilisation = (timeline: Timeline) =>
            Math.max(...timeline.samples.map((sample) => sample.nodes.api.utilization));
        const peakErrors = (timeline: Timeline) =>
            Math.max(...timeline.samples.map((sample) => sample.nodes.api.errorRate));

        expect(peakUtilisation(slow)).toBeGreaterThan(peakUtilisation(fast));
        expect(peakErrors(slow)).toBeGreaterThan(peakErrors(fast));
        expect(peakUtilisation(fast)).toBeLessThan(1);
        expect(slow.breachFromSec).not.toBeNull();
        expect(fast.breachFromSec).toBeNull();
    });

    it('инстансы догоняют спрос постепенно, а не мгновенно', () => {
        const result = simulate(buildScheme(autoscaleScheme(240)), {
            sampleCount: SAMPLES,
            scenario: 'spike',
        });
        const timeline = timelineOf(result);

        const climbing = timeline.samples.filter(
            (sample) => sample.nodes.api.instances < sample.nodes.api.desiredInstances,
        );

        expect(climbing.length).toBeGreaterThan(3);
        expect(seriesOf(timeline, 'api', (sample) => sample.nodes.api.instances).length).toBe(
            timeline.samples.length,
        );
    });

    it('после cache-flush hit ratio восстанавливается постепенно', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 2000000 } },
                { id: 'api', type: 'service' },
                { id: 'cache', type: 'redis', params: { shards: 4 } },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'cache' },
                { from: 'api', to: 'db' },
            ],
        });

        const timeline = timelineOf(simulate(scheme, { sampleCount: SAMPLES, scenario: 'cache-flush' }));
        const hits = timeline.samples.map((sample) => sample.nodes.cache.hitRatio ?? 0);

        expect(hits[0]).toBe(0);
        expect(hits[hits.length - 1]).toBeGreaterThan(hits[1]);
        expect(hits.filter((value) => value > 0 && value < hits[hits.length - 1]).length).toBeGreaterThan(2);
    });

    it('db-failover выбивает хранилище на время переключения и возвращает его', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000 } },
                { id: 'api', type: 'service' },
                { id: 'db', type: 'postgres', params: { failoverSec: 45 } },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'db' },
            ],
        });

        const timeline = timelineOf(simulate(scheme, { sampleCount: SAMPLES, scenario: 'db-failover' }));
        const down = timeline.samples.filter((sample) => sample.nodes.db.capacity === 0);

        expect(down.length).toBeGreaterThan(3);
        expect(timeline.samples[0].nodes.db.capacity).toBeGreaterThan(0);
        expect(timeline.samples[timeline.samples.length - 1].nodes.db.capacity).toBeGreaterThan(0);
        expect(timeline.breachFromSec).not.toBeNull();
    });
});

describe('каталог сценариев', () => {
    it('переведён на оба языка', () => {
        for (const scenario of SCENARIOS) {
            expect(ruCommon.scenario).toHaveProperty(scenario);
            expect(enCommon.scenario).toHaveProperty(scenario);
        }

        for (const metric of Object.keys(ruCommon.timeline.metric)) {
            expect(enCommon.timeline.metric).toHaveProperty(metric);
        }
    });

    it('стационарные сценарии не получают таймлайн, transient — получают', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000 } },
                { id: 'api', type: 'service' },
                { id: 'cache', type: 'redis', params: { shards: 4 } },
                { id: 'db', type: 'postgres' },
                { id: 'psp', type: 'payment-external' },
                { id: 'bus', type: 'kafka' },
                { id: 'worker', type: 'worker' },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'cache' },
                { from: 'api', to: 'db' },
                { from: 'api', to: 'psp', calls: { fanout: 0.1 } },
                { from: 'api', to: 'bus' },
                { from: 'bus', to: 'worker' },
            ],
        });

        for (const scenario of SCENARIOS) {
            const result = simulate(scheme, { sampleCount: SAMPLES, scenario });
            const expected = TRANSIENT_SCENARIOS.includes(scenario);

            expect(result.timeline !== null).toBe(expected);
        }
    });
});

describe('исправленные расхождения модели', () => {
    function twoRegions(): SchemeSpec {
        return {
            nodes: [
                { id: 'region-eu', type: 'region', params: { code: 'eu-west-1', geo: 'europe' } },
                { id: 'region-us', type: 'region', params: { code: 'us-east-1', geo: 'north-america' } },
                {
                    id: 'client-eu',
                    type: 'client-web',
                    parentId: 'region-eu',
                    params: { dau: 14400, requestsPerSession: 40 },
                },
                {
                    id: 'client-us',
                    type: 'client-web',
                    parentId: 'region-us',
                    params: { dau: 14400, requestsPerSession: 40 },
                },
                {
                    id: 'svc-eu',
                    type: 'service',
                    parentId: 'region-eu',
                    params: { autoscale: false, instances: 1, concurrencyPerInstance: 1 },
                },
                {
                    id: 'svc-us',
                    type: 'service',
                    parentId: 'region-us',
                    params: { autoscale: false, instances: 1, concurrencyPerInstance: 1 },
                },
            ],
            links: [
                { from: 'client-eu', to: 'svc-eu' },
                { from: 'client-us', to: 'svc-us' },
            ],
        };
    }

    it('region-failure перекладывает трафик, а не теряет его', () => {
        const scheme = buildScheme(twoRegions());

        const baseline = simulate(scheme, { sampleCount: SAMPLES, scenario: 'baseline' });
        const failure = simulate(scheme, { sampleCount: SAMPLES, scenario: 'region-failure' });

        expect(failure.totals.rps).toBeCloseTo(baseline.totals.rps, 6);
        expect(failure.nodes['svc-eu'].throughput).toBe(0);
        expect(failure.nodes['svc-us'].lambdaNominal).toBeCloseTo(
            baseline.nodes['svc-us'].lambdaNominal * 2,
            6,
        );
        expect(failure.nodes['svc-us'].utilization).toBeGreaterThan(baseline.nodes['svc-us'].utilization);
    });

    it('region-failure не улучшает latency относительно baseline', () => {
        const scheme = buildScheme(twoRegions());

        const baseline = simulate(scheme, { sampleCount: 4000, scenario: 'baseline' });
        const failure = simulate(scheme, { sampleCount: 4000, scenario: 'region-failure' });

        const survivor = (result: SimResult) => result.flows.find((flow) => flow.entryNodeId === 'client-us');

        expect(survivor(failure)!.latency.p99).toBeGreaterThanOrEqual(survivor(baseline)!.latency.p99);
    });

    it('кэш поглощает только чтения', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000 } },
                { id: 'api', type: 'service' },
                { id: 'cache', type: 'redis', params: { shards: 4 } },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'cache' },
                { from: 'api', to: 'db', readShare: 0.5 },
            ],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });
        const toDatabase = Object.values(result.edges).find((edge) => edge.edgeId === 'edge-2');
        const hitRatio = result.nodes.cache.hitRatio ?? 0;

        expect(hitRatio).toBeGreaterThan(0);
        expect(toDatabase!.byOperation.write).toBeCloseTo(result.nodes.api.throughput * 0.5, 6);
        expect(toDatabase!.byOperation.read).toBeCloseTo(result.nodes.api.throughput * 0.5 * (1 - hitRatio), 6);
    });
});
