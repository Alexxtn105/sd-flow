import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import type { AnomalyRate, SimResult } from '../../src/engine/sim/types';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';
import { buildScheme } from '../helpers/scheme';
import type { NodeSpec, SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;
const NEW_CODES = [
    'monotonic-read',
    'ordering-violation',
    'dirty-read',
    'non-repeatable-read',
    'phantom-read',
];

function run(spec: SchemeSpec): SimResult {
    return simulate(buildScheme(spec), { sampleCount: SAMPLES });
}

function anomaliesOf(result: SimResult, code: string): AnomalyRate[] {
    return result.consistency.anomalies.filter((item) => item.code === code);
}

function rateOf(result: SimResult, code: string): number {
    return anomaliesOf(result, code).reduce((sum, item) => sum + item.ratePerSec, 0);
}

function codesOf(result: SimResult): string[] {
    return result.consistency.anomalies.map((item) => item.code);
}

function storeScheme(params: NodeSpec['params']): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { dau: 2000000, requestsPerSession: 40 } },
            { id: 'api', type: 'service', params: { instances: 40, autoscale: false } },
            { id: 'db', type: 'postgres', params },
        ],
        links: [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'db' },
        ],
    };
}

describe('A3 — нарушение монотонности чтений', () => {
    const replicated = {
        readReplicas: 4,
        readFromReplica: 0.6,
        replicaLagMs: 200,
        replicaLagSigma: 0.8,
        stickyReadShare: 0,
    };

    it('появляется на реплицированном хранилище без липких чтений', () => {
        const result = run(storeScheme(replicated));
        const [anomaly] = anomaliesOf(result, 'monotonic-read');

        expect(anomaly).toBeDefined();
        expect(anomaly.ratePerSec).toBeGreaterThan(0);
        expect(anomaly.shareOfOperations).toBeGreaterThan(0);
        expect(anomaly.shareOfOperations).toBeLessThan(1);
        expect(anomaly.nodeIds).toEqual(['db']);
        expect(anomaly.upperBound).toBeUndefined();
        expect(anomaly.explain.formula).toContain('1/nReplicas');
    });

    it('исчезает при полностью липких чтениях', () => {
        const result = run(storeScheme({ ...replicated, stickyReadShare: 1 }));

        expect(anomaliesOf(result, 'monotonic-read')).toHaveLength(0);
    });

    it('исчезает, когда читать нечего кроме мастера', () => {
        const result = run(storeScheme({ ...replicated, readReplicas: 0 }));

        expect(anomaliesOf(result, 'monotonic-read')).toHaveLength(0);
    });

    it('растёт вместе с отставанием реплики', () => {
        const small = rateOf(run(storeScheme({ ...replicated, replicaLagMs: 50 })), 'monotonic-read');
        const medium = rateOf(run(storeScheme({ ...replicated, replicaLagMs: 200 })), 'monotonic-read');
        const large = rateOf(run(storeScheme({ ...replicated, replicaLagMs: 1000 })), 'monotonic-read');

        expect(medium).toBeGreaterThan(small);
        expect(large).toBeGreaterThan(medium);
    });

    it('падает с ростом доли липких чтений', () => {
        const open = rateOf(run(storeScheme({ ...replicated, stickyReadShare: 0 })), 'monotonic-read');
        const half = rateOf(run(storeScheme({ ...replicated, stickyReadShare: 0.5 })), 'monotonic-read');
        const mostly = rateOf(run(storeScheme({ ...replicated, stickyReadShare: 0.9 })), 'monotonic-read');

        expect(half).toBeLessThan(open);
        expect(mostly).toBeLessThan(half);
        expect(half).toBeCloseTo(open * 0.5, 9);
    });

    it('растёт с числом реплик, по которым размазаны чтения', () => {
        const few = rateOf(run(storeScheme({ ...replicated, readReplicas: 1 })), 'monotonic-read');
        const many = rateOf(run(storeScheme({ ...replicated, readReplicas: 9 })), 'monotonic-read');

        expect(many).toBeGreaterThan(few);
    });

    it('считается детерминированно', () => {
        const first = run(storeScheme(replicated));
        const second = run(storeScheme(replicated));

        expect(rateOf(second, 'monotonic-read')).toBe(rateOf(first, 'monotonic-read'));
    });
});

