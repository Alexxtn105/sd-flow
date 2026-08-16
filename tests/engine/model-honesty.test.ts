import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { lintArchitecture } from '../../src/engine/challenges/lint';
import { compileTopology } from '../../src/engine/sim/compile';
import { simulate } from '../../src/engine/sim/simulate';
import type { NodeContext } from '../../src/engine/types/component';
import type { SchemeV1 } from '../../src/engine/types/scheme';
import { buildScheme } from '../helpers/scheme';
import type { LinkSpec, NodeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 4000;

function lintOf(scheme: SchemeV1): string[] {
    const result = simulate(scheme, { sampleCount: 500 });
    const lint = lintArchitecture({ topology: compileTopology(scheme), result });

    return lint.antipatterns.map((hit) => hit.rule);
}

describe('веер вызовов в задержке', () => {
    function withFanout(fanout: number): SchemeV1 {
        return buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000 } },
                { id: 'svc', type: 'service', params: { serviceTimeMs: 5 } },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db', calls: { fanout } },
            ],
        });
    }

    it('десять вызовов на запрос стоят дороже одного', () => {
        const single = simulate(withFanout(1), { sampleCount: SAMPLES }).flows[0].latency;
        const many = simulate(withFanout(10), { sampleCount: SAMPLES }).flows[0].latency;

        expect(many.p50 - single.p50).toBeGreaterThan(5);
        expect(many.p99).toBeGreaterThan(single.p99);
    });

    it('дробный fanout вызывает downstream не на каждом запросе', () => {
        const always = simulate(withFanout(1), { sampleCount: SAMPLES });
        const half = simulate(withFanout(0.5), { sampleCount: SAMPLES });

        const shareOf = (result: ReturnType<typeof simulate>) =>
            result.waterfalls[0].hops.find((hop) => hop.nodeId === 'db')?.shareOfRequests ?? 0;

        expect(shareOf(always)).toBeCloseTo(1, 1);
        expect(shareOf(half)).toBeGreaterThan(0.4);
        expect(shareOf(half)).toBeLessThan(0.6);
    });
});

describe('балансировка против веера', () => {
    function withArms(count: number): SchemeV1 {
        const nodes: NodeSpec[] = [{ id: 'client', type: 'client-web', params: { dau: 200000 } }];
        const links: LinkSpec[] = [];

        for (let index = 0; index < count; index += 1) {
            nodes.push({ id: `svc-${index}`, type: 'service' });
            links.push({ from: 'client', to: `svc-${index}`, weight: 1 });
        }

        return buildScheme({ nodes, links });
    }

    it('запрос идёт в одно плечо балансировки, а не во все сразу', () => {
        const single = simulate(withArms(1), { sampleCount: SAMPLES }).flows[0].latency;
        const four = simulate(withArms(4), { sampleCount: SAMPLES }).flows[0].latency;

        expect(four.p50).toBeLessThan(single.p50 * 1.3);
        expect(four.p99).toBeLessThan(single.p99 * 1.5);
    });

    it('балансировщик не отправляет запросы в выключенный регион', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'clients', type: 'client-mobile', params: { dau: 1000000 } },
                { id: 'router', type: 'glb' },
                {
                    id: 'region-eu',
                    type: 'region',
                    params: { code: 'eu-west-1', geo: 'europe' },
                    size: { width: 400, height: 300 },
                },
                {
                    id: 'region-us',
                    type: 'region',
                    params: { code: 'us-east-1', geo: 'north-america', isPrimary: false },
                    size: { width: 400, height: 300 },
                },
                { id: 'svc-eu', type: 'service', parentId: 'region-eu' },
                { id: 'svc-us', type: 'service', parentId: 'region-us' },
            ],
            links: [
                { from: 'clients', to: 'router' },
                { from: 'router', to: 'svc-eu', weight: 1 },
                { from: 'router', to: 'svc-us', weight: 1 },
            ],
        });

        const failure = simulate(scheme, { sampleCount: SAMPLES, scenario: 'region-failure' });
        const dead = failure.waterfalls[0].hops.find((hop) => hop.nodeId === 'svc-eu');

        expect(failure.nodes['svc-eu'].throughput).toBe(0);
        expect(dead?.shareOfRequests ?? 0).toBe(0);
    });

    it('веер вызовов, наоборот, складывается', () => {
        const oneStore = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000 } },
                { id: 'svc', type: 'service', params: { serviceTimeMs: 5 } },
                { id: 'db-a', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db-a' },
            ],
        });

        const twoStores = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000 } },
                { id: 'svc', type: 'service', params: { serviceTimeMs: 5 } },
                { id: 'db-a', type: 'postgres' },
                { id: 'db-b', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db-a' },
                { from: 'svc', to: 'db-b' },
            ],
        });

        expect(simulate(twoStores, { sampleCount: SAMPLES }).flows[0].latency.p50).toBeGreaterThan(
            simulate(oneStore, { sampleCount: SAMPLES }).flows[0].latency.p50,
        );
    });
});

