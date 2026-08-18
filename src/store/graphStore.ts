import { create } from 'zustand';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node, NodeChange, XYPosition } from '@xyflow/react';
import { applyPatches, enablePatches, produceWithPatches } from 'immer';
import type { Patch } from 'immer';
import registry from '../engine/ComponentRegistry';
import { applySourcePayload, createDefaultEdge } from '../engine/edgeDefaults';
import { nextId } from '../engine/ids';
import { isConnectionAllowed } from '../engine/ports';
import { mirrorGraph } from '../services/mirrorRegions';
import type {
    ComponentParams,
    ComponentShape,
    ComponentTypeId,
    ParamValue,
    Protocol,
} from '../engine/types/component';
import type { CallProfile, EdgeKind, EdgePolicy, MixMode } from '../engine/types/scheme';
import { CONTAINER_SIZE } from '../utils/nodeSize';

enablePatches();

const HISTORY_LIMIT = 100;


export interface SdNodeData extends Record<string, unknown> {
    componentType: ComponentTypeId;
    params: ComponentParams;
    label: string;
}

export type SdNode = Node<SdNodeData>;
export type SdEdge = Edge<SdEdgeData>;

export interface SdEdgeData extends Record<string, unknown> {
    kind: EdgeKind;
    protocol?: Protocol;
    calls: CallProfile[];
    policy: EdgePolicy;
    label: string;
    mixMode?: MixMode;
    pull: boolean;
    weight: number;
}

interface GraphSnapshot {
    nodes: SdNode[];
    edges: SdEdge[];
}

interface HistoryEntry {
    redo: Patch[];
    undo: Patch[];
}

export interface GraphState extends GraphSnapshot {
    revision: number;
    clipboardSize: number;
    past: HistoryEntry[];
    future: HistoryEntry[];
    transactionBase: GraphSnapshot | null;
    onNodesChange: (changes: NodeChange<SdNode>[]) => void;
    onEdgesChange: (changes: EdgeChange<SdEdge>[]) => void;
    addComponent: (type: ComponentTypeId, position: XYPosition, parentId?: string) => string | null;
    connect: (connection: Connection) => void;
    selectOnly: (nodeIds: string[], edgeIds: string[]) => void;
    copySelection: (nodeIds: string[]) => void;
    paste: (offset?: XYPosition) => string[];
    isValidConnection: (connection: Connection | Edge) => boolean;
    updateNodeParam: (nodeId: string, key: string, value: ParamValue) => void;
    updateNodeLabel: (nodeId: string, label: string) => void;
    updateEdgeCall: (edgeId: string, callId: string, share: number) => void;
    updateEdgeMixMode: (edgeId: string, mixMode: MixMode) => void;
    updateEdgeKind: (edgeId: string, kind: EdgeKind) => void;
    updateEdgeProtocol: (edgeId: string, protocol: Protocol) => void;
    updateEdgeLabel: (edgeId: string, label: string) => void;
    setNodeParent: (nodeId: string, parentId: string | undefined, position?: XYPosition) => void;
    duplicateNode: (nodeId: string) => void;
    removeElements: (nodeIds: string[], edgeIds: string[]) => void;
    syncMirrors: () => void;
    replaceGraph: (nodes: SdNode[], edges: SdEdge[]) => void;
    clear: () => void;
    beginTransaction: () => void;
    commitTransaction: () => void;
    undo: () => void;
    redo: () => void;
}

function flowTypeFor(shape: ComponentShape): string {
    if (shape === 'container') return 'group';
    if (shape === 'probe') return 'probe';
    return 'sd';
}

export function sortNodesForFlow(nodes: SdNode[]): SdNode[] {
    const containers = nodes.filter((node) => node.type === 'group');
    const rest = nodes.filter((node) => node.type !== 'group');
    return [...containers, ...rest];
}

interface MutateOptions {
    history?: boolean;
    documentChange?: boolean;
}

const VIEW_ONLY_CHANGES = ['select', 'dimensions'];

function isViewOnly(changes: { type: string }[]): boolean {
    return changes.every((change) => VIEW_ONLY_CHANGES.includes(change.type));
}

function hasRemoval(changes: { type: string }[]): boolean {
    return changes.some((change) => change.type === 'remove');
}