describe('A7 — нарушение порядка', () => {
    function queueScheme(busParams: NodeSpec['params']): SchemeSpec {
        return {
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 2000000, requestsPerSession: 40 } },
                { id: 'api', type: 'service', params: { instances: 40, autoscale: false } },
                { id: 'bus', type: 'kafka', params: busParams },
                {
                    id: 'worker',
                    type: 'worker',
                    params: { instances: 20, concurrency: 8, processingTimeMs: 120, autoscale: false },
                },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'bus' },
                { from: 'bus', to: 'worker' },
            ],
        };
    }

    const unordered = { partitions: 24, orderingScope: 'none', consumersPerGroup: 12 };

    it('появляется, когда порядок не гарантирован и консьюмеров больше одного', () => {
        const result = run(queueScheme(unordered));
        const [anomaly] = anomaliesOf(result, 'ordering-violation');

        expect(anomaly).toBeDefined();
        expect(anomaly.ratePerSec).toBeGreaterThan(0);
        expect(anomaly.nodeIds).toEqual(['bus', 'worker']);
        expect(anomaly.explain.inputs.lanes).toBe(12);
        expect(anomaly.explain.inputs.orderingGuarantee).toBe('none');
    });

    it('не зависит от идемпотентности консьюмера', () => {
        const result = run(queueScheme(unordered));

        expect(anomaliesOf(result, 'duplicate-processing')).toHaveLength(0);
        expect(anomaliesOf(result, 'ordering-violation').length).toBeGreaterThan(0);
    });

    for (const orderingScope of ['per-key', 'per-partition', 'global']) {
        it(`исчезает при orderingScope = ${orderingScope}`, () => {
            const result = run(queueScheme({ ...unordered, orderingScope }));

            expect(anomaliesOf(result, 'ordering-violation')).toHaveLength(0);
        });
    }

    it('исчезает, когда консьюмер в группе один', () => {
        const result = run(queueScheme({ ...unordered, consumersPerGroup: 1 }));

        expect(anomaliesOf(result, 'ordering-violation')).toHaveLength(0);
    });

    it('растёт с числом консьюмеров в группе', () => {
        const few = rateOf(run(queueScheme({ ...unordered, consumersPerGroup: 2 })), 'ordering-violation');
        const many = rateOf(run(queueScheme({ ...unordered, consumersPerGroup: 16 })), 'ordering-violation');

        expect(many).toBeGreaterThan(few);
    });

    it('ограничен числом партиций', () => {
        const narrow = rateOf(run(queueScheme({ ...unordered, partitions: 2 })), 'ordering-violation');
        const wide = rateOf(run(queueScheme({ ...unordered, partitions: 24 })), 'ordering-violation');

        expect(wide).toBeGreaterThan(narrow);
    });

    function sqsScheme(queueType: string): SchemeSpec {
        return {
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 2000000, requestsPerSession: 40 } },
                { id: 'api', type: 'service', params: { instances: 40, autoscale: false } },
                { id: 'queue', type: 'sqs', params: { queueType } },
                {
                    id: 'worker',
                    type: 'worker',
                    params: { instances: 20, concurrency: 8, processingTimeMs: 120, autoscale: false },
                },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'queue' },
                { from: 'queue', to: 'worker' },
            ],
        };
    }

    it('различает standard и fifo у очереди без параметра orderingScope', () => {
        expect(rateOf(run(sqsScheme('standard')), 'ordering-violation')).toBeGreaterThan(0);
        expect(anomaliesOf(run(sqsScheme('fifo')), 'ordering-violation')).toHaveLength(0);
    });

    it('считается детерминированно', () => {
        const first = run(queueScheme(unordered));
        const second = run(queueScheme(unordered));

        expect(rateOf(second, 'ordering-violation')).toBe(rateOf(first, 'ordering-violation'));
    });
});

