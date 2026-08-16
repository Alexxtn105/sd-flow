import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { azSurvivalShare } from '../../src/engine/sim/scenarios';
import { compileTopology } from '../../src/engine/sim/compile';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 2000;

function insideAz(): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'az-a', type: 'az', size: { width: 400, height: 260 } },
            { id: 'api', type: 'service', parentId: 'az-a' },
            { id: 'db', type: 'postgres', parentId: 'az-a' },
        ],
        links: [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'db' },
        ],
    };
}

describe('выключенный узел', () => {
    const run = (scenario: string) => simulate(buildScheme(insideAz()), { sampleCount: SAMPLES, scenario });

    it('теряет трафик как ошибки, а не молча', () => {
        const baseline = run('baseline');
        const failure = run('az-failure');

        expect(failure.nodes.api.throughput).toBe(0);
        expect(failure.nodes.api.errorRate).toBe(1);
        expect(baseline.nodes.api.errorRate).toBe(0);
    });

    it('даёт находку, переведённую на оба языка', () => {
        const failure = run('az-failure');
        const finding = failure.findings.find((item) => item.code === 'node-down');

        expect(finding).toBeDefined();
        expect(finding?.severity).toBe('error');
        expect(finding?.nodeIds).toEqual(['api']);
        expect(ruCommon.findings).toHaveProperty('node-down');
        expect(enCommon.findings).toHaveProperty('node-down');
    });

    it('не улучшает задержку', () => {
        expect(run('az-failure').flows[0].latency.p99).toBeGreaterThanOrEqual(
            run('baseline').flows[0].latency.p99,
        );
    });

    it('не стирает накопленные данные и не обнуляет счёт', () => {
        const baseline = run('baseline');
        const failure = run('az-failure');

        expect(failure.totals.storageGb).toBeCloseTo(baseline.totals.storageGb, 6);
        expect(failure.totals.costMonth).toBeGreaterThan(baseline.totals.costMonth * 0.9);
    });
});

describe('az-failure без блока зоны', () => {
    function spread(instances: number, azSpread?: number): number {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                {
                    id: 'api',
                    type: 'service',
                    params: { instances, autoscale: false, ...(azSpread === undefined ? {} : { azSpread }) },
                },
            ],
            links: [{ from: 'client', to: 'api' }],
        });

        const node = compileTopology(scheme).nodeById.get('api');

        return azSurvivalShare(node!);
    }

    it('снимает долю мощности по числу зон', () => {
        expect(spread(9)).toBeCloseTo(2 / 3, 6);
        expect(spread(9, 2)).toBeCloseTo(1 / 2, 6);
        expect(spread(2)).toBeCloseTo(1 / 2, 6);
        expect(spread(1)).toBe(0);
    });

    it('нагружает уцелевшие зоны сильнее, чем baseline', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'api', type: 'service', params: { instances: 6, autoscale: false } },
            ],
            links: [{ from: 'client', to: 'api' }],
        });

        const baseline = simulate(scheme, { sampleCount: SAMPLES, scenario: 'baseline' });
        const failure = simulate(scheme, { sampleCount: SAMPLES, scenario: 'az-failure' });

        expect(failure.nodes.api.utilization).toBeCloseTo(baseline.nodes.api.utilization * 1.5, 6);
    });

    it('одиночный инстанс падает вместе со своей зоной', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'api', type: 'service', params: { instances: 1, autoscale: false } },
            ],
            links: [{ from: 'client', to: 'api' }],
        });

        const failure = simulate(scheme, { sampleCount: SAMPLES, scenario: 'az-failure' });

        expect(failure.nodes.api.throughput).toBe(0);
        expect(failure.findings.some((finding) => finding.code === 'node-down')).toBe(true);
    });
});
