import { beforeEach, describe, expect, it } from 'vitest';
import { mirroredId, mirrorGraph } from '../../src/services/mirrorRegions';
import { useGraphStore } from '../../src/store/graphStore';
import type { SdEdge, SdNode } from '../../src/store/graphStore';
import type { ComponentParams } from '../../src/engine/types/component';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

function node(id: string, componentType: string, params: ComponentParams = {}, parentId?: string): SdNode {
    return {
        id,
        type: componentType === 'region' ? 'group' : 'sd',
        position: { x: 10, y: 20 },
        data: { componentType, params, label: '' },
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
            calls: [{ id: 'c1', op: 'read', share: 1, fanout: 1, requestBytes: 100, responseBytes: 200 }],
            policy: { timeoutMs: 1000, retries: 0, circuitBreaker: false, idempotent: false },
            label: '',
            pull: false,
            weight: 1,
        },
    };
}

function twoRegions(mirrorOf = 'eu') {
    const nodes = [
        node('eu', 'region', { code: 'eu-west-1', mirrorOf: '' }),
        node('api', 'service', { instances: 4 }, 'eu'),
        node('db', 'postgres', { readReplicas: 2 }, 'eu'),
        node('us', 'region', { code: 'us-east-1', mirrorOf }),
    ];

    return { nodes, edges: [edge('e1', 'api', 'db')] };
}

describe('зеркальные регионы', () => {
    it('инстанцируют прототип со всеми узлами и связями внутри', () => {
        const { nodes, edges } = twoRegions();
        const result = mirrorGraph(nodes, edges);
        const api = result.nodes.find((item) => item.id === mirroredId('api', 'us'));

        expect(result.changed).toBe(true);
        expect(result.nodes.map((item) => item.id)).toContain(mirroredId('db', 'us'));
        expect(api?.parentId).toBe('us');
        expect(api?.data.params).toEqual({ instances: 4 });
        expect(api?.data.mirrorOf).toBe('api');
        expect(result.edges.map((item) => item.id)).toContain(mirroredId('e1', 'us'));

        const mirroredEdge = result.edges.find((item) => item.id === mirroredId('e1', 'us'));
        expect(mirroredEdge?.source).toBe(mirroredId('api', 'us'));
        expect(mirroredEdge?.target).toBe(mirroredId('db', 'us'));
    });

    it('второй прогон ничего не меняет', () => {
        const { nodes, edges } = twoRegions();
        const first = mirrorGraph(nodes, edges);
        const second = mirrorGraph(first.nodes, first.edges);

        expect(second.changed).toBe(false);
        expect(second.nodes).toHaveLength(first.nodes.length);
    });

    it('распространяют правку прототипа на зеркало', () => {
        const { nodes, edges } = twoRegions();
        const first = mirrorGraph(nodes, edges);
        const edited = first.nodes.map((item) =>
            item.id === 'api' ? { ...item, data: { ...item.data, params: { instances: 12 } } } : item,
        );

        const second = mirrorGraph(edited, first.edges);

        expect(second.changed).toBe(true);
        expect(second.nodes.find((item) => item.id === mirroredId('api', 'us'))?.data.params).toEqual({
            instances: 12,
        });
    });

    it('находят прототип и по коду региона, и по идентификатору', () => {
        const byCode = mirrorGraph(...Object.values(twoRegions('eu-west-1')) as [SdNode[], SdEdge[]]);

        expect(byCode.nodes.map((item) => item.id)).toContain(mirroredId('api', 'us'));
    });

    it('не зеркалят сами себя и цепочку зеркал', () => {
        const self = mirrorGraph([node('eu', 'region', { code: 'eu', mirrorOf: 'eu' })], []);
        const chain = mirrorGraph(
            [
                node('eu', 'region', { code: 'eu', mirrorOf: '' }),
                node('us', 'region', { code: 'us', mirrorOf: 'eu' }),
                node('ap', 'region', { code: 'ap', mirrorOf: 'us' }),
                node('api', 'service', {}, 'eu'),
            ],
            [],
        );

        expect(self.changed).toBe(false);
        expect(chain.nodes.map((item) => item.id)).toContain(mirroredId('api', 'us'));
        expect(chain.nodes.map((item) => item.id)).not.toContain(mirroredId('api', 'ap'));
    });

    it('отвязка оставляет узлы, но снимает с них зеркальность', () => {
        const { nodes, edges } = twoRegions();
        const linked = mirrorGraph(nodes, edges);
        const unlinked = linked.nodes.map((item) =>
            item.id === 'us' ? { ...item, data: { ...item.data, params: { code: 'us-east-1', mirrorOf: '' } } } : item,
        );

        const result = mirrorGraph(unlinked, linked.edges);
        const api = result.nodes.find((item) => item.id === mirroredId('api', 'us'));

        expect(result.changed).toBe(true);
        expect(api).toBeDefined();
        expect(api?.data.mirrorOf).toBe('');
        expect(mirrorGraph(result.nodes, result.edges).changed).toBe(false);
    });

    it('удаляют зеркало исчезнувшего прототипа', () => {
        const { nodes, edges } = twoRegions();
        const linked = mirrorGraph(nodes, edges);
        const withoutSource = linked.nodes.filter((item) => item.id !== 'api');

        const result = mirrorGraph(withoutSource, linked.edges);

        expect(result.nodes.map((item) => item.id)).not.toContain(mirroredId('api', 'us'));
        expect(result.edges.map((item) => item.id)).not.toContain(mirroredId('e1', 'us'));
    });

    it('стор синхронизирует зеркала и второй вызов не двигает историю', () => {
        const { nodes, edges } = twoRegions();
        useGraphStore.getState().replaceGraph(nodes, edges);

        const before = useGraphStore.getState().revision;
        useGraphStore.getState().syncMirrors();
        const after = useGraphStore.getState().revision;

        expect(useGraphStore.getState().nodes.map((item) => item.id)).toContain(mirroredId('api', 'us'));
        expect(after).toBeGreaterThan(before);

        useGraphStore.getState().syncMirrors();
        expect(useGraphStore.getState().revision).toBe(after);
        expect(useGraphStore.getState().past).toHaveLength(0);
    });

    it('подпись зеркала переведена на оба языка', () => {
        expect(ruCommon.canvas).toHaveProperty('mirrorOf');
        expect(enCommon.canvas).toHaveProperty('mirrorOf');
        expect(ruCommon.inspector).toHaveProperty('unlinkMirror');
        expect(enCommon.inspector).toHaveProperty('unlinkMirror');
    });
});

describe('зеркала в пустом графе', () => {
    beforeEach(() => {
        useGraphStore.getState().clear();
    });

    it('ничего не делают', () => {
        expect(mirrorGraph([], []).changed).toBe(false);
        useGraphStore.getState().syncMirrors();
        expect(useGraphStore.getState().nodes).toHaveLength(0);
    });
});
