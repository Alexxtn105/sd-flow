import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import { fromScheme, isScheme, toScheme } from '../../src/services/schemeSerializer';
import { useGraphStore } from '../../src/store/graphStore';
import { DEFAULT_SETTINGS, MODEL_VERSION } from '../../src/engine/types/scheme';
import type { SchemeMeta } from '../../src/engine/types/scheme';

const META: SchemeMeta = {
    id: 'scheme-test',
    name: 'YouTube',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
};

beforeAll(() => {
    initComponents();
});

beforeEach(() => {
    useGraphStore.getState().clear();
});

function buildGraph(): void {
    const store = useGraphStore.getState();
    const region = store.addComponent('region', { x: 0, y: 0 }) ?? '';
    const service = useGraphStore.getState().addComponent('service', { x: 40, y: 40 }, region) ?? '';
    const postgres = useGraphStore.getState().addComponent('postgres', { x: 500, y: 0 }) ?? '';

    useGraphStore.getState().updateNodeParam(service, 'instances', 12);
    useGraphStore.getState().updateNodeLabel(service, 'video-api');
    useGraphStore
        .getState()
        .connect({ source: service, target: postgres, sourceHandle: 'out', targetHandle: 'sql' });
}

describe('сериализация схемы', () => {
    it('круговой рейс сохраняет узлы, связи и вложенность', () => {
        buildGraph();
        const { nodes, edges } = useGraphStore.getState();

        const scheme = toScheme({ meta: META, nodes, edges, settings: { ...DEFAULT_SETTINGS } });
        const parsed = fromScheme(scheme);

        expect(scheme.version).toBe(1);
        expect(scheme.modelVersion).toBe(MODEL_VERSION);
        expect(parsed.nodes).toHaveLength(3);
        expect(parsed.edges).toHaveLength(1);

        const service = parsed.nodes.find((node) => node.data.label === 'video-api');
        expect(service?.data.params.instances).toBe(12);
        expect(service?.parentId).toBeTruthy();
        expect(service?.extent).toBe('parent');

        const region = parsed.nodes.find((node) => node.type === 'group');
        expect(region?.style?.width).toBe(620);
    });

    it('сохраняет подпись связи и не пишет пустую', () => {
        buildGraph();
        const edgeId = useGraphStore.getState().edges[0].id;

        const empty = toScheme({
            meta: META,
            nodes: useGraphStore.getState().nodes,
            edges: useGraphStore.getState().edges,
        });
        expect('label' in empty.edges[0]).toBe(false);

        useGraphStore.getState().updateEdgeLabel(edgeId, 'запись заказа');
        const named = toScheme({
            meta: META,
            nodes: useGraphStore.getState().nodes,
            edges: useGraphStore.getState().edges,
        });

        expect(named.edges[0].label).toBe('запись заказа');
        expect(fromScheme(named).edges[0].data?.label).toBe('запись заказа');
        expect(fromScheme(empty).edges[0].data?.label).toBe('');
    });

    it('пропускает узлы неизвестного типа и связи к ним', () => {
        buildGraph();
        const scheme = toScheme({
            meta: META,
            nodes: useGraphStore.getState().nodes,
            edges: useGraphStore.getState().edges,
        });

        scheme.nodes.push({
            id: 'ghost-1',
            type: 'quantum-db',
            position: { x: 0, y: 0 },
            params: {},
        });
        scheme.edges.push({
            ...scheme.edges[0],
            id: 'edge-ghost',
            target: 'ghost-1',
        });

        const parsed = fromScheme(scheme);

        expect(parsed.nodes.some((node) => node.id === 'ghost-1')).toBe(false);
        expect(parsed.edges.some((edge) => edge.id === 'edge-ghost')).toBe(false);
    });

    it('дополняет параметры значениями по умолчанию при чтении старой схемы', () => {
        const parsed = fromScheme({
            version: 1,
            modelVersion: '0.0.1',
            meta: META,
            nodes: [{ id: 'service-9', type: 'service', position: { x: 0, y: 0 }, params: { instances: 7 } }],
            edges: [],
            settings: { ...DEFAULT_SETTINGS },
            ui: { viewport: { x: 0, y: 0, zoom: 1 }, xray: false },
        });

        expect(parsed.nodes[0].data.params.instances).toBe(7);
        expect(parsed.nodes[0].data.params.serviceTimeMs).toBe(20);
    });

    it('отличает схему от произвольного json', () => {
        expect(isScheme({ version: 1, nodes: [], edges: [] })).toBe(true);
        expect(isScheme({ hello: 'world' })).toBe(false);
        expect(isScheme(null)).toBe(false);
    });
});
