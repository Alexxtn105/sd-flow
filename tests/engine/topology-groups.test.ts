import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { compileTopology } from '../../src/engine/sim/compile';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 2000;

function compile(spec: SchemeSpec) {
    return compileTopology(buildScheme(spec));
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
                { id: 'cluster', type: 'k8s-cluster', params: { nodes: 1, podsPerNode: 8 } },
                { id: 'svc', type: 'service', parentId: 'cluster', params: { autoscale: false, instances: 40 } },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const finding = simulate(scheme, { sampleCount: SAMPLES }).findings.find(
            (item) => item.code === 'k8s-pods-exceeded',
        );

        expect(finding?.severity).toBe('error');
        expect(finding?.values).toMatchObject({ requested: 40, ceiling: 8, nodes: 1, podsPerNode: 8 });
    });

    it('в пределах потолка подов находки нет', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'cluster', type: 'k8s-cluster', params: { nodes: 4, podsPerNode: 110 } },
                { id: 'svc', type: 'service', parentId: 'cluster', params: { autoscale: false, instances: 40 } },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });
        expect(result.findings.some((item) => item.code === 'k8s-pods-exceeded')).toBe(false);
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
