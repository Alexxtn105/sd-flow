import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';

beforeAll(() => {
    initComponents();
});

function transientScheme() {
    return buildScheme({
        nodes: [
            { id: 'client', type: 'client-web', params: { peakFactor: 6 } },
            {
                id: 'service',
                type: 'service',
                params: {
                    instances: 1,
                    autoscale: true,
                    autoscaleMax: 20,
                    autoscaleTargetUtilization: 0.65,
                    scaleUpLagSec: 60,
                    scaleDownLagSec: 300,
                },
            },
        ],
        links: [{ from: 'client', to: 'service' }],
    });
}

describe('transient-симуляция', () => {
    it('детерминированно строит временную шкалу всплеска', () => {
        const first = simulate(transientScheme(), { scenario: 'black-friday', sampleCount: 200 });
        const second = simulate(transientScheme(), { scenario: 'black-friday', sampleCount: 200 });

        expect(first.transient).not.toBeNull();
        expect(first.transient).toEqual(second.transient);
        expect(first.transient?.points[0].multiplier).toBe(1);
        expect(Math.max(...(first.transient?.points.map((point) => point.multiplier) ?? []))).toBe(6);
    });

    it('показывает очередь во время лага автоскейлинга и её дренаж', () => {
        const result = simulate(transientScheme(), { scenario: 'black-friday', sampleCount: 200 });
        const points = result.transient?.points ?? [];
        const peakQueue = Math.max(...points.map((point) => point.queueDepth));
        const peakInstances = Math.max(
            ...points.flatMap((point) => point.nodes.filter((node) => node.nodeId === 'service').map((node) => node.activeInstances)),
        );

        expect(peakQueue).toBeGreaterThan(0);
        expect(peakInstances).toBeGreaterThan(result.nodes.service.instances);
        expect(points.at(-1)?.queueDepth).toBe(0);
    });

    it('моделирует прогрев кэша после сброса', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'service', type: 'service' },
                { id: 'cache', type: 'redis', params: { ttlSec: 120 } },
            ],
            links: [
                { from: 'client', to: 'service' },
                { from: 'service', to: 'cache' },
            ],
        });
        const points = simulate(scheme, { scenario: 'cache-flush', sampleCount: 200 }).transient?.points ?? [];

        expect(points[0].cacheWarmth).toBe(0);
        expect(points[4].cacheWarmth).toBeGreaterThan(points[1].cacheWarmth);
        expect(points.at(-1)?.cacheWarmth).toBeGreaterThan(0.99);
    });

    it('не добавляет временную шкалу стационарным сценариям', () => {
        expect(simulate(transientScheme(), { scenario: 'baseline', sampleCount: 200 }).transient).toBeNull();
    });
});
