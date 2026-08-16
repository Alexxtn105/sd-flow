import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { ComponentParams } from '../../src/engine/types/component';
import type { SimResult } from '../../src/engine/sim/types';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;

const REPLICATED = {
    readReplicas: 4,
    readFromReplica: 0.6,
    replicaLagMs: 200,
    replicaLagSigma: 0.8,
    stickyReadShare: 0,
};

function store(type: string, params: ComponentParams): SimResult {
    return simulate(
        buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 2000000, requestsPerSession: 40 } },
                { id: 'api', type: 'service', params: { instances: 40, autoscale: false } },
                { id: 'db', type, params },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'db' },
            ],
        }),
        { sampleCount: SAMPLES },
    );
}

function rateOf(result: SimResult, code: string): number {
    return result.consistency.anomalies
        .filter((item) => item.code === code)
        .reduce((sum, item) => sum + item.ratePerSec, 0);
}

function twoRegionWrites(policy: ComponentParams, store: ComponentParams): SimResult {
    return simulate(
        buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 4000000, readWriteMix: 0.5 } },
                { id: 'glb', type: 'glb', params: { routingPolicy: 'weighted' } },
                { id: 'eu', type: 'region', params: { code: 'eu-west-1', geo: 'europe', isPrimary: true } },
                { id: 'us', type: 'region', params: { code: 'us-east-1', geo: 'north-america', isPrimary: false } },
                { id: 'svc-eu', type: 'service', parentId: 'eu' },
                { id: 'svc-us', type: 'service', parentId: 'us' },
                { id: 'db-eu', type: 'postgres', parentId: 'eu', params: store },
                { id: 'db-us', type: 'postgres', parentId: 'us', params: store },
                { id: 'mrp', type: 'multi-region-policy', params: policy },
            ],
            links: [
                { from: 'client', to: 'glb' },
                { from: 'glb', to: 'svc-eu' },
                { from: 'glb', to: 'svc-us' },
                { from: 'svc-eu', to: 'db-eu' },
                { from: 'svc-us', to: 'db-us' },
            ],
        }),
        { sampleCount: SAMPLES },
    );
}

describe('кворум R + W > N', () => {
    it('убирает устаревшие чтения', () => {
        const strong = store('cassandra', { quorumN: 3, quorumR: 2, quorumW: 2, replicaLagMs: 200 });
        const weak = store('cassandra', { quorumN: 3, quorumR: 1, quorumW: 2, replicaLagMs: 200 });

        expect(rateOf(weak, 'stale-read')).toBeGreaterThan(0);
        expect(rateOf(strong, 'stale-read')).toBe(0);
    });
});

describe('липкие чтения после записи', () => {
    it('гасят read-your-writes пропорционально доле', () => {
        const open = rateOf(store('postgres', { ...REPLICATED, stickyReadShare: 0 }), 'read-your-writes');
        const half = rateOf(store('postgres', { ...REPLICATED, stickyReadShare: 0.5 }), 'read-your-writes');
        const full = rateOf(store('postgres', { ...REPLICATED, stickyReadShare: 1 }), 'read-your-writes');

        expect(open).toBeGreaterThan(0);
        expect(half).toBeCloseTo(open * 0.5, 9);
        expect(full).toBe(0);
    });
});

describe('объявленные гарантии сессии', () => {
    it('read-your-writes убирает свою аномалию и оставляет остальные', () => {
        const result = store('postgres', { ...REPLICATED, consistencyModel: 'read-your-writes' });

        expect(rateOf(result, 'read-your-writes')).toBe(0);
        expect(rateOf(result, 'stale-read')).toBeGreaterThan(0);
    });

    it('monotonic убирает нарушение монотонности чтений', () => {
        const result = store('postgres', { ...REPLICATED, consistencyModel: 'monotonic' });

        expect(rateOf(result, 'monotonic-read')).toBe(0);
        expect(rateOf(result, 'stale-read')).toBeGreaterThan(0);
    });

    it('заявленная линеаризуемость поверх асинхронной репликации ничего не гасит', () => {
        const result = store('postgres', { ...REPLICATED, consistencyModel: 'linearizable' });

        expect(rateOf(result, 'stale-read')).toBeGreaterThan(0);
        expect(rateOf(result, 'monotonic-read')).toBeGreaterThan(0);
    });
});