describe('A8 — аномалии изоляции SQL', () => {
    const contended = { rowCount: 100, readReplicas: 0, replicaLagMs: 0, concurrencyControl: 'pessimistic' };

    function withIsolation(isolationLevel: string): SchemeSpec {
        return storeScheme({ ...contended, isolationLevel });
    }

    it('на read-uncommitted даёт все три аномалии как оценку сверху', () => {
        const result = run(withIsolation('read-uncommitted'));
        const codes = codesOf(result);

        expect(codes).toContain('dirty-read');
        expect(codes).toContain('non-repeatable-read');
        expect(codes).toContain('phantom-read');

        for (const code of ['dirty-read', 'non-repeatable-read', 'phantom-read']) {
            const [anomaly] = anomaliesOf(result, code);

            expect(anomaly.upperBound).toBe(true);
            expect(anomaly.ratePerSec).toBeGreaterThan(0);
            expect(anomaly.explain.formula.startsWith('≤')).toBe(true);
            expect(anomaly.explain.inputs.isolationLevel).toBe('read-uncommitted');
        }
    });

    it('на read-committed убирает только грязное чтение', () => {
        const codes = codesOf(run(withIsolation('read-committed')));

        expect(codes).not.toContain('dirty-read');
        expect(codes).toContain('non-repeatable-read');
        expect(codes).toContain('phantom-read');
    });

    it('на repeatable-read оставляет только фантомы', () => {
        const codes = codesOf(run(withIsolation('repeatable-read')));

        expect(codes).not.toContain('dirty-read');
        expect(codes).not.toContain('non-repeatable-read');
        expect(codes).toContain('phantom-read');
    });

    for (const isolationLevel of ['snapshot', 'serializable']) {
        it(`на ${isolationLevel} не даёт ни одной аномалии изоляции`, () => {
            const codes = codesOf(run(withIsolation(isolationLevel)));

            expect(codes).not.toContain('dirty-read');
            expect(codes).not.toContain('non-repeatable-read');
            expect(codes).not.toContain('phantom-read');
        });
    }

    it('растёт с концентрацией записей на строке', () => {
        const spread = rateOf(run(storeScheme({ ...contended, rowCount: 10000 })), 'phantom-read');
        const narrow = rateOf(run(storeScheme({ ...contended, rowCount: 100 })), 'phantom-read');

        expect(narrow).toBeGreaterThan(spread);
    });

    it('считается детерминированно', () => {
        const first = run(withIsolation('read-uncommitted'));
        const second = run(withIsolation('read-uncommitted'));

        expect(rateOf(second, 'dirty-read')).toBe(rateOf(first, 'dirty-read'));
        expect(rateOf(second, 'phantom-read')).toBe(rateOf(first, 'phantom-read'));
    });
});

describe('локализация новых аномалий', () => {
    it('каждый новый код переведён и как заголовок, и как находка', () => {
        for (const code of NEW_CODES) {
            expect(ruCommon.anomaly, `ru: anomaly.${code}`).toHaveProperty(code);
            expect(enCommon.anomaly, `en: anomaly.${code}`).toHaveProperty(code);
            expect(ruCommon.findings, `ru: findings.anomaly-${code}`).toHaveProperty(`anomaly-${code}`);
            expect(enCommon.findings, `en: findings.anomaly-${code}`).toHaveProperty(`anomaly-${code}`);
        }
    });

    it('пометка «оценка сверху» переведена на оба языка', () => {
        expect(ruCommon.anomaly).toHaveProperty('upperBound');
        expect(enCommon.anomaly).toHaveProperty('upperBound');
    });
});
