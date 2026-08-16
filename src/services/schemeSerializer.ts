import registry from '../engine/ComponentRegistry';
import { syncIdCounter } from '../engine/ids';
import { DEFAULT_POLICY, DEFAULT_SETTINGS, MODEL_VERSION } from '../engine/types/scheme';
import type {
    SchemeEdge,
    SchemeMeta,
    SchemeNode,
    SchemeSettings,
    SchemeV1,
    SchemeViewport,
    Size,
} from '../engine/types/scheme';
import { migrateScheme } from './schemeMigrations';
import { sortNodesForFlow } from '../store/graphStore';
import type { SdEdge, SdNode } from '../store/graphStore';
import { nodeDimensions } from '../utils/nodeSize';

interface SerializeInput {
    meta: SchemeMeta;
    nodes: SdNode[];
    edges: SdEdge[];
    settings?: SchemeSettings;
    viewport?: SchemeViewport;
    xray?: boolean;
}

const DEFAULT_VIEWPORT: SchemeViewport = { x: 0, y: 0, zoom: 1 };

function nodeSize(node: SdNode): Size | undefined {
    if (registry.getShape(node.data.componentType) !== 'container') return undefined;

    const { width, height } = nodeDimensions(node);
    return width > 0 && height > 0 ? { width, height } : undefined;
}

export function toScheme(input: SerializeInput): SchemeV1 {
    return {
        version: 1,
        modelVersion: MODEL_VERSION,
        meta: input.meta,
        nodes: input.nodes.map((node) => {
            const size = nodeSize(node);
            return {
                id: node.id,
                type: node.data.componentType,
                position: node.position,
                params: node.data.params,
                ...(node.data.label ? { label: node.data.label } : {}),
                ...(node.parentId ? { parentId: node.parentId } : {}),
                ...(size ? { size } : {}),
            };
        }),
        edges: input.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle ?? '',
            targetHandle: edge.targetHandle ?? '',
            kind: edge.data?.kind ?? 'sync',
            ...(edge.data?.protocol ? { protocol: edge.data.protocol } : {}),
            calls: edge.data?.calls ?? [],
            policy: edge.data?.policy ?? { ...DEFAULT_POLICY },
            ...(edge.data?.label ? { label: edge.data.label } : {}),
            ...(edge.data?.mixMode === 'manual' ? { mixMode: 'manual' as const } : {}),
            pull: edge.data?.pull ?? false,
            weight: edge.data?.weight ?? 1,
        })),
        settings: input.settings ?? { ...DEFAULT_SETTINGS },
        ui: { viewport: input.viewport ?? DEFAULT_VIEWPORT, xray: input.xray ?? false },
    };
}

function flowTypeFor(componentType: string): string {
    const shape = registry.getShape(componentType);
    if (shape === 'container') return 'group';
    if (shape === 'probe') return 'probe';
    return 'sd';
}

function toFlowNode(node: SchemeNode): SdNode {
    return {
        id: node.id,
        type: flowTypeFor(node.type),
        position: node.position,
        data: {
            componentType: node.type,
            params: { ...registry.getDefaultParams(node.type), ...node.params },
            label: node.label ?? '',
        },
        ...(node.size ? { width: node.size.width, height: node.size.height } : {}),
        ...(node.parentId ? { parentId: node.parentId, extent: 'parent' as const } : {}),
    };
}

function toFlowEdge(edge: SchemeEdge): SdEdge {
    return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: 'traffic',
        data: {
            kind: edge.kind,
            ...(edge.protocol ? { protocol: edge.protocol } : {}),
            calls: edge.calls,
            policy: edge.policy,
            label: edge.label ?? '',
            mixMode: edge.mixMode ?? 'inherit',
            pull: edge.pull ?? false,
            weight: edge.weight ?? 1,
        },
    };
}

export interface ParsedScheme {
    nodes: SdNode[];
    edges: SdEdge[];
    settings: SchemeSettings;
    meta: SchemeMeta;
    viewport: SchemeViewport;
}

export function fromScheme(scheme: SchemeV1): ParsedScheme {
    const known = scheme.nodes.filter((node) => registry.has(node.type));
    const keptIds = new Set(known.map((node) => node.id));

    const nodes = sortNodesForFlow(known.map(toFlowNode));
    const edges = scheme.edges
        .filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target))
        .map(toFlowEdge);

    syncIdCounter([...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)]);

    return {
        nodes,
        edges,
        settings: { ...DEFAULT_SETTINGS, ...scheme.settings },
        meta: scheme.meta,
        viewport: scheme.ui?.viewport ?? DEFAULT_VIEWPORT,
    };
}

export function isScheme(value: unknown): value is SchemeV1 {
    return migrateScheme(value).ok;
}