describe('слияние конфликтов', () => {
    const active = { mode: 'active-active', replicationDirection: 'bidirectional' };
    const conflicting = { replicaLagMs: 200, rowCount: 100000, concurrencyControl: 'optimistic' };

    it('LWW оставляет и конфликты, и потерянные записи', () => {
        const result = twoRegionWrites({ ...active, conflictResolution: 'lww' }, conflicting);

        expect(rateOf(result, 'write-conflict')).toBeGreaterThan(0);
        expect(rateOf(result, 'lost-write-lww')).toBeGreaterThan(0);
    });

    it('CRDT в политике убирает конфликты записи', () => {
        const result = twoRegionWrites({ ...active, conflictResolution: 'crdt' }, conflicting);

        expect(rateOf(result, 'write-conflict')).toBe(0);
        expect(rateOf(result, 'lost-write-lww')).toBe(0);
    });

    it('CRDT на самом хранилище тоже убирает их', () => {
        const result = twoRegionWrites(
            { ...active, conflictResolution: 'lww' },
            { ...conflicting, concurrencyControl: 'crdt' },
        );

        expect(rateOf(result, 'write-conflict')).toBe(0);
    });
});

describe('отчёт о средствах смягчения', () => {
    function codesOf(result: SimResult): string[] {
        return result.consistency.mitigations.map((item) => item.code);
    }

    function mitigation(result: SimResult, code: string) {
        return result.consistency.mitigations.find((item) => item.code === code);
    }

    it('кворум попадает в отчёт со своими числами и списком снятых аномалий', () => {
        const found = mitigation(store('cassandra', {}), 'quorum');

        expect(found).toBeDefined();
        expect(found?.nodeIds).toEqual(['db']);
        expect(found?.values).toEqual({ quorumR: 2, quorumW: 2, quorumN: 3 });
        expect(found?.suppresses).toContain('stale-read');
        expect(found?.suppresses).toContain('divergent-replicas');
    });

    it('липкие чтения и заявленная гарантия сессии перечисляются с параметрами', () => {
        const result = store('postgres', {
            ...REPLICATED,
            stickyReadShare: 0.4,
            consistencyModel: 'read-your-writes',
        });

        expect(mitigation(result, 'sticky-reads')?.values).toEqual({ stickyReadShare: 0.4 });
        expect(mitigation(result, 'session-guarantee')?.values).toEqual({
            consistencyModel: 'read-your-writes',
        });
    });

    it('контроль конкуренции и уровень изоляции различаются', () => {
        const locking = store('postgres', { concurrencyControl: 'pessimistic', isolationLevel: 'serializable' });

        expect(mitigation(locking, 'concurrency-control')?.values).toEqual({
            concurrencyControl: 'pessimistic',
        });
        expect(mitigation(locking, 'isolation')?.suppresses).toEqual([
            'dirty-read',
            'non-repeatable-read',
            'phantom-read',
        ]);
        expect(codesOf(store('postgres', { concurrencyControl: 'none', isolationLevel: 'read-committed' })))
            .not.toContain('concurrency-control');
    });

    it('CRDT объявляется отдельно от прочих контролей', () => {
        expect(codesOf(store('postgres', { concurrencyControl: 'crdt' }))).toContain('crdt');
        expect(codesOf(store('postgres', { concurrencyControl: 'crdt' }))).not.toContain('concurrency-control');
    });

    it('идемпотентный консьюмер и упорядоченный брокер попадают в отчёт', () => {
        const result = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web', params: { dau: 500000 } },
                    { id: 'api', type: 'service' },
                    { id: 'bus', type: 'kafka', params: { orderingScope: 'per-key' } },
                    { id: 'worker', type: 'worker', params: { idempotent: true } },
                ],
                links: [
                    { from: 'client', to: 'api' },
                    { from: 'api', to: 'bus' },
                    { from: 'bus', to: 'worker' },
                ],
            }),
            { sampleCount: SAMPLES },
        );

        expect(mitigation(result, 'idempotency')?.nodeIds).toEqual(['worker']);
        expect(mitigation(result, 'ordering')?.values).toEqual({ orderingScope: 'per-key' });
    });

    it('при выключенной модели аномалий отчёта нет', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'api', type: 'service' },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'db' },
            ],
            settings: { consistencyModel: 'off' },
        });

        expect(simulate(scheme, { sampleCount: SAMPLES }).consistency.mitigations).toHaveLength(0);
    });

    it('каждый код средства переведён на оба языка', () => {
        const codes = [
            'quorum',
            'sync-replication',
            'sticky-reads',
            'session-guarantee',
            'concurrency-control',
            'crdt',
            'isolation',
            'conflict-policy',
            'idempotency',
            'ordering',
            'suppresses',
        ];

        for (const code of codes) {
            expect(ruCommon.mitigation, `ru: mitigation.${code}`).toHaveProperty(code);
            expect(enCommon.mitigation, `en: mitigation.${code}`).toHaveProperty(code);
        }
    });
});
