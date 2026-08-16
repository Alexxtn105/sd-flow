import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { IDEMPOTENCY_POLICY } from '../../src/engine/sim/constants';
import { MAX_WRITE_ATTEMPTS } from '../../src/engine/sim/contention';
import { idempotencyGbOf } from '../../src/engine/sim/derived';
import { simulate } from '../../src/engine/sim/simulate';
import type { ComponentParams } from '../../src/engine/types/component';
import type { NodeResult, SimResult } from '../../src/engine/sim/types';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;

function run(spec: SchemeSpec): SimResult {
    return simulate(buildScheme(spec), { sampleCount: SAMPLES });
}

function storeScheme(params: ComponentParams, readShare = 0.5): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { dau: 2000000, requestsPerSession: 30 } },
            { id: 'api', type: 'service', params: { instances: 40, autoscale: false } },
            { id: 'db', type: 'postgres', params },
        ],
        links: [
            { from: 'client', to: 'api', readShare },
            { from: 'api', to: 'db', readShare },
        ],
    };
}

function db(result: SimResult): NodeResult {
    return result.nodes.db;
}

describe('цена оптимистичной блокировки', () => {
    const contended = { concurrencyControl: 'optimistic', rowCount: 10 };

    it('повторы при контенции добавляются к предложенной нагрузке', () => {
        const node = db(run(storeScheme(contended)));

        expect(node.contentionRetryShare).toBeGreaterThan(0);
        expect(node.lambdaOffered).toBeGreaterThan(node.lambdaNominal);
        expect(node.lambdaOffered - node.lambdaNominal).toBeCloseTo(
            node.lambdaNominal * node.writeShare * node.contentionRetryShare,
            6,
        );
    });

    it('доля повторов растёт с концентрацией записей на ключе', () => {
        const spread = db(run(storeScheme({ ...contended, rowCount: 1000 })));
        const narrow = db(run(storeScheme({ ...contended, rowCount: 10 })));

        expect(narrow.contentionRetryShare).toBeGreaterThan(spread.contentionRetryShare);
    });

    it('на просторном ключевом пространстве повторов практически нет', () => {
        const node = db(run(storeScheme({ ...contended, rowCount: 200000000 })));

        expect(node.contentionRetryShare).toBeLessThan(0.001);
    });

    for (const concurrencyControl of ['none', 'pessimistic', 'crdt']) {
        it(`при concurrencyControl = ${concurrencyControl} повторов нет`, () => {
            const node = db(run(storeScheme({ ...contended, concurrencyControl })));

            expect(node.contentionRetryShare).toBe(0);
        });
    }

    it('число попыток ограничено сверху', () => {
        const node = db(run(storeScheme({ ...contended, rowCount: 1 }, 0.2)));

        expect(node.contentionRetryShare).toBeLessThanOrEqual(MAX_WRITE_ATTEMPTS - 1);
    });

    it('даёт находку, переведённую на оба языка', () => {
        const result = run(storeScheme(contended));
        const finding = result.findings.find((item) => item.code === 'contention-retries');

        expect(finding).toBeDefined();
        expect(finding?.nodeIds).toEqual(['db']);
        expect(ruCommon.findings).toHaveProperty('contention-retries');
        expect(enCommon.findings).toHaveProperty('contention-retries');
    });

    it('считается детерминированно', () => {
        const first = db(run(storeScheme(contended)));
        const second = db(run(storeScheme(contended)));

        expect(second.contentionRetryShare).toBe(first.contentionRetryShare);
    });
});

