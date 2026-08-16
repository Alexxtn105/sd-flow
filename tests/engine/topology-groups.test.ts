import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { compileTopology } from '../../src/engine/sim/compile';
import { simulate } from '../../src/engine/sim/simulate';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';
import { buildScheme } from '../helpers/scheme';
import type { NodeSpec, SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 2000;
const OVERLOAD_DAU = 14400000;
const IDLE_DAU = 43200;
const SCALED_PRICE = { nodeCostPerHour: 0.5, controlPlaneCostMonth: 100, podsPerNode: 8 };
const SCALED_SERVICE = { autoscale: false, instances: 40 };

function compile(spec: SchemeSpec) {
    return compileTopology(buildScheme(spec));
}

function clusterScheme(cluster: NodeSpec['params'], service: NodeSpec['params'], dau: number): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { dau, sessionsPerUserDay: 3, requestsPerSession: 40 } },
            { id: 'cluster', type: 'k8s-cluster', params: cluster },
            { id: 'svc', type: 'service', parentId: 'cluster', params: service },
        ],
        links: [{ from: 'client', to: 'svc' }],
    };
}

function crowdedScheme(cluster: NodeSpec['params']): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { dau: IDLE_DAU, sessionsPerUserDay: 3, requestsPerSession: 40 } },
            { id: 'cluster', type: 'k8s-cluster', params: cluster },
            { id: 'big', type: 'service', parentId: 'cluster', params: { autoscale: false, instances: 40 } },
            { id: 'mid', type: 'service', parentId: 'cluster', params: { autoscale: false, instances: 2 } },
            { id: 'small', type: 'service', parentId: 'cluster', params: { autoscale: false, instances: 1 } },
        ],
        links: [
            { from: 'client', to: 'big' },
            { from: 'client', to: 'mid' },
            { from: 'client', to: 'small' },
        ],
    };
}

