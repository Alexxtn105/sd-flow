import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { cacheHitRatio, residencyRatio, ttlAwareRatio } from '../../src/engine/sim/cacheModel';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { ComponentParams } from '../../src/engine/types/component';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;

describe('TTL считается по тому же Ципфу, что и попадание', () => {
    it('кэш, вмещающий всё, не обнуляется коротким TTL', () => {
        expect(ttlAwareRatio(1e7, 1e7, 1, 694, 300)).toBeGreaterThan(0.6);
        expect(ttlAwareRatio(1e7, 1e7, 1, 694, 300)).toBeLessThan(0.75);
    });

    it('растёт с TTL и упирается в долю поместившегося', () => {
        const ladder = [1, 10, 60, 300, 3600, 86400].map((ttl) => ttlAwareRatio(1e7, 1e7, 1, 694, ttl));

        for (let index = 1; index < ladder.length; index += 1) {
            expect(ladder[index]).toBeGreaterThan(ladder[index - 1]);
        }

        expect(ladder[ladder.length - 1]).toBeLessThanOrEqual(1);
        expect(ttlAwareRatio(1e7, 1e6, 1, 694, 1e9)).toBeCloseTo(residencyRatio(1e7, 1e6, 1), 3);
    });

    it('скошенность популярности спасает от TTL, равномерность — нет', () => {
        expect(ttlAwareRatio(1e7, 1e7, 1.3, 694, 300)).toBeGreaterThan(0.9);
        expect(ttlAwareRatio(1e7, 1e7, 0.6, 694, 300)).toBeLessThan(0.2);
    });

    it('без TTL остаётся ципфовская доля', () => {
        expect(ttlAwareRatio(1e7, 1e6, 1, 694, 0)).toBeCloseTo(residencyRatio(1e7, 1e6, 1), 6);
    });

    it('кэш, вмещающий всё, при живом трафике и большом TTL даёт почти единицу', () => {
        const result = cacheHitRatio(
            { capacityBytes: 1e12, entryBytes: 1000, uniqueKeys: 1000, zipfAlpha: 1, ttlSec: 3600 },
            0,
            1000,
        );

        expect(result.hitRatio).toBeGreaterThan(0.99);
    });
});

describe('показанный hit ratio совпадает с поглощением', () => {
    function originLoad(params: ComponentParams): { shown: number; origin: number } {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'cache', type: 'reverse-cache', params },
                { id: 'origin', type: 'service' },
            ],
            links: [
                { from: 'client', to: 'cache' },
                { from: 'cache', to: 'origin' },
            ],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });

        return { shown: result.nodes.cache.hitRatio ?? 0, origin: result.nodes.origin.throughput };
    }

    it('ручной режим: ползунок меняет и число, и трафик', () => {
        const high = originLoad({ hitRatioOverride: 0.99 });
        const low = originLoad({ hitRatioOverride: 0.2 });

        expect(high.shown).toBeCloseTo(0.99, 6);
        expect(low.shown).toBeCloseTo(0.2, 6);
        expect(low.origin).toBeGreaterThan(high.origin * 3);
    });

    it('авто-режим: поглощение идёт по посчитанной доле', () => {
        const auto = originLoad({ hitRatioMode: 'auto' });
        const manual = originLoad({ hitRatioMode: 'manual', hitRatioOverride: auto.shown });

        expect(auto.shown).toBeGreaterThan(0);
        expect(auto.origin).toBeCloseTo(manual.origin, 6);
    });
});
