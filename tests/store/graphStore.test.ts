import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import { useGraphStore } from '../../src/store/graphStore';

beforeAll(() => {
    initComponents();
});

beforeEach(() => {
    useGraphStore.getState().clear();
});

function addPair(): { service: string; postgres: string } {
    const store = useGraphStore.getState();
    const service = store.addComponent('service', { x: 0, y: 0 });
    const postgres = store.addComponent('postgres', { x: 300, y: 0 });
    return { service: service ?? '', postgres: postgres ?? '' };
}

describe('graphStore', () => {
    it('добавляет блок с параметрами по умолчанию', () => {
        const id = useGraphStore.getState().addComponent('service', { x: 10, y: 20 });
        const node = useGraphStore.getState().nodes[0];

        expect(id).toBeTruthy();
        expect(node.type).toBe('sd');
        expect(node.data.componentType).toBe('service');
        expect(node.data.params.instances).toBe(3);
    });

    it('не добавляет блок-связь на канвас', () => {
        expect(useGraphStore.getState().addComponent('link-cross-region', { x: 0, y: 0 })).toBeNull();
        expect(useGraphStore.getState().nodes).toHaveLength(0);
    });

    it('контейнеры идут раньше дочерних узлов', () => {
        const store = useGraphStore.getState();
        store.addComponent('service', { x: 0, y: 0 });
        store.addComponent('region', { x: 0, y: 0 });

        expect(useGraphStore.getState().nodes[0].type).toBe('group');
    });

    it('создаёт связь с профилями read и write', () => {
        const { service, postgres } = addPair();
        useGraphStore.getState().connect({
            source: service,
            target: postgres,
            sourceHandle: 'out',
            targetHandle: 'sql',
        });

        const edge = useGraphStore.getState().edges[0];
        expect(edge.type).toBe('traffic');
        expect(edge.data?.kind).toBe('sync');
        expect(edge.data?.calls.map((call) => call.op)).toEqual(['read', 'write']);
        expect(edge.data?.calls.reduce((sum, call) => sum + call.share, 0)).toBeCloseTo(1, 6);
    });

    it('отклоняет несовместимую связь', () => {
        const store = useGraphStore.getState();
        const client = store.addComponent('client-web', { x: 0, y: 0 }) ?? '';
        const postgres = store.addComponent('postgres', { x: 200, y: 0 }) ?? '';

        useGraphStore.getState().connect({
            source: client,
            target: postgres,
            sourceHandle: 'out',
            targetHandle: 'sql',
        });

        expect(useGraphStore.getState().edges).toHaveLength(0);
    });

    it('нормализует доли профилей вызова до единицы', () => {
        const { service, postgres } = addPair();
        useGraphStore
            .getState()
            .connect({ source: service, target: postgres, sourceHandle: 'out', targetHandle: 'sql' });

        const edgeId = useGraphStore.getState().edges[0].id;
        useGraphStore.getState().updateEdgeCall(edgeId, 'write', 0.4);

        const calls = useGraphStore.getState().edges[0].data?.calls ?? [];
        expect(calls.find((call) => call.id === 'write')?.share).toBeCloseTo(0.4, 6);
        expect(calls.reduce((sum, call) => sum + call.share, 0)).toBeCloseTo(1, 6);
    });

    it('подписывает связь и стирает подпись пустой строкой', () => {
        const { service, postgres } = addPair();
        useGraphStore
            .getState()
            .connect({ source: service, target: postgres, sourceHandle: 'out', targetHandle: 'sql' });

        const edgeId = useGraphStore.getState().edges[0].id;
        expect(useGraphStore.getState().edges[0].data?.label).toBe('');

        useGraphStore.getState().updateEdgeLabel(edgeId, 'запись заказа');
        expect(useGraphStore.getState().edges[0].data?.label).toBe('запись заказа');

        useGraphStore.getState().updateEdgeLabel(edgeId, '');
        expect(useGraphStore.getState().edges[0].data?.label).toBe('');
    });

    it('удаление контейнера уносит вложенные узлы и их связи', () => {
        const store = useGraphStore.getState();
        const region = store.addComponent('region', { x: 0, y: 0 }) ?? '';
        const service = useGraphStore.getState().addComponent('service', { x: 20, y: 20 }, region) ?? '';
        const postgres = useGraphStore.getState().addComponent('postgres', { x: 400, y: 0 }) ?? '';

        useGraphStore
            .getState()
            .connect({ source: service, target: postgres, sourceHandle: 'out', targetHandle: 'sql' });
        expect(useGraphStore.getState().edges).toHaveLength(1);

        useGraphStore.getState().removeElements([region], []);

        expect(useGraphStore.getState().nodes.map((node) => node.id)).toEqual([postgres]);
        expect(useGraphStore.getState().edges).toHaveLength(0);
    });

    it('undo и redo возвращают граф в прежнее состояние', () => {
        useGraphStore.getState().addComponent('service', { x: 0, y: 0 });
        useGraphStore.getState().addComponent('redis', { x: 200, y: 0 });
        expect(useGraphStore.getState().nodes).toHaveLength(2);

        useGraphStore.getState().undo();
        expect(useGraphStore.getState().nodes).toHaveLength(1);

        useGraphStore.getState().undo();
        expect(useGraphStore.getState().nodes).toHaveLength(0);

        useGraphStore.getState().redo();
        useGraphStore.getState().redo();
        expect(useGraphStore.getState().nodes.map((node) => node.data.componentType)).toEqual(['service', 'redis']);
    });

    it('правка параметра попадает в историю', () => {
        const id = useGraphStore.getState().addComponent('service', { x: 0, y: 0 }) ?? '';
        useGraphStore.getState().updateNodeParam(id, 'instances', 42);
        expect(useGraphStore.getState().nodes[0].data.params.instances).toBe(42);

        useGraphStore.getState().undo();
        expect(useGraphStore.getState().nodes[0].data.params.instances).toBe(3);
    });

    it('выделение и обмер узла не меняют документ и не пишутся в историю', () => {
        const id = useGraphStore.getState().addComponent('service', { x: 0, y: 0 }) ?? '';
        const { revision, past } = useGraphStore.getState();

        useGraphStore.getState().onNodesChange([{ id, type: 'select', selected: true }]);
        useGraphStore.getState().onNodesChange([
            { id, type: 'dimensions', dimensions: { width: 200, height: 90 }, setAttributes: true },
        ]);

        expect(useGraphStore.getState().revision).toBe(revision);
        expect(useGraphStore.getState().past.length).toBe(past.length);
    });

    it('служебные изменения React Flow не стирают стек redo', () => {
        const id = useGraphStore.getState().addComponent('service', { x: 0, y: 0 }) ?? '';
        useGraphStore.getState().undo();
        expect(useGraphStore.getState().future.length).toBe(1);

        useGraphStore.getState().onNodesChange([{ id, type: 'select', selected: true }]);
        expect(useGraphStore.getState().future.length).toBe(1);

        useGraphStore.getState().redo();
        expect(useGraphStore.getState().nodes).toHaveLength(1);
    });

    it('перетаскивание оформляется одной записью истории', () => {
        const id = useGraphStore.getState().addComponent('service', { x: 0, y: 0 }) ?? '';
        const historyBefore = useGraphStore.getState().past.length;

        useGraphStore.getState().beginTransaction();
        useGraphStore.getState().onNodesChange([
            { id, type: 'position', position: { x: 50, y: 0 }, dragging: true },
            { id, type: 'position', position: { x: 120, y: 40 }, dragging: true },
        ]);
        useGraphStore.getState().commitTransaction();

        expect(useGraphStore.getState().past.length).toBe(historyBefore + 1);
        expect(useGraphStore.getState().nodes[0].position).toEqual({ x: 120, y: 40 });

        useGraphStore.getState().undo();
        expect(useGraphStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 });
    });
});

