import { beforeAll, describe, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { compileTopology } from '../../src/engine/sim/compile';
import { simulate } from '../../src/engine/sim/simulate';
import { lintArchitecture } from '../../src/engine/challenges/lint';
import { buildScheme } from '../helpers/scheme';
import type { SchemeV1 } from '../../src/engine/types/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 300;

function report(name: string, scheme: SchemeV1): void {
    const result = simulate(scheme, { sampleCount: SAMPLES });
    const topology = compileTopology(scheme);
    const lint = lintArchitecture({ topology, result });

    console.log(`\n=== ${name} ===`);
    console.log('practiceScore', lint.practiceScore, 'penalty', lint.penalty);
    console.log('positives', lint.positives.map((hit) => `${hit.rule} ${JSON.stringify(hit.values)}`));
    console.log('antipatterns', lint.antipatterns.map((hit) => `${hit.rule} ${JSON.stringify(hit.values)}`));
}

describe('lint smoke', () => {
    it('media platform', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 500000 } },
                { id: 'cdn', type: 'cdn' },
                { id: 'gw', type: 'api-gateway', params: { authMode: 'none' } },
                { id: 'svc', type: 'service' },
                { id: 'store', type: 's3' },
                { id: 'db', type: 'dynamodb', params: { hotPartitionShare: 0.6, partitionKey: 'userId' } },
                { id: 'queue', type: 'sqs', params: { dlqEnabled: false, maxInflight: 0 } },
                { id: 'encoder', type: 'worker', params: { processingTimeMs: 4000, dlqEnabled: false, idempotent: false } },
                { id: 'external', type: 'external-api' },
                { id: 'logs', type: 'logs', params: { samplingRate: 0.1 } },
                { id: 'idle', type: 'elasticsearch' },
            ],
            links: [
                { from: 'client', to: 'cdn' },
                { from: 'cdn', to: 'store' },
                { from: 'client', to: 'gw' },
                { from: 'gw', to: 'svc' },
                { from: 'svc', to: 'db', calls: { fanout: 25 } },
                { from: 'svc', to: 'queue' },
                { from: 'queue', to: 'encoder' },
                { from: 'svc', to: 'external' },
                { from: 'svc', to: 'logs' },
            ],
        });

        for (const edge of scheme.edges) {
            if (edge.target === 'external') edge.policy = { ...edge.policy, retries: 3, timeoutMs: 0 };
        }

        report('cdn + queue + serverless + hot partition', scheme);
    });

    it('hand made client to db', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 50000 } },
                { id: 'svc', type: 'service' },
                { id: 'db', type: 'postgres', params: { readReplicas: 0, multiAz: false } },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db' },
            ],
        });

        const bridge = scheme.edges[1];
        scheme.edges.push({ ...bridge, id: 'edge-direct', source: 'client', target: 'db' });

        report('client -> db direct, rf1', scheme);
    });

    it('deep chain', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 50000 } },
                { id: 'a', type: 'service' },
                { id: 'b', type: 'service' },
                { id: 'c', type: 'service' },
                { id: 'd', type: 'service' },
                { id: 'e', type: 'service' },
                { id: 'f', type: 'service' },
                { id: 'db', type: 'postgres', params: { rowSizeBytes: 4000000, readFromReplica: 0 } },
            ],
            links: [
                { from: 'client', to: 'a' },
                { from: 'a', to: 'b' },
                { from: 'b', to: 'c' },
                { from: 'c', to: 'd' },
                { from: 'd', to: 'e' },
                { from: 'e', to: 'f' },
                { from: 'f', to: 'db' },
            ],
        });

        report('7 sync hops + blob in sql', scheme);
    });

    it('multi region residency', () => {
        const scheme = buildScheme({
            nodes: [
                {
                    id: 'eu',
                    type: 'region',
                    params: { code: 'eu-west-1', geo: 'europe', dataResidency: 'gdpr' },
                },
                { id: 'us', type: 'region', params: { code: 'us-east-1', geo: 'north-america' } },
                {
                    id: 'policy',
                    type: 'multi-region-policy',
                    params: { mode: 'active-active', conflictResolution: 'crdt', rtoTargetSec: 60 },
                },
                { id: 'client', type: 'client-web', params: { dau: 100000 } },
                { id: 'dns', type: 'dns', params: { ttlSec: 3600 } },
                { id: 'svc-eu', type: 'service', parentId: 'eu' },
                { id: 'db-eu', type: 'cassandra', parentId: 'eu' },
                { id: 'db-us', type: 'cassandra', parentId: 'us' },
            ],
            links: [
                { from: 'client', to: 'dns' },
                { from: 'dns', to: 'svc-eu' },
                { from: 'svc-eu', to: 'db-eu' },
                { from: 'db-eu', to: 'db-us' },
                { from: 'svc-eu', to: 'db-us' },
            ],
        });

        report('gdpr region + stale dns ttl', scheme);
    });

    it('empty scheme', () => {
        report('no nodes', buildScheme({ nodes: [], links: [] }));
    });
});
