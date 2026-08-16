import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { quorumAvailability } from '../../src/engine/sim/availability';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { NodeSpec, LinkSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 500;

function scheme(nodes: NodeSpec[], links: LinkSpec[]) {
    return buildScheme({ nodes, links });
}

describe('резервированная группа «k из n»', () => {
    it('совпадает с биномиальной суммой из §10', () => {
        expect(quorumAvailability(0.99, 3, 1)).toBeCloseTo(1 - 0.01 ** 3, 10);
        expect(quorumAvailability(0.99, 3, 2)).toBeCloseTo(3 * 0.99 ** 2 * 0.01 + 0.99 ** 3, 10);
        expect(quorumAvailability(0.99, 3, 3)).toBeCloseTo(0.99 ** 3, 10);
    });

    it('кворум строго хуже, чем «жив хотя бы один»', () => {
        expect(quorumAvailability(0.999, 5, 3)).toBeLessThan(quorumAvailability(0.999, 5, 1));
        expect(quorumAvailability(0.999, 5, 3)).toBeGreaterThan(quorumAvailability(0.999, 5, 5));
    });

    it('кворумному хранилищу лишние узлы помогают, а не мешают', () => {
        const three = simulate(
            scheme(
                [
                    { id: 'client', type: 'client-web' },
                    { id: 'svc', type: 'service' },
                    { id: 'store', type: 'etcd', params: { nodes: 3 } },
                ],
                [
                    { from: 'client', to: 'svc' },
                    { from: 'svc', to: 'store' },
                ],
            ),
            { sampleCount: SAMPLES },
        );

        const five = simulate(
            scheme(
                [
                    { id: 'client', type: 'client-web' },
                    { id: 'svc', type: 'service' },
                    { id: 'store', type: 'etcd', params: { nodes: 5 } },
                ],
                [
                    { from: 'client', to: 'svc' },
                    { from: 'svc', to: 'store' },
                ],
            ),
            { sampleCount: SAMPLES },
        );

        expect(five.nodes.store.availability).toBeGreaterThan(three.nodes.store.availability);
        expect(three.nodes.store.availability).toBeLessThan(1);
    });
});

describe('переключение на резерв', () => {
    it('стоит доступности: медленный failover опускает девятки', () => {
        const build = (failoverSec: number) =>
            simulate(
                scheme(
                    [
                        { id: 'client', type: 'client-web' },
                        { id: 'svc', type: 'service' },
                        { id: 'db', type: 'postgres', params: { readReplicas: 2, failoverSec } },
                    ],
                    [
                        { from: 'client', to: 'svc' },
                        { from: 'svc', to: 'db' },
                    ],
                ),
                { sampleCount: SAMPLES },
            );

        const quick = build(15);
        const slow = build(600);

        expect(slow.nodes.db.availability).toBeLessThan(quick.nodes.db.availability);
        expect(quick.nodes.db.availability - slow.nodes.db.availability).toBeCloseTo(
            (2 * (600 - 15)) / 31_536_000,
            9,
        );
    });

    it('одиночный блок ничего не переключает и штрафа не получает', () => {
        const result = simulate(
            scheme(
                [
                    { id: 'client', type: 'client-web' },
                    { id: 'svc', type: 'service' },
                    { id: 'db', type: 'postgres', params: { readReplicas: 0 } },
                ],
                [
                    { from: 'client', to: 'svc' },
                    { from: 'svc', to: 'db' },
                ],
            ),
            { sampleCount: SAMPLES },
        );

        const declared = Number(registry.getDefaultParams('postgres').availability);
        expect(result.nodes.db.availability).toBeCloseTo(declared, 10);
    });
});

describe('последовательные и резервированные участки', () => {
    it('две ветки за балансировщиком дают резерв, а не произведение', () => {
        const single = simulate(
            scheme(
                [
                    { id: 'client', type: 'client-web' },
                    { id: 'lb', type: 'lb-l7' },
                    { id: 'svc-a', type: 'service' },
                ],
                [
                    { from: 'client', to: 'lb' },
                    { from: 'lb', to: 'svc-a' },
                ],
            ),
            { sampleCount: SAMPLES },
        );

        const pair = simulate(
            scheme(
                [
                    { id: 'client', type: 'client-web' },
                    { id: 'lb', type: 'lb-l7' },
                    { id: 'svc-a', type: 'service' },
                    { id: 'svc-b', type: 'service' },
                ],
                [
                    { from: 'client', to: 'lb' },
                    { from: 'lb', to: 'svc-a' },
                    { from: 'lb', to: 'svc-b' },
                ],
            ),
            { sampleCount: SAMPLES },
        );

        expect(pair.totals.availability).toBeGreaterThan(single.totals.availability);
    });

    it('цепочка вызовов по-прежнему перемножается', () => {
        const result = simulate(
            scheme(
                [
                    { id: 'client', type: 'client-web' },
                    { id: 'svc', type: 'service' },
                    { id: 'db', type: 'postgres' },
                ],
                [
                    { from: 'client', to: 'svc' },
                    { from: 'svc', to: 'db' },
                ],
            ),
            { sampleCount: SAMPLES },
        );

        expect(result.totals.availability).toBeCloseTo(
            result.nodes.svc.availability * result.nodes.db.availability,
            10,
        );
    });
});
