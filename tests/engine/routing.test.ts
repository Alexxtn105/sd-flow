import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { GEO_ZONES } from '../../src/engine/sim/constants';
import { zoneShares } from '../../src/engine/sim/flows';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { ComponentParams } from '../../src/engine/types/component';
import type { NodeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 300;

interface TwoRegionOptions {
    routingPolicy?: string;
    geoMapping?: string;
    clientGeo?: string;
    clientSpread?: number;
    clientMix?: number;
    policy?: ComponentParams | null;
}

function twoRegions(options: TwoRegionOptions = {}) {
    const policy: NodeSpec[] = options.policy
        ? [{ id: 'mrp', type: 'multi-region-policy', params: options.policy }]
        : [];

    return buildScheme({
        nodes: [
            {
                id: 'client',
                type: 'client-web',
                params: {
                    geoDistribution: options.clientGeo ?? 'europe',
                    ...(options.clientSpread === undefined ? {} : { geoSpread: options.clientSpread }),
                    ...(options.clientMix === undefined ? {} : { readWriteMix: options.clientMix }),
                },
            },
            {
                id: 'glb',
                type: 'glb',
                params: {
                    routingPolicy: options.routingPolicy ?? 'latency',
                    ...(options.geoMapping ? { geoMapping: options.geoMapping } : {}),
                },
            },
            { id: 'eu', type: 'region', params: { code: 'eu-west-1', geo: 'europe', isPrimary: true } },
            { id: 'us', type: 'region', params: { code: 'us-east-1', geo: 'north-america', isPrimary: false } },
            { id: 'svc-eu', type: 'service', parentId: 'eu' },
            { id: 'svc-us', type: 'service', parentId: 'us' },
            ...policy,
        ],
        links: [
            { from: 'client', to: 'glb' },
            { from: 'glb', to: 'svc-eu' },
            { from: 'glb', to: 'svc-us' },
        ],
    });
}

function shares(result: ReturnType<typeof simulate>) {
    const eu = result.nodes['svc-eu'].lambdaNominal;
    const us = result.nodes['svc-us'].lambdaNominal;
    const total = eu + us;

    return { eu: total > 0 ? eu / total : 0, us: total > 0 ? us / total : 0, total };
}

describe('гео-маршрутизация', () => {
    it('политика latency отправляет европейцев в европейский регион', () => {
        const split = shares(simulate(twoRegions({ clientGeo: 'europe' }), { sampleCount: SAMPLES }));

        expect(split.eu).toBeCloseTo(1, 6);
        expect(split.us).toBeCloseTo(0, 6);
    });

    it('американцев тот же граф уводит в американский регион', () => {
        const split = shares(simulate(twoRegions({ clientGeo: 'north-america' }), { sampleCount: SAMPLES }));

        expect(split.us).toBeCloseTo(1, 6);
    });

    it('глобальная аудитория делится между регионами по близости', () => {
        const split = shares(simulate(twoRegions({ clientGeo: 'global' }), { sampleCount: SAMPLES }));

        expect(split.eu).toBeGreaterThan(0.2);
        expect(split.us).toBeGreaterThan(0.2);
        expect(split.eu + split.us).toBeCloseTo(1, 6);
    });

    it('политика weighted оставляет старое деление по весам рёбер', () => {
        const split = shares(
            simulate(twoRegions({ routingPolicy: 'weighted', clientGeo: 'europe' }), { sampleCount: SAMPLES }),
        );

        expect(split.eu).toBeCloseTo(0.5, 6);
        expect(split.us).toBeCloseTo(0.5, 6);
    });

    it('политика failover держит весь трафик в основном регионе', () => {
        const split = shares(
            simulate(twoRegions({ routingPolicy: 'failover', clientGeo: 'north-america' }), {
                sampleCount: SAMPLES,
            }),
        );

        expect(split.eu).toBeCloseTo(1, 6);
    });

    it('при отказе региона трафик переезжает в живой', () => {
        const result = simulate(twoRegions({ clientGeo: 'europe' }), {
            sampleCount: SAMPLES,
            scenario: 'region-failure',
        });

        expect(result.nodes['svc-us'].lambdaNominal).toBeGreaterThan(0);
    });
});

describe('режимы мультирегиона', () => {
    it('active-passive держит и чтения, и записи в активном регионе', () => {
        const result = simulate(
            twoRegions({
                clientGeo: 'north-america',
                policy: { mode: 'active-passive', writeRegion: 'eu-west-1' },
            }),
            { sampleCount: SAMPLES },
        );

        expect(shares(result).eu).toBeCloseTo(1, 6);
    });

    it('read-local-write-global читает рядом, а пишет в один регион', () => {
        const result = simulate(
            twoRegions({
                clientGeo: 'north-america',
                policy: { mode: 'read-local-write-global', writeRegion: 'eu-west-1' },
            }),
            { sampleCount: SAMPLES },
        );

        const eu = result.nodes['svc-eu'];
        const us = result.nodes['svc-us'];

        expect(us.throughput * us.readShare).toBeGreaterThan(0);
        expect(us.writeShare).toBeCloseTo(0, 6);
        expect(eu.readShare).toBeCloseTo(0, 6);
        expect(eu.throughput * eu.writeShare).toBeGreaterThan(0);
    });

    it('active-active пишет там же, где читает', () => {
        const result = simulate(
            twoRegions({ clientGeo: 'north-america', policy: { mode: 'active-active' } }),
            { sampleCount: SAMPLES },
        );

        const us = result.nodes['svc-us'];

        expect(us.throughput * us.writeShare).toBeGreaterThan(0);
        expect(result.nodes['svc-eu'].lambdaNominal).toBeCloseTo(0, 6);
    });
});

describe('распределение клиентов по географии', () => {
    it('доля вне основной зоны уводит часть трафика в дальний регион', () => {
        const home = shares(simulate(twoRegions({ clientGeo: 'europe' }), { sampleCount: SAMPLES }));
        const mixed = shares(
            simulate(twoRegions({ clientGeo: 'europe', clientSpread: 0.4 }), { sampleCount: SAMPLES }),
        );

        expect(home.us).toBeCloseTo(0, 6);
        expect(mixed.us).toBeGreaterThan(0.1);
        expect(mixed.eu).toBeGreaterThan(mixed.us);
        expect(mixed.total).toBeCloseTo(home.total, 3);
    });

    it('смесь зон складывается в единицу и слабеет с расстоянием', () => {
        const mix = zoneShares('europe', 0.5);
        const total = [...mix.values()].reduce((sum, share) => sum + share, 0);

        expect(total).toBeCloseTo(1, 9);
        expect(mix.get('europe')).toBeCloseTo(0.5, 9);
        expect(mix.get('north-america') ?? 0).toBeGreaterThan(mix.get('oceania') ?? 0);
        expect(mix.get('africa') ?? 0).toBeGreaterThan(mix.get('asia') ?? 0);
    });

    it('без доли вне зоны вся аудитория остаётся в объявленной зоне', () => {
        const mix = zoneShares('asia', 0);

        expect(mix.get('asia')).toBeCloseTo(1, 9);
        expect(mix.size).toBe(1);
    });

    it('global по-прежнему делится равными долями по шести зонам', () => {
        const mix = zoneShares('global', 0.7);

        expect(mix.size).toBe(GEO_ZONES.length);
        for (const zone of GEO_ZONES) expect(mix.get(zone)).toBeCloseTo(1 / GEO_ZONES.length, 9);
    });
});

describe('гео-шардирование ключей', () => {
    it('раскладывает трафик по домашним регионам ключей, а не по близости', () => {
        const split = shares(
            simulate(twoRegions({ clientGeo: 'europe', policy: { mode: 'sharded-by-geo' } }), {
                sampleCount: SAMPLES,
            }),
        );

        expect(split.eu).toBeCloseTo(0.5, 6);
        expect(split.us).toBeCloseTo(0.5, 6);
    });

    it('«чужой» ключ платит хоп в родной регион', () => {
        const local = simulate(twoRegions({ clientGeo: 'europe', policy: { mode: 'active-active' } }), {
            sampleCount: SAMPLES,
        });
        const homed = simulate(twoRegions({ clientGeo: 'europe', policy: { mode: 'sharded-by-geo' } }), {
            sampleCount: SAMPLES,
        });

        expect(homed.flows[0].latency.p50).toBeGreaterThan(local.flows[0].latency.p50 * 1.5);
    });
});

describe('ветка записи в свёртке задержек', () => {
    it('запись едет в регион записи и платит его RTT, а чтение остаётся рядом', () => {
        const policy = { mode: 'read-local-write-global', writeRegion: 'eu-west-1' };
        const reads = simulate(
            twoRegions({ clientGeo: 'north-america', clientMix: 1, policy }),
            { sampleCount: SAMPLES },
        );
        const writes = simulate(
            twoRegions({ clientGeo: 'north-america', clientMix: 0, policy }),
            { sampleCount: SAMPLES },
        );

        expect(writes.flows[0].latency.p50 - reads.flows[0].latency.p50).toBeGreaterThan(30);
        expect(writes.flows[0].latency.p99).toBeGreaterThan(reads.flows[0].latency.p99);
        expect(writes.nodes['svc-eu'].throughput).toBeGreaterThan(0);
        expect(reads.nodes['svc-us'].throughput).toBeGreaterThan(0);
    });
});
