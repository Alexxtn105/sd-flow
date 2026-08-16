import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { findCeiling } from '../../src/engine/sim/ceiling';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

function threeTier(dau: number) {
    return buildScheme({
        nodes: [
            { id: 'client', type: 'client-web', params: { dau } },
            { id: 'svc', type: 'service' },
            { id: 'db', type: 'postgres' },
        ],
        links: [
            { from: 'client', to: 'svc' },
            { from: 'svc', to: 'db' },
        ],
    });
}

describe('поиск потолка', () => {
    it('находит нагрузку насыщения и называет узел с ограничителем', () => {
        const scheme = threeTier(2_000_000);
        const ceiling = findCeiling(scheme);

        expect(ceiling).not.toBeNull();
        expect(ceiling?.saturated).toBe(true);
        expect(ceiling?.rps).toBeGreaterThan(ceiling?.baselineRps ?? 0);
        expect(ceiling?.nodeId).toBe('db');
        expect(ceiling?.boundBy).toBe('iops');
        expect(ceiling?.multiplier).toBeGreaterThan(1);
    });

    it('на потолке схема ещё жива, а чуть выше — уже нет', () => {
        const scheme = threeTier(2_000_000);
        const ceiling = findCeiling(scheme);
        const factor = ceiling?.multiplier ?? 1;
        const dau = 2_000_000 * factor;

        const atCeiling = simulate(threeTier(dau), { sampleCount: 500 });
        const above = simulate(threeTier(dau * 1.25), { sampleCount: 500 });

        const worst = (result: ReturnType<typeof simulate>) =>
            Math.max(...Object.values(result.nodes).map((node) => node.utilization));

        expect(worst(atCeiling)).toBeLessThanOrEqual(1);
        expect(worst(above)).toBeGreaterThan(1);
    });

    it('потолок не зависит от того, сколько трафика подано сейчас', () => {
        const small = findCeiling(threeTier(200_000));
        const large = findCeiling(threeTier(2_000_000));

        expect(small?.nodeId).toBe(large?.nodeId);
        expect(small?.rps).toBeGreaterThan(0);
        expect(Math.abs((small?.rps ?? 0) - (large?.rps ?? 0)) / (large?.rps ?? 1)).toBeLessThan(0.02);
    });

    it('одинаковая схема даёт одинаковый ответ', () => {
        const first = findCeiling(threeTier(2_000_000));
        const second = findCeiling(threeTier(2_000_000));

        expect(second).toEqual(first);
    });

    it('на схеме без трафика потолка нет', () => {
        const scheme = buildScheme({ nodes: [{ id: 'svc', type: 'service' }], links: [] });
        expect(findCeiling(scheme)).toBeNull();
    });

    it('считает потолок для выбранного сценария, а не только для baseline', () => {
        const scheme = threeTier(2_000_000);
        const baseline = findCeiling(scheme, { scenario: 'baseline' });
        const peak = findCeiling(scheme, { scenario: 'peak' });

        expect(peak?.scenario).toBe('peak');
        expect(peak?.rps).toBeGreaterThan(0);
        expect(Math.abs((peak?.rps ?? 0) - (baseline?.rps ?? 0)) / (baseline?.rps ?? 1)).toBeLessThan(0.05);
    });
});
