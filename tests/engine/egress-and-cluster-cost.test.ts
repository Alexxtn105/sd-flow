import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { DAYS_PER_MONTH, pricingFor } from '../../src/engine/sim/constants';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;
const ENTRIES = ['cdn', 'glb', 'lb-l7', 'api-gateway', 'waf', 'reverse-cache'];

function entryScheme(entry: string): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'entry', type: entry },
            { id: 'api', type: 'service' },
        ],
        links: [
            { from: 'client', to: 'entry' },
            { from: 'entry', to: 'api' },
        ],
    };
}

describe('egress тарифицируется независимо от блока входа', () => {
    for (const entry of ENTRIES) {
        it(`${entry} платит за отданные байты`, () => {
            const result = simulate(buildScheme(entryScheme(entry)), { sampleCount: SAMPLES });
            const node = result.nodes.entry;
            const rate = pricingFor('aws-2026-q2').egressPerGb;
            const own = registry.getDefaultParams(entry).costPerGbEgress;
            const expected = node.egressGbDay * DAYS_PER_MONTH * (typeof own === 'number' ? own : rate);

            expect(node.egressGbDay).toBeGreaterThan(0);
            expect(node.cost.network).toBeGreaterThanOrEqual(expected - 1e-6);
        });
    }

    it('счёт схемы не зависит от того, каким блоком нарисован вход', () => {
        const bills = ENTRIES.map(
            (entry) => simulate(buildScheme(entryScheme(entry)), { sampleCount: SAMPLES }).totals.cost.network,
        );

        for (const bill of bills) expect(bill).toBeGreaterThan(0);
    });
});

describe('поды в кластере оплачиваются один раз', () => {
    function totals(scheme: SchemeSpec): { total: number; visible: number; service: number } {
        const result = simulate(buildScheme(scheme), { sampleCount: SAMPLES });
        const visible = Object.values(result.nodes).reduce((sum, node) => sum + node.cost.total, 0);

        return { total: result.totals.costMonth, visible, service: result.nodes.svc.cost.total };
    }

    it('итог сходится с суммой по видимым узлам', () => {
        const inCluster = totals({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'cluster', type: 'k8s-cluster', size: { width: 500, height: 300 } },
                { id: 'svc', type: 'service', parentId: 'cluster' },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        expect(inCluster.total).toBeCloseTo(inCluster.visible, 6);
        expect(inCluster.service).toBeCloseTo(inCluster.total, 6);
    });

    it('без кластера итог тоже сходится', () => {
        const plain = totals({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'svc', type: 'service' },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        expect(plain.total).toBeCloseTo(plain.visible, 6);
    });

    it('цена кластера делится между подами по их числу', () => {
        const result = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web' },
                    { id: 'cluster', type: 'k8s-cluster', size: { width: 700, height: 400 } },
                    {
                        id: 'svc',
                        type: 'service',
                        parentId: 'cluster',
                        params: { instances: 6, autoscale: false },
                    },
                    {
                        id: 'worker',
                        type: 'worker',
                        parentId: 'cluster',
                        params: { instances: 2, autoscale: false },
                    },
                ],
                links: [
                    { from: 'client', to: 'svc' },
                    { from: 'svc', to: 'worker' },
                ],
            }),
            { sampleCount: SAMPLES },
        );

        const service = result.nodes.svc.cost.compute;
        const worker = result.nodes.worker.cost.compute;

        expect(service).toBeCloseTo(worker * 3, 6);
    });
});
