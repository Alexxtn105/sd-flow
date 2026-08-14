import registry from '../engine/ComponentRegistry';
import { createDefaultEdge } from '../engine/edgeDefaults';
import { firstCompatiblePair } from '../engine/ports';
import { DEFAULT_SETTINGS, MODEL_VERSION } from '../engine/types/scheme';
import type { ComponentParams } from '../engine/types/component';
import type {
    CallProfile,
    EdgePolicy,
    Position,
    SchemeEdge,
    SchemeNode,
    SchemeSettings,
    SchemeV1,
    Size,
} from '../engine/types/scheme';

export interface NodeSpec {
    id: string;
    type: string;
    params?: ComponentParams;
    parentId?: string;
    position?: Position;
    size?: Size;
}

export interface LinkSpec {
    from: string;
    to: string;
    weight?: number;
    readShare?: number;
    calls?: Partial<{ requestBytes: number; responseBytes: number; fanout: number }>;
    policy?: Partial<EdgePolicy>;
}

const READ_OPERATIONS = new Set(['read', 'scan', 'consume']);

function withReadShare(calls: CallProfile[], readShare: number): CallProfile[] {
    const readCount = calls.filter((call) => READ_OPERATIONS.has(call.op)).length;
    const writeCount = calls.length - readCount;

    return calls.map((call) => {
        const isRead = READ_OPERATIONS.has(call.op);
        const classShare = isRead ? readShare : 1 - readShare;
        const classCount = isRead ? readCount : writeCount;

        return { ...call, share: classCount > 0 ? classShare / classCount : 0 };
    });
}

export interface SchemeSpec {
    id?: string;
    name?: string;
    nodes: NodeSpec[];
    links: LinkSpec[];
    settings?: Partial<SchemeSettings>;
}

export function buildScheme(spec: SchemeSpec): SchemeV1 {
    const nodes: SchemeNode[] = spec.nodes.map((node, index) => ({
        id: node.id,
        type: node.type,
        position: node.position ?? { x: index * 220, y: 0 },
        params: { ...registry.getDefaultParams(node.type), ...(node.params ?? {}) },
        ...(node.parentId ? { parentId: node.parentId } : {}),
        ...(node.size ? { size: node.size } : {}),
    }));

    const typeById = new Map(spec.nodes.map((node) => [node.id, node.type]));

    const edges: SchemeEdge[] = spec.links.map((link, index) => {
        const sourceType = typeById.get(link.from);
        const targetType = typeById.get(link.to);

        if (!sourceType || !targetType) throw new Error(`Нет узла для связи ${link.from} → ${link.to}`);

        const pair = firstCompatiblePair(sourceType, targetType);
        if (!pair) throw new Error(`Несовместимые порты: ${sourceType} → ${targetType}`);

        const edge = createDefaultEdge({
            source: link.from,
            target: link.to,
            sourceHandle: pair.sourceHandle,
            targetHandle: pair.targetHandle,
            sourceType,
            targetType,
        });

        const withPayload = link.calls ? edge.calls.map((call) => ({ ...call, ...link.calls })) : edge.calls;

        return {
            ...edge,
            id: `edge-${index}`,
            weight: link.weight ?? edge.weight ?? 1,
            policy: { ...edge.policy, ...(link.policy ?? {}) },
            calls: link.readShare === undefined ? withPayload : withReadShare(withPayload, link.readShare),
        };
    });

    return {
        version: 1,
        modelVersion: MODEL_VERSION,
        meta: {
            id: spec.id ?? 'scheme',
            name: spec.name ?? 'scheme',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        },
        nodes,
        edges,
        settings: { ...DEFAULT_SETTINGS, ...(spec.settings ?? {}) },
        ui: { viewport: { x: 0, y: 0, zoom: 1 }, xray: false },
    };
}