describe('группы VPC и Kubernetes', () => {
    it('узлы внутри контейнеров получают vpcId и clusterId', () => {
        const topology = compile({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'vpc-main', type: 'vpc' },
                { id: 'cluster', type: 'k8s-cluster', parentId: 'vpc-main' },
                { id: 'svc', type: 'service', parentId: 'cluster' },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db' },
            ],
        });

        const service = topology.nodeById.get('svc');
        expect(service?.vpcId).toBe('vpc-main');
        expect(service?.clusterId).toBe('cluster');

        const database = topology.nodeById.get('db');
        expect(database?.vpcId).toBeNull();
        expect(database?.clusterId).toBeNull();

        const cluster = topology.nodeById.get('cluster');
        expect(cluster?.vpcId).toBe('vpc-main');
    });

    it('связь из VPC наружу идёт через NAT и добавляет задержку пиринга', () => {
        const nodes = [
            { id: 'client', type: 'client-web' },
            { id: 'svc', type: 'service' },
            { id: 'db', type: 'postgres' },
        ];
        const links = [
            { from: 'client', to: 'svc' },
            { from: 'svc', to: 'db' },
        ];

        const plain = compile({ nodes, links });
        const withVpc = compile({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'vpc-main', type: 'vpc', params: { peeringLatencyMs: 0.4 } },
                { id: 'svc', type: 'service', parentId: 'vpc-main' },
                { id: 'db', type: 'postgres' },
            ],
            links,
        });

        const plainEdge = plain.edges.find((edge) => edge.source === 'svc');
        const natEdge = withVpc.edges.find((edge) => edge.source === 'svc');
        const inboundEdge = withVpc.edges.find((edge) => edge.source === 'client');

        expect(natEdge?.viaNat).toBe(true);
        expect(natEdge?.crossVpc).toBe(false);
        expect(natEdge?.networkMs).toBeCloseTo((plainEdge?.networkMs ?? 0) + 0.4, 6);

        expect(inboundEdge?.viaNat).toBe(false);
        expect(inboundEdge?.networkMs).toBe(plain.edges.find((edge) => edge.source === 'client')?.networkMs);
    });

    it('связь между разными VPC помечается как crossVpc и оплачивает оба хопа', () => {
        const plain = compile({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'svc', type: 'service' },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db' },
            ],
        });

        const paired = compile({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'vpc-app', type: 'vpc', params: { peeringLatencyMs: 0.4 } },
                { id: 'vpc-data', type: 'vpc' },
                { id: 'svc', type: 'service', parentId: 'vpc-app' },
                { id: 'db', type: 'postgres', parentId: 'vpc-data' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db' },
            ],
        });

        const plainEdge = plain.edges.find((edge) => edge.source === 'svc');
        const peeredEdge = paired.edges.find((edge) => edge.source === 'svc');

        expect(peeredEdge?.crossVpc).toBe(true);
        expect(peeredEdge?.viaNat).toBe(true);
        expect(peeredEdge?.networkMs).toBeCloseTo((plainEdge?.networkMs ?? 0) + 0.8, 6);
    });

    it('связь внутри одного VPC не идёт через NAT', () => {
        const topology = compile({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'vpc-main', type: 'vpc' },
                { id: 'svc', type: 'service', parentId: 'vpc-main' },
                { id: 'db', type: 'postgres', parentId: 'vpc-main' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db' },
            ],
        });

        const edge = topology.edges.find((item) => item.source === 'svc');
        expect(edge?.viaNat).toBe(false);
        expect(edge?.crossVpc).toBe(false);
    });

    it('кластер стоит денег даже без трафика', () => {
        const result = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web' },
                    { id: 'cluster', type: 'k8s-cluster', params: { nodes: 4, nodeCostPerHour: 0.2, controlPlaneCostMonth: 73 } },
                    { id: 'svc', type: 'service', parentId: 'cluster' },
                ],
                links: [{ from: 'client', to: 'svc' }],
            }),
            { sampleCount: SAMPLES },
        );

        const expected = 4 * 0.2 * 730 + 73;
        expect(result.totals.cost.compute).toBeGreaterThanOrEqual(expected);
    });

    it('превышение потолка подов даёт находку k8s-pods-exceeded', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'cluster', type: 'k8s-cluster', params: { nodes: 1, podsPerNode: 8, autoscaleNodes: false } },
                { id: 'svc', type: 'service', parentId: 'cluster', params: { autoscale: false, instances: 40 } },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const finding = simulate(scheme, { sampleCount: SAMPLES }).findings.find(
            (item) => item.code === 'k8s-pods-exceeded',
        );

        expect(finding?.severity).toBe('error');
        expect(finding?.values).toMatchObject({ requested: 40, granted: 8, ceiling: 8, nodes: 1, podsPerNode: 8 });
    });

    it('в пределах потолка подов находки нет и поды не урезаются', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'cluster', type: 'k8s-cluster', params: { nodes: 4, podsPerNode: 110, autoscaleNodes: false } },
                { id: 'svc', type: 'service', parentId: 'cluster', params: { autoscale: false, instances: 40 } },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });
        expect(result.findings.some((item) => item.code === 'k8s-pods-exceeded')).toBe(false);
        expect(result.nodes.svc.instances).toBe(40);
    });

    it('потолок подов режет ёмкость: тот же сервис в тесном кластере тянет меньше', () => {
        const service = { autoscale: false, instances: 40 };

        const tight = simulate(
            buildScheme(clusterScheme({ nodes: 1, podsPerNode: 8, autoscaleNodes: false }, service, OVERLOAD_DAU)),
            { sampleCount: SAMPLES },
        );
        const roomy = simulate(
            buildScheme(clusterScheme({ nodes: 1, podsPerNode: 110, autoscaleNodes: false }, service, OVERLOAD_DAU)),
            { sampleCount: SAMPLES },
        );

        expect(tight.nodes.svc.instances).toBe(8);
        expect(roomy.nodes.svc.instances).toBe(40);

        expect(tight.nodes.svc.capacity).toBeLessThan(roomy.nodes.svc.capacity);
        expect(tight.nodes.svc.utilization).toBeGreaterThan(roomy.nodes.svc.utilization);
        expect(tight.nodes.svc.throughput).toBeLessThan(roomy.nodes.svc.throughput);
        expect(tight.nodes.svc.utilization).toBeGreaterThan(1);
        expect(roomy.nodes.svc.utilization).toBeLessThan(1);
    });

    it('потолок делится между деплойментами пропорционально и без потерь', () => {
        const result = simulate(buildScheme(crowdedScheme({ nodes: 1, podsPerNode: 8, autoscaleNodes: false })), {
            sampleCount: SAMPLES,
        });

        const granted = ['big', 'mid', 'small'].map((nodeId) => result.nodes[nodeId].instances);

        expect(granted.reduce((sum, value) => sum + value, 0)).toBe(8);
        for (const instances of granted) expect(instances).toBeGreaterThanOrEqual(1);
        expect(granted).toEqual([6, 1, 1]);

        const finding = result.findings.find((item) => item.code === 'k8s-pods-exceeded');
        expect(finding?.values).toMatchObject({ requested: 43, granted: 8, ceiling: 8 });
    });

    it('автоскейлинг нод растит кластер вместо урезания подов и платит за это', () => {
        const grown = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 1, autoscaleNodes: true }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );
        const declared = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 5, autoscaleNodes: false }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );
        const clamped = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 1, autoscaleNodes: false }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );

        expect(grown.nodes.svc.instances).toBe(40);
        expect(grown.findings.some((item) => item.code === 'k8s-pods-exceeded')).toBe(false);

        expect(grown.totals.cost.compute).toBeCloseTo(5 * 0.5 * 730 + 100, 6);
        expect(grown.totals.costMonth).toBeCloseTo(declared.totals.costMonth, 9);
        expect(grown.totals.costMonth).toBeGreaterThan(clamped.totals.costMonth);
        expect(grown.totals.cost.compute - clamped.totals.cost.compute).toBeCloseTo((5 - 1) * 0.5 * 730, 6);
    });

    it('рост кластера объясняется находкой k8s-nodes-scaled', () => {
        const result = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 1, autoscaleNodes: true }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );

        const finding = result.findings.find((item) => item.code === 'k8s-nodes-scaled');

        expect(finding?.severity).toBe('info');
        expect(finding?.nodeIds).toEqual(['cluster']);
        expect(finding?.values).toMatchObject({ nodes: 1, effectiveNodes: 5, pods: 40, podsPerNode: 8 });
        expect(result.findings.some((item) => item.code === 'k8s-pods-exceeded')).toBe(false);
    });

    it('находки о росте нет, когда объявленного размера кластера уже хватает', () => {
        const fits = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 5, autoscaleNodes: true }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );
        const roomy = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 12, autoscaleNodes: true }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );

        expect(fits.findings.some((item) => item.code === 'k8s-nodes-scaled')).toBe(false);
        expect(roomy.findings.some((item) => item.code === 'k8s-nodes-scaled')).toBe(false);
    });

    it('находки о росте нет, когда автоскейлинг выключен и поды урезаются', () => {
        const clamped = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 1, autoscaleNodes: false }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );

        expect(clamped.findings.some((item) => item.code === 'k8s-nodes-scaled')).toBe(false);
        expect(clamped.findings.some((item) => item.code === 'k8s-pods-exceeded')).toBe(true);
    });

    it('доплата за рост совпадает с разницей стоимости объявленных вручную кластеров', () => {
        const grown = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 1, autoscaleNodes: true }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );
        const declared = simulate(
            buildScheme(clusterScheme({ ...SCALED_PRICE, nodes: 5, autoscaleNodes: false }, SCALED_SERVICE, IDLE_DAU)),
            { sampleCount: SAMPLES },
        );
        const single = simulate(
            buildScheme(
                clusterScheme(
                    { ...SCALED_PRICE, podsPerNode: 40, nodes: 1, autoscaleNodes: false },
                    SCALED_SERVICE,
                    IDLE_DAU,
                ),
            ),
            { sampleCount: SAMPLES },
        );

        const extra = Number(
            grown.findings.find((item) => item.code === 'k8s-nodes-scaled')?.values.extraCostMonth,
        );

        expect(extra).toBeCloseTo((5 - 1) * 0.5 * 730, 6);
        expect(grown.totals.costMonth - single.totals.costMonth).toBeCloseTo(extra, 6);
        expect(declared.totals.costMonth - single.totals.costMonth).toBeCloseTo(extra, 6);
        expect(single.nodes.svc.instances).toBe(grown.nodes.svc.instances);
    });

    it('находка о росте кластера переведена на оба языка', () => {
        expect(ruCommon.findings).toHaveProperty('k8s-nodes-scaled');
        expect(enCommon.findings).toHaveProperty('k8s-nodes-scaled');
    });

    it('находка о росте кластера детерминирована', () => {
        const spec = clusterScheme({ ...SCALED_PRICE, nodes: 1, autoscaleNodes: true }, SCALED_SERVICE, IDLE_DAU);
        const scaled = (result: ReturnType<typeof simulate>) =>
            result.findings.filter((item) => item.code === 'k8s-nodes-scaled');

        const first = simulate(buildScheme(spec), { sampleCount: SAMPLES, scenario: 'spike' });
        const second = simulate(buildScheme(spec), { sampleCount: SAMPLES, scenario: 'spike' });

        expect(scaled(first)).toHaveLength(1);
        expect(scaled(second)).toEqual(scaled(first));
        expect(second.findings).toEqual(first.findings);
        expect(second.totals.costMonth).toBe(first.totals.costMonth);
    });

    it('таймлайн держит тот же потолок подов, что и стационарный расчёт', () => {
        const scheme = buildScheme(
            clusterScheme({ nodes: 1, podsPerNode: 8, autoscaleNodes: false }, { autoscale: false, instances: 40 }, IDLE_DAU),
        );

        const result = simulate(scheme, { sampleCount: SAMPLES, scenario: 'spike' });
        const timeline = result.timeline;

        expect(timeline).not.toBeNull();
        expect(result.nodes.svc.instances).toBe(8);

        for (const sample of timeline?.samples ?? []) {
            expect(sample.nodes.svc.instances).toBe(result.nodes.svc.instances);
            expect(sample.nodes.svc.desiredInstances).toBe(40);
        }
    });

    it('раздача подов детерминирована', () => {
        const spec = crowdedScheme({ nodes: 1, podsPerNode: 8, autoscaleNodes: false });

        const first = simulate(buildScheme(spec), { sampleCount: SAMPLES, scenario: 'spike' });
        const second = simulate(buildScheme(spec), { sampleCount: SAMPLES, scenario: 'spike' });

        expect(second.nodes).toEqual(first.nodes);
        expect(second.findings).toEqual(first.findings);
        expect(second.totals.costMonth).toBe(first.totals.costMonth);
        expect(second.timeline?.samples).toEqual(first.timeline?.samples);
    });

    it('трафик наружу шире полосы NAT даёт находку nat-saturated', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'vpc-main', type: 'vpc', params: { natGatewayCount: 1, natThroughputGbps: 1 } },
                { id: 'svc', type: 'service', parentId: 'vpc-main' },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db', calls: { requestBytes: 200000, responseBytes: 200000 } },
            ],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });
        const finding = result.findings.find((item) => item.code === 'nat-saturated');

        expect(finding?.severity).toBe('warning');
        expect(Number(finding?.values.bytesPerSec)).toBeGreaterThan(Number(finding?.values.capacityBytesPerSec));
        expect(result.totals.cost.network).toBeGreaterThan(0);
    });
});
