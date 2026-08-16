import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';
import type { ComponentDefinition, ComponentParams } from '../../src/engine/types/component';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 20;

const PRICE = /cost/i;

const FREE_BY_DESIGN = new Set(['local-cache']);

function specFor(type: string, params: ComponentParams | undefined, direct: boolean): SchemeSpec {
    const block = { id: 'block', type, ...(params ? { params } : {}) };

    if (direct) {
        return {
            nodes: [{ id: 'client', type: 'client-web' }, block],
            links: [{ from: 'client', to: 'block' }],
        };
    }

    return {
        nodes: [{ id: 'client', type: 'client-web' }, { id: 'api', type: 'service' }, block],
        links: [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'block' },
        ],
    };
}

function costOf(type: string, params: ComponentParams | undefined, direct: boolean): number | null {
    try {
        return simulate(buildScheme(specFor(type, params, direct)), { sampleCount: SAMPLES }).totals.costMonth;
    } catch {
        return null;
    }
}

function placed(type: string): boolean | null {
    if (costOf(type, undefined, true) !== null) return true;
    if (costOf(type, undefined, false) !== null) return false;

    return null;
}

function carriesTraffic(definition: ComponentDefinition): boolean {
    return definition.shape === 'node' && definition.model !== undefined;
}

describe('стоимость блоков', () => {
    it('есть у каждого блока, который несёт трафик', () => {
        const free = registry
            .list()
            .filter(carriesTraffic)
            .filter((definition) => !definition.model?.cost)
            .map((definition) => definition.id)
            .filter((id) => !FREE_BY_DESIGN.has(id));

        expect(free).toEqual([]);
    });

    it('положительна у каждого блока под нагрузкой', () => {
        const free: string[] = [];

        for (const definition of registry.list().filter(carriesTraffic)) {
            if (FREE_BY_DESIGN.has(definition.id)) continue;

            const direct = placed(definition.id);
            if (direct === null) continue;

            const cost = costOf(definition.id, undefined, direct) ?? 0;
            if (cost <= 0) free.push(definition.id);
        }

        expect(free).toEqual([]);
    });

    it('каждый объявленный ценник участвует в счёте схемы', () => {
        const dead: string[] = [];

        for (const definition of registry.list().filter(carriesTraffic)) {
            const direct = placed(definition.id);
            if (direct === null) continue;

            const defaults = registry.getDefaultParams(definition.id);
            const base = costOf(definition.id, undefined, direct);
            if (base === null) continue;

            for (const [key, value] of Object.entries(defaults)) {
                if (!PRICE.test(key) || typeof value !== 'number' || value <= 0) continue;
                if (key === 'costPerGbEgress' && !direct) continue;

                const grown = costOf(definition.id, { [key]: value * 2 }, direct);
                if (grown !== null && Math.abs(grown - base) < 1e-9) dead.push(`${definition.id}/${key}`);
            }
        }

        expect(dead).toEqual([]);
    });

    it('выделенные IOPS платит каждый блок, который их объявил', () => {
        const dead: string[] = [];

        for (const definition of registry.list().filter(carriesTraffic)) {
            const defaults = registry.getDefaultParams(definition.id);
            if (typeof defaults.provisionedIops !== 'number') continue;

            const direct = placed(definition.id);
            if (direct === null) continue;

            const base = costOf(definition.id, undefined, direct);
            const grown = costOf(definition.id, { provisionedIops: defaults.provisionedIops * 2 }, direct);
            if (base === null || grown === null) continue;

            if (grown <= base) dead.push(definition.id);
        }

        expect(dead.length).toBe(0);
    });
});
