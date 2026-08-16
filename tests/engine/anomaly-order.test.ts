import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { sampleGroups } from '../../src/data/sampleSchemes';
import { buildScheme } from '../helpers/scheme';
import type { SimResult } from '../../src/engine/sim/types';
import type { SchemeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;

function rateOf(result: SimResult, code: string): number {
    return result.consistency.anomalies
        .filter((anomaly) => anomaly.code === code)
        .reduce((sum, anomaly) => sum + anomaly.ratePerSec, 0);
}

function lagging(): SchemeSpec {
    return {
        nodes: [
            { id: 'client', type: 'client-web', params: { readWriteMix: 0.5 } },
            { id: 'api', type: 'service' },
            {
                id: 'db',
                type: 'postgres',
                params: { replicaLagMs: 500, readReplicas: 2, readFromReplica: 0.9, rowCount: 10000 },
            },
        ],
        links: [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'db' },
        ],
    };
}

describe('чтение своей записи — частный случай устаревшего чтения', () => {
    it('A2 никогда не больше A1 на минимальной схеме', () => {
        const result = simulate(buildScheme(lagging()), { sampleCount: SAMPLES });

        expect(rateOf(result, 'read-your-writes')).toBeGreaterThan(0);
        expect(rateOf(result, 'stale-read')).toBeGreaterThanOrEqual(rateOf(result, 'read-your-writes'));
    });

    it('A2 никогда не больше A1 на всём каталоге', () => {
        for (const group of sampleGroups()) {
            for (const sample of group.items) {
                const result = simulate(sample.build(), { sampleCount: 50 });

                expect(rateOf(result, 'stale-read') + 1e-9).toBeGreaterThanOrEqual(
                    rateOf(result, 'read-your-writes'),
                );
            }
        }
    }, 120_000);
});

describe('RPO не превышает окна разрыва', () => {
    it('split-brain теряет не больше, чем записано за разрыв', () => {
        const sample = sampleGroups()
            .flatMap((group) => group.items)
            .find((item) => item.id === 'reference:multi-region:last-write-wins');

        const baseline = simulate(sample!.build(), { sampleCount: SAMPLES, scenario: 'baseline' });
        const partitioned = simulate(sample!.build(), { sampleCount: SAMPLES, scenario: 'split-brain' });

        expect(baseline.multiRegion?.rpoSec).toBeLessThan(10);
        expect(partitioned.multiRegion?.rpoSec).toBeLessThanOrEqual(120);
        expect(partitioned.multiRegion?.rpoSec).toBeGreaterThan(baseline.multiRegion!.rpoSec);
    });
});

describe('сценарии, которые раньше повторяли baseline', () => {
    it('write-conflict сгущает записи на ключах и поднимает конфликты', () => {
        const spec = lagging();
        const scheme = buildScheme({
            ...spec,
            nodes: spec.nodes.map((node) =>
                node.id === 'db'
                    ? { ...node, params: { ...node.params, concurrencyControl: 'none' } }
                    : node,
            ),
        });
        const baseline = simulate(scheme, { sampleCount: SAMPLES, scenario: 'baseline' });
        const conflict = simulate(scheme, { sampleCount: SAMPLES, scenario: 'write-conflict' });

        expect(rateOf(conflict, 'lost-update')).toBeGreaterThan(rateOf(baseline, 'lost-update'));
    });

    it('poison-message без DLQ останавливает консьюмера, с DLQ — только тормозит', () => {
        function pipeline(dlqEnabled: boolean) {
            return simulate(
                buildScheme({
                    nodes: [
                        { id: 'client', type: 'client-web' },
                        { id: 'api', type: 'service' },
                        { id: 'queue', type: 'kafka' },
                        { id: 'worker', type: 'worker', params: { dlqEnabled } },
                    ],
                    links: [
                        { from: 'client', to: 'api' },
                        { from: 'api', to: 'queue' },
                        { from: 'queue', to: 'worker' },
                    ],
                }),
                { sampleCount: SAMPLES, scenario: 'poison-message' },
            );
        }

        const stalled = pipeline(false);
        const protectedRun = pipeline(true);

        expect(stalled.nodes.worker.throughput).toBe(0);
        expect(stalled.nodes.worker.errorRate).toBe(1);
        expect(protectedRun.nodes.worker.throughput).toBeGreaterThan(0);
    });
});
