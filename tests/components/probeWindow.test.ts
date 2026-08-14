import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { simulate } from '../../src/engine/sim/simulate';
import type { ProbeReading, SimResult } from '../../src/engine/sim/types';
import en from '../../src/locales/en/common.json';
import ru from '../../src/locales/ru/common.json';
import { layoutWaterfall } from '../../src/utils/waterfall';
import type { LinkSpec, NodeSpec } from '../helpers/scheme';
import { buildScheme } from '../helpers/scheme';

const SAMPLES = 600;

const NODES: NodeSpec[] = [
    { id: 'client', type: 'client-web' },
    { id: 'lb', type: 'lb-l7' },
    { id: 'svc', type: 'service' },
    { id: 'db', type: 'postgres' },
    { id: 'p-rps', type: 'probe-rps' },
    { id: 'p-utilization', type: 'probe-utilization' },
    { id: 'p-cost', type: 'probe-cost' },
    { id: 'p-waterfall', type: 'probe-waterfall' },
    { id: 'p-storage', type: 'probe-storage' },
    { id: 'p-orphan', type: 'probe-latency' },
];

const LINKS: LinkSpec[] = [
    { from: 'client', to: 'lb' },
    { from: 'lb', to: 'svc' },
    { from: 'svc', to: 'db' },
    { from: 'svc', to: 'p-rps' },
    { from: 'svc', to: 'p-utilization' },
    { from: 'svc', to: 'p-cost' },
    { from: 'svc', to: 'p-waterfall' },
    { from: 'lb', to: 'p-storage' },
];

let result: SimResult;

beforeAll(() => {
    registry.reset();
    initComponents();
    result = simulate(buildScheme({ nodes: NODES, links: LINKS }), { sampleCount: SAMPLES });
});

function readings(): ProbeReading[] {
    return Object.values(result.probes);
}

function hasKey(dictionary: Record<string, unknown>, path: string): boolean {
    return path.split('.').reduce<unknown>((node, key) => {
        if (typeof node !== 'object' || node === null) return undefined;
        return (node as Record<string, unknown>)[key];
    }, dictionary) !== undefined;
}

describe('окно измерителя', () => {
    it('получает показание для каждой пробы схемы', () => {
        const probeIds = NODES.filter((node) => node.type.startsWith('probe-')).map((node) => node.id);
        expect(Object.keys(result.probes).sort()).toEqual([...probeIds].sort());
    });

    it('переводит единицу, статус и причину каждого показания на оба языка', () => {
        const missing: string[] = [];

        for (const reading of readings()) {
            const keys = [`probe.unit.${reading.unit}`, `probe.status.${reading.status}`];
            if (reading.reason) keys.push(`probe.reason.${reading.reason}`);

            for (const key of keys) {
                if (!hasKey(ru, key)) missing.push(`ru: ${key}`);
                if (!hasKey(en, key)) missing.push(`en: ${key}`);
            }
        }

        expect(missing).toEqual([]);
    });

    it('всегда даёт окну формулу и хотя бы один вход', () => {
        for (const reading of readings()) {
            expect(reading.explain.formula.length, reading.probeId).toBeGreaterThan(0);
            if (reading.status === 'no-data') continue;
            expect(Object.keys(reading.explain.inputs).length, reading.probeId).toBeGreaterThan(0);
        }
    });

    it('непривязанная проба объясняет причину вместо числа', () => {
        const orphan = result.probes['p-orphan'];

        expect(orphan.status).toBe('no-data');
        expect(orphan.reason).toBe('unattached');
        expect(Number.isNaN(orphan.value)).toBe(true);
    });

    it('водопадная проба ведёт на поток, который есть в результате', () => {
        const probe = result.probes['p-waterfall'];
        const waterfall = result.waterfalls.find((item) => item.flowId === probe.flowId);

        expect(probe.flowId).not.toBeNull();
        expect(waterfall).toBeDefined();
        expect(waterfall?.hops.length).toBeGreaterThan(0);
    });

    it('раскладывает водопад реальной схемы без выхода за край', () => {
        const waterfall = result.waterfalls[0];
        const layout = layoutWaterfall(waterfall, 'p99', 12);

        expect(layout.bars.length).toBeGreaterThan(0);
        for (const bar of layout.bars) {
            expect(bar.offsetPercent).toBeGreaterThanOrEqual(0);
            expect(bar.offsetPercent + bar.widthPercent).toBeLessThanOrEqual(100.001);
        }
    });
});
