import { describe, expect, it } from 'vitest';
import { cacheHitRatio, generalizedHarmonic } from '../../src/engine/sim/cacheModel';
import { logNormalTail, normalCdf } from '../../src/engine/sim/consistency';
import { createRng } from '../../src/engine/sim/rng';
import { erlangBlocking, retryAmplification, sakasegawaWaitSec, solveQueue } from '../../src/engine/sim/queueing';

const EULER_MASCHERONI = 0.5772156649;

describe('теория очередей', () => {
    it('для M/M/1 совпадает с точной формулой W_q = ρS/(1−ρ)', () => {
        const serviceSec = 0.02;

        for (const rho of [0.1, 0.3, 0.5, 0.7, 0.9]) {
            const exact = (rho * serviceSec) / (1 - rho);
            const approximation = sakasegawaWaitSec(serviceSec, 1, rho);

            expect(Math.abs(approximation - exact) / exact).toBeLessThan(0.05);
        }
    });

    it('при ρ→0 ожидание стремится к нулю', () => {
        expect(sakasegawaWaitSec(0.02, 4, 0.0001)).toBeLessThan(1e-6);
    });

    it('при росте числа приборов ожидание падает', () => {
        const single = sakasegawaWaitSec(0.02, 1, 0.8);
        const many = sakasegawaWaitSec(0.02, 64, 0.8);

        expect(many).toBeLessThan(single);
    });

    it('при ρ→1 ожидание упирается в размер очереди', () => {
        const result = solveQueue({
            lambdaOffered: 1000,
            capacity: 1000.0001,
            servers: 4,
            serviceSec: 0.01,
            arrivalVariability: 1,
            serviceVariability: 1,
            timeoutSec: 1,
            queueLimit: 100,
        });

        expect(result.waitSec).toBeCloseTo(100 / 1000.0001, 5);
    });

    it('сбрасывает избыток нагрузки сверх ёмкости', () => {
        const result = solveQueue({
            lambdaOffered: 2000,
            capacity: 1000,
            servers: 4,
            serviceSec: 0.01,
            arrivalVariability: 1,
            serviceVariability: 1,
            timeoutSec: 1,
            queueLimit: 100,
        });

        expect(result.throughput).toBe(1000);
        expect(result.overflowProbability).toBeCloseTo(0.5, 6);
    });

    it('без очереди теряет запросы по формуле Эрланга B даже ниже насыщения', () => {
        const result = solveQueue({
            lambdaOffered: 300,
            capacity: 400,
            servers: 4,
            serviceSec: 0.01,
            arrivalVariability: 1,
            serviceVariability: 1,
            timeoutSec: 1,
            queueLimit: 0,
        });

        const blocking = erlangBlocking(4, 3);

        expect(blocking).toBeGreaterThan(0.1);
        expect(result.waitSec).toBe(0);
        expect(result.overflowProbability).toBeCloseTo(blocking, 9);
        expect(result.throughput).toBeCloseTo(300 * (1 - blocking), 6);
    });

    it('усиление ретраями растёт с числом попыток и вероятностью отказа', () => {
        expect(retryAmplification(0.2, 0, 0.5)).toBe(0);
        expect(retryAmplification(0.2, 3, 0.5)).toBeGreaterThan(retryAmplification(0.1, 3, 0.5));
        expect(retryAmplification(0.9, 3, 0.5)).toBeCloseTo(0.5 + 0.25 + 0.125, 6);
    });
});

describe('модель кэша', () => {
    it('гармоническое число при α=1 совпадает с ln n + γ', () => {
        const n = 1e9;
        const approximation = Math.log(n) + EULER_MASCHERONI;

        expect(Math.abs(generalizedHarmonic(n, 1) - approximation) / approximation).toBeLessThan(0.01);
    });

    it('кэш, вмещающий все ключи, даёт полное попадание', () => {
        const result = cacheHitRatio(
            { uniqueKeys: 1000, zipfAlpha: 1, entryBytes: 100, capacityBytes: 1e9, ttlSec: 0 },
            0,
            1000,
        );

        expect(result.hitRatio).toBe(1);
    });

    it('воспроизводит табличные значения из документации', () => {
        const profile = { uniqueKeys: 1e9, zipfAlpha: 1, entryBytes: 100, capacityBytes: 1e8, ttlSec: 0 };
        const result = cacheHitRatio(profile, 0, 1000);

        expect(result.hitRatio).toBeGreaterThan(0.63);
        expect(result.hitRatio).toBeLessThan(0.71);
    });

    it('больше памяти — выше hit ratio', () => {
        const small = cacheHitRatio(
            { uniqueKeys: 1e7, zipfAlpha: 1, entryBytes: 1000, capacityBytes: 1e7, ttlSec: 0 },
            0,
            1000,
        );
        const large = cacheHitRatio(
            { uniqueKeys: 1e7, zipfAlpha: 1, entryBytes: 1000, capacityBytes: 1e10, ttlSec: 0 },
            0,
            1000,
        );

        expect(large.hitRatio).toBeGreaterThan(small.hitRatio);
    });

    it('записи снижают эффективный hit ratio', () => {
        const profile = { uniqueKeys: 1e7, zipfAlpha: 1, entryBytes: 1000, capacityBytes: 1e9, ttlSec: 0 };

        expect(cacheHitRatio(profile, 0.3, 1000).hitRatio).toBeLessThan(cacheHitRatio(profile, 0, 1000).hitRatio);
    });
});

describe('распределения', () => {
    it('нормальная функция распределения симметрична', () => {
        expect(normalCdf(0)).toBeCloseTo(0.5, 6);
        expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    });

    it('вероятность превысить медиану логнормального лага равна половине', () => {
        expect(logNormalTail(0.2, 0.2, 0.8)).toBeCloseTo(0.5, 6);
    });

    it('генератор случайных чисел детерминирован по seed', () => {
        const first = createRng(42);
        const second = createRng(42);

        for (let index = 0; index < 100; index += 1) {
            expect(first.next()).toBe(second.next());
        }
    });

    it('логнормальная выборка держит заданную медиану', () => {
        const rng = createRng(7);
        const samples: number[] = [];

        for (let index = 0; index < 20000; index += 1) samples.push(rng.logNormal(0.02, 0.6));
        samples.sort((left, right) => left - right);

        expect(samples[10000]).toBeGreaterThan(0.018);
        expect(samples[10000]).toBeLessThan(0.022);
    });
});