describe('egress платится там, где трафик покидает периметр', () => {
    it('наполнение CDN из origin стоит денег', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'viewers', type: 'client-web', params: { dau: 1000000 } },
                { id: 'cdn', type: 'cdn', params: { cacheHitRatio: 0.9, avgObjectKb: 500 } },
                { id: 'objects', type: 's3' },
            ],
            links: [
                { from: 'viewers', to: 'cdn', readShare: 1, calls: { requestBytes: 1000, responseBytes: 500000 } },
                { from: 'cdn', to: 'objects', readShare: 1, calls: { requestBytes: 1000, responseBytes: 500000 } },
            ],
        });

        const result = simulate(scheme, { sampleCount: 500 });

        expect(result.nodes.cdn.egressGbDay).toBeGreaterThan(0);
        expect(result.nodes.objects.egressGbDay).toBeGreaterThan(0);
        expect(result.nodes.objects.egressGbDay / result.nodes.cdn.egressGbDay).toBeCloseTo(0.1, 2);
        expect(result.nodes.objects.cost.network).toBeGreaterThan(0);
    });

    it('вызов внешнего API оплачивается исходящим трафиком вызывающего', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000 } },
                { id: 'svc', type: 'service' },
                { id: 'provider', type: 'external-api' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'provider', readShare: 0 },
            ],
        });

        const result = simulate(scheme, { sampleCount: 500 });

        expect(result.nodes.svc.egressGbDay).toBeGreaterThan(0);
    });
});

describe('насыщение бьёт по задержке, а не только по ошибкам', () => {
    function underLoad(dau: number): SchemeV1 {
        return buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau } },
                { id: 'svc', type: 'service', params: { autoscale: false, instances: 4 } },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });
    }

    it('очередь у ёмкости портит хвост раньше, чем набирается доля ошибок', () => {
        const calm = simulate(underLoad(1000000), { sampleCount: SAMPLES });
        const filling = simulate(underLoad(4000000), { sampleCount: SAMPLES });

        expect(calm.nodes.svc.utilization).toBeLessThan(0.7);
        expect(filling.nodes.svc.utilization).toBeGreaterThan(1);
        expect(filling.nodes.svc.errorRate).toBeLessThan(0.1);

        expect(filling.nodes.svc.waitSec).toBeGreaterThan(filling.nodes.svc.serviceSec);
        expect(filling.flows[0].latency.p50).toBeGreaterThan(calm.flows[0].latency.p50 * 2);
        expect(filling.flows[0].latency.p99).toBeGreaterThan(calm.flows[0].latency.p99 * 2);
    });

    it('под перегрузкой ожидание упирается в слив полной очереди', () => {
        const overloaded = simulate(underLoad(16000000), { sampleCount: SAMPLES });
        const svc = overloaded.nodes.svc;

        expect(svc.waitSec).toBeCloseTo(1000 / svc.capacity, 6);
        expect(overloaded.flows[0].latency.p50).toBeGreaterThan(svc.waitSec * 1000);
    });

    it('узел без очереди по-прежнему сбрасывает нагрузку без ожидания', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 8000000 } },
                { id: 'svc', type: 'service', params: { autoscale: false, instances: 4, queueLimit: 0 } },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const result = simulate(scheme, { sampleCount: 500 });

        expect(result.nodes.svc.waitSec).toBe(0);
        expect(result.nodes.svc.errorRate).toBeGreaterThan(0);
    });
});