describe('сериализация на ключе', () => {
    const locked = { concurrencyControl: 'pessimistic', rowCount: 2 };

    it('становится ограничителем ёмкости при узком ключевом пространстве', () => {
        const node = db(run(storeScheme(locked)));

        expect(node.boundBy).toBe('key-serialization');
        expect(node.capacity).toBeLessThan(db(run(storeScheme({ ...locked, rowCount: 1e9 }))).capacity);
    });

    it('ёмкость растёт пропорционально числу ключей', () => {
        const narrow = db(run(storeScheme(locked)));
        const wide = db(run(storeScheme({ ...locked, rowCount: 4 })));

        expect(wide.capacity).toBeCloseTo(narrow.capacity * 2, 6);
    });

    it('объясняется формулой с подставленными значениями', () => {
        const node = db(run(storeScheme(locked)));
        const limit = node.limits.find((item) => item.resource === 'key-serialization');

        expect(limit).toBeDefined();
        expect(limit?.explain.formula).toBe('keys / (writeShare × T_lock)');
        expect(limit?.explain.inputs.keys).toBe(2);
        expect(Number(limit?.explain.inputs.lockSec)).toBeGreaterThan(0);
    });

    for (const concurrencyControl of ['none', 'optimistic', 'crdt']) {
        it(`при concurrencyControl = ${concurrencyControl} ограничителя нет`, () => {
            const node = db(run(storeScheme({ ...locked, concurrencyControl })));

            expect(node.limits.some((item) => item.resource === 'key-serialization')).toBe(false);
        });
    }

    it('не появляется на чистом чтении', () => {
        const node = db(run(storeScheme(locked, 1)));

        expect(node.limits.some((item) => item.resource === 'key-serialization')).toBe(false);
    });

    it('имя ограничителя переведено на оба языка', () => {
        expect(ruCommon.bound).toHaveProperty('key-serialization');
        expect(enCommon.bound).toHaveProperty('key-serialization');
    });
});

describe('хранение ключей идемпотентности', () => {
    function paymentScheme(psp: ComponentParams = {}, retries = 2): SchemeSpec {
        return {
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000, requestsPerSession: 20 } },
                { id: 'api', type: 'service', params: { instances: 30, autoscale: false } },
                { id: 'psp', type: 'payment-external', params: psp },
            ],
            links: [
                { from: 'client', to: 'api', readShare: 0.5 },
                { from: 'api', to: 'psp', readShare: 0, policy: { retries, idempotent: false } },
            ],
        };
    }

    it('ключи копятся на вызывающем, а не на внешнем провайдере', () => {
        const result = run(paymentScheme());

        expect(result.nodes.api.idempotencyGb).toBeGreaterThan(0);
        expect(result.nodes.psp.idempotencyGb).toBe(0);
    });

    it('объём равен потоку записей за TTL', () => {
        const result = run(paymentScheme());
        const writeRps = result.edges['edge-1'].byOperation.write ?? 0;

        expect(writeRps).toBeGreaterThan(0);
        expect(result.nodes.api.idempotencyGb).toBeCloseTo(idempotencyGbOf(writeRps), 9);
        expect(idempotencyGbOf(1000)).toBeCloseTo(
            (1000 * IDEMPOTENCY_POLICY.ttlHours * 3600 * IDEMPOTENCY_POLICY.bytesPerKey) / 1e9,
            9,
        );
    });

    it('провайдер без требования идемпотентности ключей не требует', () => {
        const result = run(paymentScheme({ idempotencyRequired: false }));

        expect(result.nodes.api.idempotencyGb).toBe(0);
    });

    it('суммируется в тоталах', () => {
        const result = run(paymentScheme());

        expect(result.totals.idempotencyGb).toBeCloseTo(result.nodes.api.idempotencyGb, 9);
    });

    it('повтор без ключа даёт аномалию повторной обработки как оценку сверху', () => {
        const result = run(paymentScheme());
        const anomaly = result.consistency.anomalies.find(
            (item) => item.code === 'duplicate-processing' && item.nodeIds.includes('psp'),
        );

        expect(anomaly).toBeDefined();
        expect(anomaly?.upperBound).toBe(true);
        expect(anomaly?.explain.inputs.retries).toBe(2);
    });

    it('идемпотентный вызов аномалии не даёт', () => {
        const scheme = paymentScheme();
        scheme.links[1].policy = { retries: 2, idempotent: true };
        const result = run(scheme);

        expect(
            result.consistency.anomalies.some(
                (item) => item.code === 'duplicate-processing' && item.nodeIds.includes('psp'),
            ),
        ).toBe(false);
    });

    it('идемпотентный консьюмер копит ключи дедупликации', () => {
        const result = run({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 200000, requestsPerSession: 20 } },
                { id: 'api', type: 'service', params: { instances: 30, autoscale: false } },
                { id: 'bus', type: 'kafka' },
                { id: 'worker', type: 'worker', params: { idempotent: true } },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'bus' },
                { from: 'bus', to: 'worker' },
            ],
        });

        expect(result.nodes.worker.idempotencyGb).toBeGreaterThan(0);
        expect(result.nodes.bus.idempotencyGb).toBe(0);
    });
});
