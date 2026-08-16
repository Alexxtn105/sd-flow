import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';
import type { NodeContext } from '../../src/engine/types/component';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const MIXES = [
    { readShare: 1, writeShare: 0 },
    { readShare: 0.8, writeShare: 0.2 },
    { readShare: 0, writeShare: 1 },
];

function contextFor(type: string, mix: { readShare: number; writeShare: number }): NodeContext {
    const params = registry.getDefaultParams(type);

    return {
        nodeId: `${type}-probe`,
        params,
        instances: typeof params.instances === 'number' ? params.instances : 1,
        lambda: 5000,
        readShare: mix.readShare,
        writeShare: mix.writeShare,
        requestBytes: 2000,
        responseBytes: 20000,
        blockingSec: 0,
    };
}

function modelledTypes(): string[] {
    return registry
        .list()
        .filter((definition) => definition.shape === 'node' && definition.group !== 'clients')
        .map((definition) => definition.id);
}

function resourceNames(): Set<string> {
    const names = new Set<string>(['source', 'unmodelled', 'unbounded', 'disabled']);

    for (const type of modelledTypes()) {
        const model = registry.get(type)?.model;
        if (!model) continue;

        for (const mix of MIXES) {
            const result = model.capacity(contextFor(type, mix));
            names.add(result.boundBy);
            for (const limit of result.limits) names.add(limit.resource);
        }
    }

    return names;
}

describe('ядро ёмкости', () => {
    it('модель задана у каждого блока MVP, несущего трафик', () => {
        const missing = modelledTypes().filter((type) => !registry.get(type)?.model);
        expect(missing).toEqual([]);
    });

    it('каждый ограничитель ёмкости переведён на оба языка', () => {
        const names = [...resourceNames()].sort();
        const ru = Object.keys(ruCommon.bound ?? {});
        const en = Object.keys(enCommon.bound ?? {});

        expect(names.filter((name) => !ru.includes(name))).toEqual([]);
        expect(names.filter((name) => !en.includes(name))).toEqual([]);
    });

    it('ёмкость положительна и объяснима при любой смеси чтения и записи', () => {
        for (const type of modelledTypes()) {
            const model = registry.get(type)?.model;
            if (!model) continue;

            for (const mix of MIXES) {
                const context = contextFor(type, mix);
                const result = model.capacity(context);

                expect(result.capacity, `${type} ${mix.readShare}`).toBeGreaterThan(0);
                expect(result.limits.length, `${type} ${mix.readShare}`).toBeGreaterThan(0);

                for (const limit of result.limits) {
                    expect(limit.explain.formula.length, `${type}/${limit.resource}`).toBeGreaterThan(0);
                    expect(Object.keys(limit.explain.inputs).length, `${type}/${limit.resource}`).toBeGreaterThan(0);
                    expect(Number.isFinite(limit.value), `${type}/${limit.resource}`).toBe(true);
                }

                expect(model.serviceSec(context), type).toBeGreaterThan(0);
            }
        }
    });
});
