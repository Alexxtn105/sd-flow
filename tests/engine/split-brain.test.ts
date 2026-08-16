import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import type { AnomalyRate, SimResult } from '../../src/engine/sim/types';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';
import { buildScheme } from '../helpers/scheme';
import type { ComponentParams } from '../../src/engine/types/component';
import type { SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;
const PARTITION_SEC = 120;

function run(spec: SchemeSpec, scenario: string): SimResult {
    return simulate(buildScheme(spec), { sampleCount: SAMPLES, scenario });
}

function anomaliesOf(result: SimResult, code: string): AnomalyRate[] {
    return result.consistency.anomalies.filter((item) => item.code === code);
}

function rateOf(result: SimResult, code: string): number {
    return anomaliesOf(result, code).reduce((sum, item) => sum + item.ratePerSec, 0);
}

function replicatedStore(type: string, params: ComponentParams = {}): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { dau: 2000000, requestsPerSession: 30 } },
            { id: 'api', type: 'service', params: { instances: 40, autoscale: false } },
            { id: 'store', type, params },
        ],
        links: [
            { from: 'client', to: 'api', readShare: 0.5 },
            { from: 'api', to: 'store', readShare: 0.5 },
        ],
    };
}

describe('сценарий split-brain', () => {
    it('разводит реплики: записи идут по обе стороны разрыва', () => {
        const result = run(replicatedStore('postgres'), 'split-brain');
        const [anomaly] = anomaliesOf(result, 'divergent-replicas');

        expect(anomaly).toBeDefined();
        expect(anomaly.nodeIds).toEqual(['store']);
        expect(anomaly.ratePerSec).toBeCloseTo(result.nodes.store.throughput * result.nodes.store.writeShare, 6);
        expect(anomaly.explain.inputs.partitionSec).toBe(PARTITION_SEC);
        expect(anomaly.explain.result).toBeCloseTo(anomaly.ratePerSec * PARTITION_SEC, 6);
        expect(anomaly.explain.unit).toBe('op');
    });

    it('без разрыва расхождения нет', () => {
        for (const scenario of ['baseline', 'peak', 'write-conflict']) {
            expect(anomaliesOf(run(replicatedStore('postgres'), scenario), 'divergent-replicas')).toHaveLength(0);
        }
    });

    it('нереплицированное хранилище разъезжаться нечему', () => {
        const result = run(replicatedStore('postgres', { readReplicas: 0 }), 'split-brain');

        expect(anomaliesOf(result, 'divergent-replicas')).toHaveLength(0);
    });

    it('слияние по last-write-wins теряет половину конфликтов', () => {
        const result = run(replicatedStore('postgres', { rowCount: 10000 }), 'split-brain');
        const conflicts = rateOf(result, 'write-conflict');
        const lost = rateOf(result, 'lost-write-lww');

        expect(conflicts).toBeGreaterThan(0);
        expect(lost).toBeCloseTo(conflicts * 0.5, 9);
    });

    it('конфликтов при разрыве больше, чем при обычном отставании реплик', () => {
        const scheme = replicatedStore('postgres', { rowCount: 10000 });

        expect(rateOf(run(scheme, 'split-brain'), 'write-conflict')).toBeGreaterThan(
            rateOf(run(scheme, 'write-conflict'), 'write-conflict'),
        );
    });

    it('кворум R + W > N не даёт разъехаться', () => {
        const strong = run(replicatedStore('cassandra'), 'split-brain');
        const weak = run(replicatedStore('cassandra', { quorumR: 1 }), 'split-brain');

        expect(anomaliesOf(strong, 'divergent-replicas')).toHaveLength(0);
        expect(anomaliesOf(weak, 'divergent-replicas').length).toBeGreaterThan(0);
    });

    it('CRDT расходится, но сливается без потери записей', () => {
        const result = run(
            replicatedStore('mongodb', { concurrencyControl: 'crdt', documentCount: 10000 }),
            'split-brain',
        );

        expect(anomaliesOf(result, 'divergent-replicas').length).toBeGreaterThan(0);
        expect(anomaliesOf(result, 'write-conflict')).toHaveLength(0);
        expect(anomaliesOf(result, 'lost-write-lww')).toHaveLength(0);
    });

    it('отставание реплики за разрыв не меньше длительности разрыва', () => {
        const scheme = replicatedStore('postgres');

        expect(rateOf(run(scheme, 'split-brain'), 'stale-read')).toBeGreaterThan(
            rateOf(run(scheme, 'baseline'), 'stale-read'),
        );
    });

    it('таймлайна не даёт: сценарий стационарный', () => {
        expect(run(replicatedStore('postgres'), 'split-brain').timeline).toBeNull();
    });

    it('считается детерминированно', () => {
        const scheme = replicatedStore('postgres');

        expect(rateOf(run(scheme, 'split-brain'), 'divergent-replicas')).toBe(
            rateOf(run(scheme, 'split-brain'), 'divergent-replicas'),
        );
    });

    it('расхождение переведено и как аномалия, и как находка', () => {
        expect(ruCommon.anomaly).toHaveProperty('divergent-replicas');
        expect(enCommon.anomaly).toHaveProperty('divergent-replicas');
        expect(ruCommon.findings).toHaveProperty('anomaly-divergent-replicas');
        expect(enCommon.findings).toHaveProperty('anomaly-divergent-replicas');
    });
});