describe('копирование и вставка', () => {
    it('копия повторяет параметры и связи, но получает новые идентификаторы', () => {
        const { service, postgres } = addPair();
        const store = useGraphStore.getState();
        store.updateNodeParam(service, 'instances', 12);
        store.connect({ source: service, target: postgres, sourceHandle: 'out', targetHandle: 'sql' });

        useGraphStore.getState().copySelection([service, postgres]);
        const created = useGraphStore.getState().paste();

        expect(created).toHaveLength(2);
        expect(created).not.toContain(service);

        const nodes = useGraphStore.getState().nodes;
        expect(nodes).toHaveLength(4);

        const copy = nodes.find((node) => node.id === created[0]);
        expect(copy?.data.params.instances).toBe(12);
        expect(copy?.position.x).not.toBe(0);

        const edges = useGraphStore.getState().edges;
        expect(edges).toHaveLength(2);
        expect(edges.some((edge) => edge.source === created[0] && edge.target === created[1])).toBe(true);
    });

    it('связь наружу выделения не копируется', () => {
        const { service, postgres } = addPair();
        useGraphStore
            .getState()
            .connect({ source: service, target: postgres, sourceHandle: 'out', targetHandle: 'sql' });

        useGraphStore.getState().copySelection([service]);
        useGraphStore.getState().paste();

        expect(useGraphStore.getState().edges).toHaveLength(1);
        expect(useGraphStore.getState().nodes).toHaveLength(3);
    });

    it('правка копии не трогает оригинал', () => {
        const { service } = addPair();
        useGraphStore.getState().copySelection([service]);
        const [copy] = useGraphStore.getState().paste();

        useGraphStore.getState().updateNodeParam(copy, 'instances', 40);

        const original = useGraphStore.getState().nodes.find((node) => node.id === service);
        expect(original?.data.params.instances).toBe(3);
    });

    it('вставка без копии ничего не делает', () => {
        useGraphStore.getState().copySelection([]);
        expect(useGraphStore.getState().paste()).toEqual([]);
        expect(useGraphStore.getState().clipboardSize).toBe(0);
    });

    it('вставка отменяется одним undo', () => {
        const { service } = addPair();
        useGraphStore.getState().copySelection([service]);
        useGraphStore.getState().paste();
        expect(useGraphStore.getState().nodes).toHaveLength(3);

        useGraphStore.getState().undo();
        expect(useGraphStore.getState().nodes).toHaveLength(2);
    });
});