describe('синхронная репликация стоит задержки на записи', () => {
    function twoRegions(replicationMode: string): SchemeV1 {
        return buildScheme({
            nodes: [
                { id: 'clients', type: 'client-mobile', params: { dau: 1000000, readWriteMix: 0.5 } },
                {
                    id: 'region-eu',
                    type: 'region',
                    params: { code: 'eu-west-1', geo: 'europe' },
                    size: { width: 500, height: 300 },
                },
                {
                    id: 'region-us',
                    type: 'region',
                    params: { code: 'us-east-1', geo: 'north-america', isPrimary: false },
                    size: { width: 500, height: 300 },
                },
                { id: 'svc', type: 'service', parentId: 'region-eu' },
                { id: 'db-eu', type: 'postgres', parentId: 'region-eu', params: { replicationMode } },
                { id: 'db-us', type: 'postgres', parentId: 'region-us', params: { replicationMode } },
            ],
            links: [
                { from: 'clients', to: 'svc', readShare: 0.5 },
                { from: 'svc', to: 'db-eu', readShare: 0.5 },
                { from: 'db-eu', to: 'db-us' },
            ],
        });
    }

    it('межрегиональный кворум добавляет RTT к записи', () => {
        const async = simulate(twoRegions('async'), { sampleCount: SAMPLES }).flows[0].latency;
        const sync = simulate(twoRegions('sync'), { sampleCount: SAMPLES }).flows[0].latency;

        expect(sync.p50).toBeGreaterThan(async.p50 + 10);
        expect(sync.p99).toBeGreaterThan(async.p99 + 20);
    });
});

describe('ёмкость DLQ', () => {
    it('по умолчанию выдерживает заметный поток ошибок', () => {
        const model = registry.get('dlq')?.model;
        if (!model) throw new Error('У dlq нет модели');

        const params = registry.getDefaultParams('dlq');
        const context: NodeContext = {
            nodeId: 'dlq-probe',
            params,
            instances: 1,
            lambda: 50,
            readShare: 0,
            writeShare: 1,
            requestBytes: 4000,
            responseBytes: 200,
            blockingSec: 0,
        };

        expect(model.capacity(context).capacity).toBeGreaterThan(50);
    });
});

describe('резидентность данных', () => {
    function regions(targetGeo: string, links: LinkSpec[]): SchemeV1 {
        return buildScheme({
            nodes: [
                { id: 'clients', type: 'client-mobile', params: { dau: 1000000, readWriteMix: 0.5 } },
                {
                    id: 'policy',
                    type: 'multi-region-policy',
                    params: { mode: 'active-passive', dataResidency: 'strict' },
                },
                {
                    id: 'region-home',
                    type: 'region',
                    params: { code: 'eu-west-1', geo: 'europe', dataResidency: 'gdpr' },
                    size: { width: 500, height: 300 },
                },
                {
                    id: 'region-away',
                    type: 'region',
                    params: { code: 'away', geo: targetGeo, isPrimary: false, dataResidency: 'gdpr' },
                    size: { width: 500, height: 300 },
                },
                { id: 'svc', type: 'service', parentId: 'region-home' },
                { id: 'db-home', type: 'postgres', parentId: 'region-home' },
                { id: 'db-away', type: 'postgres', parentId: 'region-away' },
            ],
            links: [
                { from: 'clients', to: 'svc', readShare: 0.5 },
                { from: 'svc', to: 'db-home', readShare: 0.5 },
                ...links,
            ],
        });
    }

    it('репликация внутри юрисдикции не считается нарушением', () => {
        const clean = regions('europe', [{ from: 'db-home', to: 'db-away' }]);

        expect(lintOf(clean)).not.toContain('residency-violation');
    });

    it('репликация за пределы юрисдикции — нарушение', () => {
        const leaking = regions('north-america', [{ from: 'db-home', to: 'db-away' }]);

        expect(lintOf(leaking)).toContain('residency-violation');
    });

    it('чтение из чужого региона данные не переносит', () => {
        const reading = regions('north-america', [{ from: 'svc', to: 'db-away', readShare: 1 }]);

        expect(lintOf(reading)).not.toContain('residency-violation');
    });
});
