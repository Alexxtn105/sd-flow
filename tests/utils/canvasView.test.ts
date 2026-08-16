import { describe, expect, it } from 'vitest';
import {
    AGGREGATE_PREFIX,
    buildCanvasView,
    COLLAPSED_SIZE,
    descendantsOf,
    regionsToCollapse,
    regionsToHide,
} from '../../src/utils/canvasView';
import type { SdEdge, SdNode } from '../../src/store/graphStore';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

function node(id: string, componentType: string, parentId?: string): SdNode {
    return {
        id,
        type: componentType === 'region' || componentType === 'az' ? 'group' : 'sd',
        position: { x: 0, y: 0 },
        data: { componentType, params: {}, label: '' },
        ...(parentId ? { parentId, extent: 'parent' as const } : {}),
    };
}

function edge(id: string, source: string, target: string): SdEdge {
    return {
        id,
        source,
        target,
        type: 'traffic',
        data: {
            kind: 'sync',
            calls: [],
            policy: { timeoutMs: 1000, retries: 0, circuitBreaker: false, idempotent: false },
            label: '',
            pull: false,
            weight: 1,
        },
    };
}

function twoRegions() {
    const nodes = [
        node('client', 'client-web'),
        node('eu', 'region'),
        node('eu-az', 'az', 'eu'),
        node('eu-api', 'service', 'eu-az'),
        node('eu-db', 'postgres', 'eu'),
        node('us', 'region'),
        node('us-api', 'service', 'us'),
    ];

    const edges = [
        edge('e1', 'client', 'eu-api'),
        edge('e2', 'eu-api', 'eu-db'),
        edge('e3', 'client', 'us-api'),
        edge('e4', 'eu-db', 'us-api'),
    ];

    return { nodes, edges };
}

describe('свёрнутая группа', () => {
    it('находит всех потомков, включая вложенных', () => {
        const { nodes } = twoRegions();

        expect([...descendantsOf(nodes, ['eu'])].sort()).toEqual(['eu-api', 'eu-az', 'eu-db']);
        expect([...descendantsOf(nodes, ['eu-az'])]).toEqual(['eu-api']);
        expect([...descendantsOf(nodes, ['us-api'])]).toEqual([]);
    });

    it('прячет содержимое и сжимает контейнер', () => {
        const { nodes, edges } = twoRegions();
        const view = buildCanvasView({ nodes, edges, collapsed: new Set(['eu']) });
        const eu = view.nodes.find((item) => item.id === 'eu');

        expect(view.nodes.map((item) => item.id)).toEqual(['client', 'eu', 'us', 'us-api']);
        expect(eu?.width).toBe(COLLAPSED_SIZE.width);
        expect(eu?.data.collapsed).toBe(true);
        expect(eu?.data.collapsedCount).toBe(3);
    });

    it('внутренние связи прячет, внешние переводит на контейнер', () => {
        const { nodes, edges } = twoRegions();
        const view = buildCanvasView({ nodes, edges, collapsed: new Set(['eu']) });
        const ids = view.edges.map((item) => item.id);

        expect(ids).not.toContain('e2');
        expect(ids).toContain(`${AGGREGATE_PREFIX}:client:eu`);
        expect(ids).toContain(`${AGGREGATE_PREFIX}:eu:us-api`);
        expect(ids).toContain('e3');
    });

    it('складывает несколько пересечений границы в одно ребро со счётчиком', () => {
        const { nodes } = twoRegions();
        const edges = [edge('e1', 'client', 'eu-api'), edge('e2', 'client', 'eu-db')];
        const view = buildCanvasView({ nodes, edges, collapsed: new Set(['eu']) });
        const aggregate = view.edges.find((item) => item.id === `${AGGREGATE_PREFIX}:client:eu`);

        expect(view.edges).toHaveLength(1);
        expect(aggregate?.data?.aggregated).toBe(2);
    });

    it('без свёрнутых групп возвращает то же самое', () => {
        const { nodes, edges } = twoRegions();
        const view = buildCanvasView({ nodes, edges, collapsed: new Set() });

        expect(view.nodes).toEqual(nodes);
        expect(view.edges.map((item) => item.id)).toEqual(edges.map((item) => item.id));
    });
});

describe('режим показа регионов', () => {
    it('«по одному» прячет чужие регионы и их связи', () => {
        const { nodes, edges } = twoRegions();
        const hidden = regionsToHide(nodes, 'single', 'eu');
        const view = buildCanvasView({ nodes, edges, collapsed: new Set(), hidden });

        expect([...hidden]).toEqual(['us']);
        expect(view.nodes.map((item) => item.id)).not.toContain('us-api');
        expect(view.edges.map((item) => item.id)).toEqual(['e1', 'e2']);
    });

    it('«свёрнуты» сворачивает все регионы разом', () => {
        const { nodes, edges } = twoRegions();
        const collapsed = regionsToCollapse(nodes, 'collapsed');
        const view = buildCanvasView({ nodes, edges, collapsed });

        expect([...collapsed].sort()).toEqual(['eu', 'us']);
        expect(view.nodes.map((item) => item.id)).toEqual(['client', 'eu', 'us']);
        expect(view.edges.map((item) => item.id)).toContain(`${AGGREGATE_PREFIX}:eu:us`);
    });

    it('«все сразу» ничего не прячет и не сворачивает', () => {
        const { nodes } = twoRegions();

        expect(regionsToHide(nodes, 'all', 'eu').size).toBe(0);
        expect(regionsToCollapse(nodes, 'all').size).toBe(0);
        expect(regionsToHide(nodes, 'single', null).size).toBe(0);
    });

    it('названия режимов переведены на оба языка', () => {
        for (const mode of ['all', 'single', 'collapsed']) {
            expect(ruCommon.canvas.regionViewMode, `ru: ${mode}`).toHaveProperty(mode);
            expect(enCommon.canvas.regionViewMode, `en: ${mode}`).toHaveProperty(mode);
        }

        expect(ruCommon.canvas).toHaveProperty('collapseGroup');
        expect(enCommon.canvas).toHaveProperty('expandGroup');
    });
});
