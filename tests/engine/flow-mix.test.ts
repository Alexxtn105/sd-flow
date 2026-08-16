import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';
import type { SchemeV1 } from '../../src/engine/types/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;

function chain(readWriteMix: number): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { readWriteMix } },
            { id: 'svc', type: 'service' },
            { id: 'db', type: 'postgres' },
        ],
        links: [
            { from: 'client', to: 'svc' },
            { from: 'svc', to: 'db' },
        ],
    };
}

function reversed(scheme: SchemeV1): SchemeV1 {
    return { ...scheme, nodes: [...scheme.nodes].reverse(), edges: [...scheme.edges].reverse() };
}

describe('смесь чтение/запись наследуется по цепочке', () => {
    for (const mix of [0.99, 0.5, 0.1, 0]) {
        it(`доля чтений ${mix} доходит до базы`, () => {
            const result = simulate(buildScheme(chain(mix)), { sampleCount: SAMPLES });

            expect(result.nodes.db.readShare).toBeCloseTo(mix, 6);
            expect(result.nodes.db.writeShare).toBeCloseTo(1 - mix, 6);
        });
    }

    it('рост данных падает с ростом доли чтений', () => {
        const growth = [0, 0.5, 0.99].map(
            (mix) => simulate(buildScheme(chain(mix)), { sampleCount: SAMPLES }).totals.growthGbDay,
        );

        expect(growth[0]).toBeGreaterThan(growth[1]);
        expect(growth[1]).toBeGreaterThan(growth[2]);
    });

    it('ребро в режиме «вручную» держит заданные доли', () => {
        const scheme = buildScheme(chain(0.5));
        const manual = {
            ...scheme,
            edges: scheme.edges.map((edge) =>
                edge.target === 'db' ? { ...edge, mixMode: 'manual' as const } : edge,
            ),
        };

        const result = simulate(manual, { sampleCount: SAMPLES });

        expect(result.nodes.db.readShare).toBeCloseTo(0.9, 6);
    });

    it('потребитель событий не наследует смесь: запись в индекс не обнуляется', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'api', type: 'service' },
                { id: 'queue', type: 'kafka' },
                { id: 'worker', type: 'worker' },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'queue' },
                { from: 'queue', to: 'worker' },
                { from: 'worker', to: 'db', readShare: 0 },
            ],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });

        expect(result.nodes.worker.throughput).toBeGreaterThan(0);
        expect(result.nodes.db.throughput).toBeCloseTo(result.nodes.worker.throughput, 6);
        expect(result.nodes.db.writeShare).toBeCloseTo(1, 6);
    });
});

describe('разделение чтения и записи по двум рёбрам', () => {
    it('сумма по рёбрам равна потоку источника', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { readWriteMix: 0.8 } },
                { id: 'svc', type: 'service' },
                { id: 'replica', type: 'postgres' },
                { id: 'primary', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'replica', readShare: 1 },
                { from: 'svc', to: 'primary', readShare: 0 },
            ],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });
        const source = result.nodes.svc.throughput;

        expect(result.nodes.replica.throughput).toBeCloseTo(source * 0.8, 6);
        expect(result.nodes.primary.throughput).toBeCloseTo(source * 0.2, 6);
        expect(result.nodes.replica.throughput + result.nodes.primary.throughput).toBeCloseTo(source, 6);
    });
});

describe('обратное ребро цикла', () => {
    const cycle: SchemeSpec = {
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'a', type: 'service' },
            { id: 'b', type: 'service' },
        ],
        links: [
            { from: 'client', to: 'a' },
            { from: 'a', to: 'b' },
            { from: 'b', to: 'a' },
        ],
    };

    it('несёт нагрузку и не зависит от порядка узлов', () => {
        const scheme = buildScheme(cycle);
        const direct = simulate(scheme, { sampleCount: SAMPLES });
        const flipped = simulate(reversed(scheme), { sampleCount: SAMPLES });

        expect(direct.nodes.b.throughput).toBeGreaterThan(0);
        expect(direct.nodes.b.throughput).toBeCloseTo(direct.nodes.a.throughput, 6);
        expect(flipped.nodes.a.throughput).toBeCloseTo(direct.nodes.a.throughput, 6);
        expect(flipped.nodes.b.throughput).toBeCloseTo(direct.nodes.b.throughput, 6);
    });

    it('усиление трафика в контуре видно как перегрузка', () => {
        const result = simulate(buildScheme(cycle), { sampleCount: SAMPLES });

        expect(result.findings.some((finding) => finding.code === 'overloaded')).toBe(true);
    });
});

describe('репликация между регионами', () => {
    function twoRegions(): SchemeSpec {
        return {
            nodes: [
                { id: 'clients', type: 'client-web', params: { readWriteMix: 0.5 } },
                { id: 'router', type: 'glb', params: { routingPolicy: 'weighted' } },
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
                { id: 'svc-eu', type: 'service', parentId: 'region-eu' },
                { id: 'db-eu', type: 'postgres', parentId: 'region-eu' },
                { id: 'svc-us', type: 'service', parentId: 'region-us' },
                { id: 'db-us', type: 'postgres', parentId: 'region-us' },
                { id: 'policy', type: 'multi-region-policy', params: { mode: 'active-active' } },
            ],
            links: [
                { from: 'clients', to: 'router' },
                { from: 'router', to: 'svc-eu' },
                { from: 'router', to: 'svc-us' },
                { from: 'svc-eu', to: 'db-eu' },
                { from: 'svc-us', to: 'db-us' },
                { from: 'db-eu', to: 'db-us' },
                { from: 'db-us', to: 'db-eu' },
            ],
        };
    }

    it('симметричная схема даёт одинаковую нагрузку в обоих регионах', () => {
        const scheme = buildScheme(twoRegions());
        const direct = simulate(scheme, { sampleCount: SAMPLES });
        const flipped = simulate(reversed(scheme), { sampleCount: SAMPLES });
        const gap = (left: number, right: number): number => Math.abs(left - right) / Math.max(left, right);

        expect(gap(direct.nodes['db-eu'].throughput, direct.nodes['db-us'].throughput)).toBeLessThan(1e-3);
        expect(gap(flipped.nodes['db-eu'].throughput, direct.nodes['db-eu'].throughput)).toBeLessThan(1e-3);
        expect(gap(flipped.nodes['db-us'].throughput, direct.nodes['db-us'].throughput)).toBeLessThan(1e-3);
    });

    it('поток репликации равен записям источника и не растёт по кругу', () => {
        const result = simulate(buildScheme(twoRegions()), { sampleCount: SAMPLES });
        const writesOf = (nodeId: string): number =>
            result.nodes[nodeId].throughput * result.nodes[nodeId].writeShare;
        const replicated = result.edges['edge-5'].rps + result.edges['edge-6'].rps;

        expect(result.multiRegion?.replicationRps).toBeCloseTo(replicated, 6);
        expect(replicated).toBeLessThan(writesOf('db-eu') + writesOf('db-us'));
        expect(result.edges['edge-5'].rps).toBeCloseTo(result.edges['edge-6'].rps, 1);
    });
});
