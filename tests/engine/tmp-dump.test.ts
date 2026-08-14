import { beforeAll, describe, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { compileTopology } from '../../src/engine/sim/compile';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

describe('dump', () => {
    it('capacities', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'region-a', type: 'region', params: { code: 'eu-west-1', geo: 'europe' } },
                { id: 'region-b', type: 'region', params: { code: 'us-east-1', geo: 'north-america' } },
                { id: 'az-a', type: 'az', parentId: 'region-a' },
                { id: 'az-b', type: 'az', parentId: 'region-a', params: { code: 'b' } },
                { id: 'policy', type: 'multi-region-policy', params: { mode: 'active-active' } },
                { id: 'client', type: 'client-mobile', params: { dau: 200000 } },
                { id: 'dns', type: 'dns' },
                { id: 'gw', type: 'api-gateway', parentId: 'az-a' },
                { id: 'svc', type: 'service', parentId: 'az-b' },
                { id: 'cache', type: 'redis', parentId: 'az-b' },
                { id: 'db', type: 'postgres', parentId: 'az-a' },
                { id: 'queue', type: 'kafka', parentId: 'az-a' },
                { id: 'worker', type: 'worker', parentId: 'az-b' },
                { id: 'dead', type: 'dlq', parentId: 'az-b' },
                { id: 'logs', type: 'logs', parentId: 'az-a' },
                { id: 'db-b', type: 'postgres', parentId: 'region-b' },
            ],
            links: [
                { from: 'client', to: 'dns' },
                { from: 'dns', to: 'gw' },
                { from: 'gw', to: 'svc' },
                { from: 'svc', to: 'cache' },
                { from: 'svc', to: 'db' },
                { from: 'svc', to: 'queue' },
                { from: 'queue', to: 'worker' },
                { from: 'worker', to: 'dead' },
                { from: 'svc', to: 'logs' },
                { from: 'db', to: 'db-b' },
            ],
        });
        const result = simulate(scheme, { sampleCount: 300 });
        const topology = compileTopology(scheme);
        for (const node of topology.nodes) {
            const r = result.nodes[node.id];
            if (!r) continue;
            console.log(node.id, node.regionId, 'cap', r.capacity, 'lam', r.lambdaOffered, 'util', r.utilization, 'boundBy', r.boundBy);
        }
        console.log('multiRegion', JSON.stringify(result.multiRegion?.regions));
        console.log('findings', result.findings.map((f) => `${f.code}:${f.nodeIds.join(',')}`));
    });
});