const PASTE_OFFSET: XYPosition = { x: 32, y: 32 };

interface Clipboard {
    nodes: SdNode[];
    edges: SdEdge[];
}

let clipboard: Clipboard = { nodes: [], edges: [] };

function cloneNode(node: SdNode): SdNode {
    return { ...node, data: { ...node.data, params: { ...node.data.params } } };
}

function cloneEdge(edge: SdEdge): SdEdge {
    return {
        ...edge,
        data: edge.data
            ? {
                  ...edge.data,
                  calls: edge.data.calls.map((call) => ({ ...call })),
                  policy: { ...edge.data.policy },
              }
            : edge.data,
    };
}

export const useGraphStore = create<GraphState>((set, get) => {
    function mutate(recipe: (draft: GraphSnapshot) => void, options: MutateOptions = {}): void {
        const { history = true, documentChange = true } = options;
        const { nodes, edges } = get();
        const base: GraphSnapshot = { nodes, edges };
        const [next, redo, undo] = produceWithPatches(base, recipe);

        if (next === base) return;

        set((state) => ({
            nodes: next.nodes,
            edges: next.edges,
            revision: documentChange ? state.revision + 1 : state.revision,
            past: history ? [...state.past, { redo, undo }].slice(-HISTORY_LIMIT) : state.past,
            future: history ? [] : state.future,
        }));
    }

    return {
        nodes: [],
        edges: [],
        revision: 0,
        clipboardSize: 0,
        past: [],
        future: [],
        transactionBase: null,

        onNodesChange: (changes) => {
            mutate(
                (draft) => {
                    draft.nodes = applyNodeChanges(changes, draft.nodes as SdNode[]);
                },
                { history: hasRemoval(changes), documentChange: !isViewOnly(changes) },
            );
        },

        onEdgesChange: (changes) => {
            mutate(
                (draft) => {
                    draft.edges = applyEdgeChanges(changes, draft.edges as SdEdge[]);
                },
                { history: hasRemoval(changes), documentChange: !isViewOnly(changes) },
            );
        },

        addComponent: (type, position, parentId) => {
            const definition = registry.get(type);
            if (!definition || definition.shape === 'link') return null;

            const id = nextId(type);
            const size = CONTAINER_SIZE[type];

            const node: SdNode = {
                id,
                type: flowTypeFor(definition.shape),
                position,
                data: {
                    componentType: type,
                    params: registry.getDefaultParams(type),
                    label: '',
                },
                ...(size ? { width: size.width, height: size.height } : {}),
                ...(parentId ? { parentId, extent: 'parent' as const } : {}),
            };

            mutate((draft) => {
                draft.nodes = sortNodesForFlow([...(draft.nodes as SdNode[]), node]);
            });

            return id;
        },

        isValidConnection: (connection) => {
            const { nodes, edges } = get();
            if (!connection.source || !connection.target) return false;
            if (connection.source === connection.target) return false;

            const source = nodes.find((node) => node.id === connection.source);
            const target = nodes.find((node) => node.id === connection.target);
            if (!source || !target) return false;

            const duplicate = edges.some(
                (edge) =>
                    edge.source === connection.source &&
                    edge.target === connection.target &&
                    edge.sourceHandle === connection.sourceHandle &&
                    edge.targetHandle === connection.targetHandle,
            );
            if (duplicate) return false;

            return isConnectionAllowed(
                source.data.componentType,
                connection.sourceHandle ?? '',
                target.data.componentType,
                connection.targetHandle ?? '',
            );
        },

        connect: (connection) => {
            if (!get().isValidConnection(connection)) return;

            const { nodes } = get();
            const source = nodes.find((node) => node.id === connection.source);
            const target = nodes.find((node) => node.id === connection.target);
            if (!source || !target) return;

            const scheme = applySourcePayload(
                createDefaultEdge({
                    source: source.id,
                    target: target.id,
                    sourceHandle: connection.sourceHandle ?? '',
                    targetHandle: connection.targetHandle ?? '',
                    sourceType: source.data.componentType,
                    targetType: target.data.componentType,
                }),
                source.data.params,
            );

            const edge: SdEdge = {
                id: scheme.id,
                source: scheme.source,
                target: scheme.target,
                sourceHandle: scheme.sourceHandle,
                targetHandle: scheme.targetHandle,
                type: 'traffic',
                data: {
                    kind: scheme.kind,
                    ...(scheme.protocol ? { protocol: scheme.protocol } : {}),
                    calls: scheme.calls,
                    policy: scheme.policy,
                    label: scheme.label ?? '',
                    mixMode: scheme.mixMode ?? 'inherit',
                    pull: scheme.pull ?? false,
                    weight: scheme.weight ?? 1,
                },
            };

            mutate((draft) => {
                draft.edges.push(edge);
            });
        },

        updateNodeParam: (nodeId, key, value) => {
            mutate((draft) => {
                const node = draft.nodes.find((item) => item.id === nodeId);
                if (node) node.data.params[key] = value;
            });
        },

        updateNodeLabel: (nodeId, label) => {
            mutate((draft) => {
                const node = draft.nodes.find((item) => item.id === nodeId);
                if (node) node.data.label = label;
            });
        },

        updateEdgeCall: (edgeId, callId, share) => {
            mutate((draft) => {
                const edge = draft.edges.find((item) => item.id === edgeId);
                if (!edge?.data) return;

                const calls = edge.data.calls;

                const target = calls.find((call) => call.id === callId);
                if (!target) return;

                const clamped = Math.min(1, Math.max(0, share));
                const others = calls.filter((call) => call.id !== callId);
                const remaining = 1 - clamped;
                const othersTotal = others.reduce((sum, call) => sum + call.share, 0);

                target.share = clamped;
                for (const call of others) {
                    call.share = othersTotal > 0 ? (call.share / othersTotal) * remaining : remaining / others.length;
                }

                edge.data.mixMode = 'manual';
            });
        },

        updateEdgeMixMode: (edgeId, mixMode) => {
            mutate((draft) => {
                const edge = draft.edges.find((item) => item.id === edgeId);
                if (edge?.data) edge.data.mixMode = mixMode;
            });
        },

        updateEdgeKind: (edgeId, kind) => {
            mutate((draft) => {
                const edge = draft.edges.find((item) => item.id === edgeId);
                if (edge?.data) edge.data.kind = kind;
            });
        },

        updateEdgeProtocol: (edgeId, protocol) => {
            mutate((draft) => {
                const edge = draft.edges.find((item) => item.id === edgeId);
                if (edge?.data) edge.data.protocol = protocol;
            });
        },

        updateEdgeLabel: (edgeId, label) => {
            mutate((draft) => {
                const edge = draft.edges.find((item) => item.id === edgeId);
                if (edge?.data) edge.data.label = label;
            });
        },

        setNodeParent: (nodeId, parentId, position) => {
            mutate((draft) => {
                const node = draft.nodes.find((item) => item.id === nodeId);
                if (!node) return;

                if (position) node.position = position;

                if (parentId) {
                    node.parentId = parentId;
                    node.extent = 'parent';
                } else {
                    delete node.parentId;
                    delete node.extent;
                }
            });
        },

        copySelection: (nodeIds) => {
            const picked = new Set(nodeIds);
            const { nodes, edges } = get();

            clipboard = {
                nodes: nodes.filter((node) => picked.has(node.id)).map(cloneNode),
                edges: edges
                    .filter((edge) => picked.has(edge.source) && picked.has(edge.target))
                    .map(cloneEdge),
            };

            set({ clipboardSize: clipboard.nodes.length });
        },

        paste: (offset = PASTE_OFFSET) => {
            if (clipboard.nodes.length === 0) return [];

            const renamed = new Map<string, string>();
            const nodes = clipboard.nodes.map((node) => {
                const id = nextId(node.data.componentType);
                renamed.set(node.id, id);

                return {
                    ...cloneNode(node),
                    id,
                    position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
                    selected: false,
                };
            });

            for (const node of nodes) {
                if (!node.parentId) continue;
                const moved = renamed.get(node.parentId);
                if (moved) node.parentId = moved;
            }

            const edges = clipboard.edges.map((edge) => ({
                ...cloneEdge(edge),
                id: nextId('edge'),
                source: renamed.get(edge.source) ?? edge.source,
                target: renamed.get(edge.target) ?? edge.target,
                selected: false,
            }));

            mutate((draft) => {
                draft.nodes = sortNodesForFlow([...(draft.nodes as SdNode[]), ...nodes]);
                draft.edges = [...(draft.edges as SdEdge[]), ...edges];
            });

            return nodes.map((node) => node.id);
        },

        selectOnly: (nodeIds, edgeIds) => {
            const nodes = new Set(nodeIds);
            const edges = new Set(edgeIds);

            mutate(
                (draft) => {
                    for (const node of draft.nodes) {
                        const selected = nodes.has(node.id);
                        if (node.selected !== selected) node.selected = selected;
                    }

                    for (const edge of draft.edges) {
                        const selected = edges.has(edge.id);
                        if (edge.selected !== selected) edge.selected = selected;
                    }
                },
                { history: false, documentChange: false },
            );
        },

        duplicateNode: (nodeId) => {
            const source = get().nodes.find((node) => node.id === nodeId);
            if (!source) return;

            const copy: SdNode = {
                ...source,
                id: nextId(source.data.componentType),
                position: { x: source.position.x + 40, y: source.position.y + 40 },
                selected: false,
                data: { ...source.data, params: { ...source.data.params } },
            };

            mutate((draft) => {
                draft.nodes = sortNodesForFlow([...(draft.nodes as SdNode[]), copy]);
            });
        },

        removeElements: (nodeIds, edgeIds) => {
            if (nodeIds.length === 0 && edgeIds.length === 0) return;

            const doomed = new Set(nodeIds);
            const children = get().nodes.filter((node) => node.parentId && doomed.has(node.parentId));
            for (const child of children) doomed.add(child.id);

            mutate((draft) => {
                draft.nodes = draft.nodes.filter((node) => !doomed.has(node.id));
                draft.edges = draft.edges.filter(
                    (edge) => !edgeIds.includes(edge.id) && !doomed.has(edge.source) && !doomed.has(edge.target),
                );
            });
        },

        syncMirrors: () => {
            const { nodes, edges } = get();
            const mirrored = mirrorGraph(nodes, edges);
            if (!mirrored.changed) return;

            mutate(
                (draft) => {
                    draft.nodes = sortNodesForFlow(mirrored.nodes);
                    draft.edges = mirrored.edges;
                },
                { history: false },
            );
        },

        replaceGraph: (nodes, edges) => {
            set((state) => ({
                nodes: sortNodesForFlow(nodes),
                edges,
                revision: state.revision + 1,
                past: [],
                future: [],
                transactionBase: null,
            }));
        },

        clear: () => {
            set((state) => ({
                nodes: [],
                edges: [],
                revision: state.revision + 1,
                past: [],
                future: [],
                transactionBase: null,
            }));
        },

        beginTransaction: () => {
            const { nodes, edges } = get();
            set({ transactionBase: { nodes, edges } });
        },

        commitTransaction: () => {
            const { transactionBase, nodes, edges } = get();
            if (!transactionBase) return;

            const [, redo, undo] = produceWithPatches(transactionBase, (draft) => {
                draft.nodes = nodes;
                draft.edges = edges;
            });

            set((state) => ({
                transactionBase: null,
                revision: redo.length > 0 ? state.revision + 1 : state.revision,
                past: redo.length > 0 ? [...state.past, { redo, undo }].slice(-HISTORY_LIMIT) : state.past,
                future: redo.length > 0 ? [] : state.future,
            }));
        },

        undo: () => {
            const { past, nodes, edges } = get();
            const entry = past[past.length - 1];
            if (!entry) return;

            const restored = applyPatches({ nodes, edges }, entry.undo);
            set((state) => ({
                nodes: restored.nodes,
                edges: restored.edges,
                revision: state.revision + 1,
                past: state.past.slice(0, -1),
                future: [entry, ...state.future].slice(0, HISTORY_LIMIT),
            }));
        },

        redo: () => {
            const { future, nodes, edges } = get();
            const entry = future[0];
            if (!entry) return;

            const restored = applyPatches({ nodes, edges }, entry.redo);
            set((state) => ({
                nodes: restored.nodes,
                edges: restored.edges,
                revision: state.revision + 1,
                past: [...state.past, entry].slice(-HISTORY_LIMIT),
                future: state.future.slice(1),
            }));
        },
    };
});
