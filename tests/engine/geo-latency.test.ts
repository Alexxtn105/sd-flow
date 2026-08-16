import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 4000;

function twoRegions(clientGeo: string, routingPolicy = 'geo'): SchemeSpec {
    return {
        nodes: [
            {
                id: 'client',
                type: 'client-web',
                params: { geoDistribution: clientGeo, networkRttMs: 20 },
            },
            { id: 'router', type: 'glb', params: { routingPolicy, geoMapping: 'continent' } },
            {
                id: 'region-eu',
                type: 'region',
                params: { code: 'eu-west-1', geo: 'europe', isPrimary: true },
                size: { width: 400, height: 260 },
            },
            {
                id: 'region-us',
                type: 'region',
                params: { code: 'us-east-1', geo: 'north-america' },
                size: { width: 400, height: 260 },
            },
            { id: 'svc-eu', type: 'service', parentId: 'region-eu', params: { serviceTimeMs: 5 } },
            { id: 'svc-us', type: 'service', parentId: 'region-us', params: { serviceTimeMs: 60 } },
            { id: 'policy', type: 'multi-region-policy', params: { mode: 'active-active' } },
        ],
        links: [
            { from: 'client', to: 'router' },
            { from: 'router', to: 'svc-eu' },
            { from: 'router', to: 'svc-us' },
        ],
    };
}

describe('свёртка задержек следует маршрутизации', () => {
    it('клиент считает задержку того региона, который его обслуживает', () => {
        const europe = simulate(buildScheme(twoRegions('europe')), { sampleCount: SAMPLES });
        const america = simulate(buildScheme(twoRegions('north-america')), { sampleCount: SAMPLES });

        expect(europe.nodes['svc-eu'].throughput).toBeGreaterThan(0);
        expect(europe.nodes['svc-us'].throughput).toBe(0);
        expect(america.nodes['svc-eu'].throughput).toBe(0);
        expect(america.nodes['svc-us'].throughput).toBeGreaterThan(0);

        expect(america.flows[0].latency.p50 - europe.flows[0].latency.p50).toBeGreaterThan(30);
    });

    it('водопад показывает долю трафика ветви по потоку, а не по весам', () => {
        const result = simulate(buildScheme(twoRegions('europe')), { sampleCount: SAMPLES });
        const hops = result.waterfalls[0].hops;
        const toEurope = hops.find((hop) => hop.nodeId === 'svc-eu');
        const toAmerica = hops.find((hop) => hop.nodeId === 'svc-us');

        expect(toEurope?.trafficShare).toBeCloseTo(1, 6);
        expect(toAmerica?.trafficShare ?? 0).toBeCloseTo(0, 6);
    });
});

describe('перелёт в дальний регион стоит времени', () => {
    it('ветвь к дальнему региону становится cross-region и получает крюк', () => {
        const result = simulate(buildScheme(twoRegions('europe', 'weighted')), { sampleCount: SAMPLES });
        const toEurope = result.edges['edge-1'];
        const toAmerica = result.edges['edge-2'];

        expect(toEurope.scope).toBe('same-az');
        expect(toAmerica.scope).toBe('cross-region');
        expect(toAmerica.networkMs).toBeGreaterThan(50);
    });

    it('локальная маршрутизация крюка не платит', () => {
        const result = simulate(buildScheme(twoRegions('europe')), { sampleCount: SAMPLES });

        expect(result.edges['edge-1'].scope).toBe('same-az');
        expect(result.edges['edge-1'].networkMs).toBeLessThan(1);
    });

    it('при отказе региона уцелевшая ветвь платит за океан', () => {
        const scheme = buildScheme(twoRegions('europe'));
        const failure = simulate(scheme, { sampleCount: SAMPLES, scenario: 'region-failure' });
        const baseline = simulate(scheme, { sampleCount: SAMPLES, scenario: 'baseline' });

        const survivor = Object.values(failure.edges).find((edge) => edge.rps > 0 && edge.scope !== 'internet');

        expect(survivor?.scope).toBe('cross-region');
        expect(survivor?.networkMs).toBeGreaterThan(50);
        expect(failure.flows[0].latency.p50).toBeGreaterThan(baseline.flows[0].latency.p50);
    });
});
