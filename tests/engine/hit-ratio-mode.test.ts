import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { resolveHitRatio } from '../../src/engine/sim/cacheModel';
import { clientRpsOf, dauForRps } from '../../src/engine/sim/flows';
import { simulate } from '../../src/engine/sim/simulate';
import type { ComponentParams } from '../../src/engine/types/component';
import type { SimResult } from '../../src/engine/sim/types';
import { buildScheme } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;

function cacheScheme(params: ComponentParams, scenario = 'baseline'): SimResult {
    return simulate(
        buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 1000000, requestsPerSession: 20 } },
                { id: 'api', type: 'service', params: { instances: 30, autoscale: false } },
                { id: 'cache', type: 'redis', params },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'cache' },
                { from: 'api', to: 'db' },
            ],
        }),
        { sampleCount: SAMPLES, scenario },
    );
}

describe('режим hit ratio', () => {
    it('по умолчанию считается моделью и отвечает на её параметры', () => {
        const narrow = cacheScheme({ uniqueKeys: 1e9 }).nodes.cache.hitRatio;
        const wide = cacheScheme({ uniqueKeys: 1e5 }).nodes.cache.hitRatio;

        expect(narrow).not.toBeNull();
        expect(wide).toBeGreaterThan(narrow as number);
    });

    it('ручной режим берёт объявленное число и на параметры модели не смотрит', () => {
        const manual = { hitRatioMode: 'manual', hitRatioOverride: 0.42 };
        const narrow = cacheScheme({ ...manual, uniqueKeys: 1e9 }).nodes.cache.hitRatio;
        const wide = cacheScheme({ ...manual, uniqueKeys: 1e5 }).nodes.cache.hitRatio;

        expect(narrow).toBeCloseTo(0.42, 9);
        expect(wide).toBeCloseTo(0.42, 9);
    });

    it('ручное число снимает нагрузку с хранилища так же, как расчётное', () => {
        const cold = cacheScheme({ hitRatioMode: 'manual', hitRatioOverride: 0.1 }).nodes.db.throughput;
        const warm = cacheScheme({ hitRatioMode: 'manual', hitRatioOverride: 0.95 }).nodes.db.throughput;

        expect(warm).toBeLessThan(cold);
    });

    it('сброс кэша обнуляет и ручной режим тоже', () => {
        const flushed = cacheScheme({ hitRatioMode: 'manual', hitRatioOverride: 0.9 }, 'cache-flush');

        expect(flushed.nodes.cache.hitRatio).toBeNull();
    });

    it('решается чистой функцией: режим, ручное число и прогрев', () => {
        expect(resolveHitRatio({}, 0.7, 1)).toBeCloseTo(0.7, 9);
        expect(resolveHitRatio({ hitRatioMode: 'manual', hitRatioOverride: 0.3 }, 0.7, 1)).toBeCloseTo(0.3, 9);
        expect(resolveHitRatio({ hitRatioMode: 'manual' }, 0.7, 1)).toBeCloseTo(0.7, 9);
        expect(resolveHitRatio({ hitRatioMode: 'auto', hitRatioOverride: 0.3 }, 0.7, 0.5)).toBeCloseTo(0.35, 9);
        expect(resolveHitRatio({ hitRatioMode: 'manual', hitRatioOverride: 5 }, null, 1)).toBe(1);
        expect(resolveHitRatio({}, null, 1)).toBeNull();
    });

    it('кэш на границе умеет и ручное число, и расчётное', () => {
        const scheme = (params: ComponentParams) =>
            simulate(
                buildScheme({
                    nodes: [
                        { id: 'client', type: 'client-web', params: { dau: 500000 } },
                        { id: 'edge', type: 'reverse-cache', params },
                        { id: 'api', type: 'service' },
                    ],
                    links: [
                        { from: 'client', to: 'edge' },
                        { from: 'edge', to: 'api' },
                    ],
                }),
                { sampleCount: SAMPLES },
            );

        const manual = scheme({ cacheHitRatio: 0.5, hitRatioOverride: 0.5 });
        const auto = scheme({ cacheHitRatio: 0.5, hitRatioMode: 'auto', uniqueKeys: 1000 });

        expect(manual.nodes.edge.hitRatio).toBeCloseTo(0.5, 9);
        expect(auto.nodes.edge.hitRatio).toBeGreaterThan(0.5);
        expect(auto.nodes.api.throughput).toBeLessThan(manual.nodes.api.throughput);
    });
});

describe('нагрузка клиента в обе стороны', () => {
    const params = { dau: 864000, sessionsPerUserDay: 2, requestsPerSession: 5 };

    it('считается из DAU, сессий и запросов', () => {
        expect(clientRpsOf('client-web', params)).toBeCloseTo(100, 9);
    });

    it('обратный пересчёт возвращает исходный DAU', () => {
        const rps = clientRpsOf('client-web', params);

        expect(dauForRps(params, rps)).toBeCloseTo(params.dau, 6);
        expect(dauForRps(params, rps * 2)).toBeCloseTo(params.dau * 2, 6);
    });

    it('без сессий и запросов обратного пересчёта нет', () => {
        expect(dauForRps({ dau: 100 }, 10)).toBeNull();
        expect(dauForRps({ ...params, requestsPerSession: 0 }, 10)).toBeNull();
        expect(dauForRps(params, -1)).toBeNull();
    });

    it('клиенты с собственной формулой считаются по ней', () => {
        expect(clientRpsOf('client-api', { clients: 20, rpsPerClient: 5 })).toBe(100);
        expect(clientRpsOf('client-iot', { deviceCount: 6000, reportIntervalSec: 60 })).toBe(100);
    });
});
