import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { tailAtScaleFactor } from '../../src/engine/sim/latency';
import { buildScheme } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 4000;

function fanoutScheme(fanout: number, callMode: string) {
    return buildScheme({
        nodes: [
            { id: 'client', type: 'client-web', params: { requestsPerSession: 1, dau: 200_000 } },
            {
                id: 'api',
                type: 'service',
                params: { autoscale: false, instances: 8, serviceTimeMs: 5, callMode, serviceTimeSigma: 0.6 },
            },
            { id: 'shard', type: 'postgres', params: { readServiceMs: 5, writeServiceMs: 5 } },
        ],
        links: [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'shard', calls: { fanout } },
        ],
    });
}

function p99(fanout: number, callMode: string): number {
    return simulate(fanoutScheme(fanout, callMode), { sampleCount: SAMPLES }).flows[0].latency.p99;
}

describe('поправка на порядковую статистику при большом веере', () => {
    it('множитель растёт с числом невыбранных вызовов и равен единице без них', () => {
        const sample = [0.01, 0.02, 0.015, 0.03, 0.012, 0.04, 0.02, 0.05];

        expect(tailAtScaleFactor(sample, 8, 8)).toBe(1);
        expect(tailAtScaleFactor(sample, 64, 8)).toBeGreaterThan(1);
        expect(tailAtScaleFactor(sample, 512, 8)).toBeGreaterThan(tailAtScaleFactor(sample, 64, 8));
    });

    it('одинаковые плечи хвост не удлиняют: без разброса поправки нет', () => {
        expect(tailAtScaleFactor([0.02, 0.02, 0.02, 0.02], 400, 4)).toBe(1);
    });

    it('разброс плеч ограничен сверху, чтобы шум выборки не раздувал хвост', () => {
        const wild = [1e-6, 1, 1e-6, 1, 1e-6, 1];
        const factor = tailAtScaleFactor(wild, 1024, 6);

        expect(factor).toBeLessThan(Math.exp(2 * Math.sqrt(2 * Math.log(1024))));
    });

    it('параллельный веер за пределом выборки удлиняет p99', () => {
        const sampled = p99(16, 'parallel');
        const beyond = p99(256, 'parallel');

        expect(beyond).toBeGreaterThan(sampled);
    });

    it('последовательный веер по-прежнему масштабируется суммой', () => {
        const short = p99(16, 'sequential');
        const long = p99(64, 'sequential');

        expect(long).toBeGreaterThan(short * 2);
    });
});
