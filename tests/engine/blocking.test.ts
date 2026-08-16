import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { ComponentParams } from '../../src/engine/types/component';
import type { NodeSpec } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;
const POOL = 4 * 100;

function api(params: ComponentParams = {}): NodeSpec {
    return {
        id: 'api',
        type: 'service',
        params: {
            autoscale: false,
            instances: 4,
            serviceTimeMs: 10,
            concurrencyPerInstance: 100,
            ...params,
        },
    };
}

function db(id: string, serviceMs: number): NodeSpec {
    return { id, type: 'postgres', params: { readServiceMs: serviceMs, writeServiceMs: serviceMs } };
}

function client(): NodeSpec {
    return { id: 'client', type: 'client-web', params: { requestsPerSession: 1, dau: 2_000_000 } };
}

function runApi(nodes: NodeSpec[], links: { from: string; to: string }[]) {
    return simulate(buildScheme({ nodes, links }), { sampleCount: SAMPLES }).nodes.api;
}

function chain(serviceMs: number, params: ComponentParams = {}) {
    return runApi([client(), api(params), db('db', serviceMs)], [
        { from: 'client', to: 'api' },
        { from: 'api', to: 'db' },
    ]);
}

function fanout(callMode: string) {
    return runApi([client(), api({ callMode }), db('db1', 100), db('db2', 100)], [
        { from: 'client', to: 'api' },
        { from: 'api', to: 'db1' },
        { from: 'api', to: 'db2' },
    ]);
}

describe('медленная зависимость занимает пул вызывающего', () => {
    it('быстрая зависимость не становится ограничителем', () => {
        const fast = chain(1);

        expect(fast.blockingSec).toBeGreaterThan(0);
        expect(fast.blockingSec).toBeLessThan(0.005);
        expect(fast.boundBy).toBe('cpu');
    });

    it('медленная зависимость становится ограничителем и режет ёмкость', () => {
        const fast = chain(1);
        const slow = chain(50);

        expect(slow.blockingSec).toBeGreaterThan(0.045);
        expect(slow.boundBy).toBe('blocking');
        expect(slow.capacity).toBeLessThan(fast.capacity);
    });

    it('ёмкость равна пулу, делённому на своё время плюс ожидание', () => {
        const slow = chain(50);

        expect(slow.capacity).toBeCloseTo(POOL / (0.01 + slow.blockingSec), 3);
    });

    it('ожидание зависимости не превышает таймаута вызова', () => {
        const slow = chain(5000);

        expect(slow.blockingSec).toBeLessThanOrEqual(1.001);
    });

    it('асинхронный вызов не держит пул', () => {
        const async = runApi([client(), api(), { id: 'bus', type: 'kafka' }], [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'bus' },
        ]);

        expect(async.blockingSec).toBe(0);
        expect(async.boundBy).toBe('cpu');
    });

    it('параллельный веер держит пул по самому долгому вызову, а не по сумме', () => {
        const sequential = fanout('sequential');
        const parallel = fanout('parallel');

        expect(parallel.blockingSec).toBeLessThan(sequential.blockingSec);
        expect(parallel.capacity).toBeGreaterThan(sequential.capacity);
        expect(parallel.boundBy).toBe('blocking');
    });

    it('ограничение появляется только у блоков с объявленным пулом', () => {
        const result = simulate(
            buildScheme({
                nodes: [client(), api(), db('db', 50)],
                links: [
                    { from: 'client', to: 'api' },
                    { from: 'api', to: 'db' },
                ],
            }),
            { sampleCount: SAMPLES },
        );

        expect(result.nodes.db.boundBy).not.toBe('blocking');
        expect(result.nodes.client.boundBy).not.toBe('blocking');
    });
});
