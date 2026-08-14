import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { simulate } from '../../src/engine/sim/simulate';
import type { ProbeHeatmap, SimResult } from '../../src/engine/sim/types';
import type { LinkSpec, NodeSpec } from '../helpers/scheme';
import { buildScheme } from '../helpers/scheme';

const SAMPLES = 1000;

const NODES: NodeSpec[] = [
    { id: 'client', type: 'client-web' },
    { id: 'lb', type: 'lb-l7' },
    { id: 'svc', type: 'service' },
    { id: 'cache', type: 'redis' },
    { id: 'db', type: 'postgres' },
    { id: 'p-scheme', type: 'probe-heatmap' },
    { id: 'p-subtree', type: 'probe-heatmap', params: { scope: 'subtree' } },
    { id: 'p-errors', type: 'probe-heatmap', params: { metric: 'errors', warnThreshold: 0.01, alarmThreshold: 0.05 } },
];

const LINKS: LinkSpec[] = [
    { from: 'client', to: 'lb' },
    { from: 'lb', to: 'svc' },
    { from: 'svc', to: 'cache' },
    { from: 'svc', to: 'db' },
    { from: 'svc', to: 'p-scheme' },
    { from: 'svc', to: 'p-subtree' },
    { from: 'svc', to: 'p-errors' },
];

let result: SimResult;

beforeAll(() => {
    registry.reset();
    initComponents();
    result = simulate(buildScheme({ nodes: NODES, links: LINKS }), { sampleCount: SAMPLES });
});

function heatmapOf(probeId: string): ProbeHeatmap {
    const heatmap = result.probes[probeId]?.heatmap;
    if (!heatmap) throw new Error(`Нет тепловой карты у пробы ${probeId}`);
    return heatmap;
}

describe('тепловая карта', () => {
    it('отдаёт значение по каждому блоку области, а не один пик', () => {
        const heatmap = heatmapOf('p-scheme');

        expect(heatmap.cells.length).toBeGreaterThan(1);
        for (const cell of heatmap.cells) {
            expect(result.nodes[cell.nodeId], cell.nodeId).toBeDefined();
            expect(Number.isFinite(cell.value), cell.nodeId).toBe(true);
        }
    });

    it('значение блока совпадает с его утилизацией в результате', () => {
        for (const cell of heatmapOf('p-scheme').cells) {
            expect(cell.value, cell.nodeId).toBeCloseTo(result.nodes[cell.nodeId].utilization, 12);
        }
    });

    it('на метрике ошибок берёт долю ошибок того же блока', () => {
        const heatmap = heatmapOf('p-errors');

        expect(heatmap.metric).toBe('errors');
        for (const cell of heatmap.cells) {
            expect(cell.value, cell.nodeId).toBeCloseTo(result.nodes[cell.nodeId].errorRate, 12);
        }
    });

    it('сортирует блоки от самого горячего и сходится с показанием пробы', () => {
        const heatmap = heatmapOf('p-scheme');
        const values = heatmap.cells.map((cell) => cell.value);

        expect([...values].sort((left, right) => right - left)).toEqual(values);
        expect(heatmap.peak).toBe(values[0]);
        expect(heatmap.hottestNodeId).toBe(heatmap.cells[0].nodeId);
        expect(result.probes['p-scheme'].value).toBeCloseTo(heatmap.peak * 100, 12);
    });

    it('область subtree берёт только блоки ниже точки крепления', () => {
        const scheme = new Set(heatmapOf('p-scheme').cells.map((cell) => cell.nodeId));
        const subtree = heatmapOf('p-subtree').cells.map((cell) => cell.nodeId);

        expect(subtree.length).toBeGreaterThan(0);
        expect(subtree.length).toBeLessThan(scheme.size);
        expect(subtree).toContain('svc');
        expect(subtree).not.toContain('lb');
        expect(subtree).not.toContain('client');
        for (const nodeId of subtree) expect(scheme.has(nodeId), nodeId).toBe(true);
    });

    it('везёт с собой пороги, по которым красить схему', () => {
        const heatmap = heatmapOf('p-errors');

        expect(heatmap.warn).toBe(0.01);
        expect(heatmap.alarm).toBe(0.05);
        expect(heatmap.scope).toBe('scheme');
    });

    it('число блоков в объяснении совпадает с числом ячеек', () => {
        const reading = result.probes['p-scheme'];

        expect(Number(reading.explain.inputs.blocks)).toBe(heatmapOf('p-scheme').cells.length);
        expect(reading.explain.inputs.hottestNode).toBe(heatmapOf('p-scheme').hottestNodeId);
    });
});
