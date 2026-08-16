import type { SdEdge, SdNode } from '../store/graphStore';

export type RegionView = 'all' | 'single' | 'collapsed';

export const REGION_VIEWS: RegionView[] = ['all', 'single', 'collapsed'];

export const COLLAPSED_SIZE = { width: 210, height: 66 };

export const AGGREGATE_PREFIX = 'collapsed';

export const COLLAPSED_HANDLES = { in: 'collapsed-in', out: 'collapsed-out' };

export interface CanvasViewInput {
    nodes: SdNode[];
    edges: SdEdge[];
    collapsed: ReadonlySet<string>;
    hidden?: ReadonlySet<string>;
}

export interface CanvasView {
    nodes: SdNode[];
    edges: SdEdge[];
}

function childrenByParent(nodes: SdNode[]): Map<string, SdNode[]> {
    const children = new Map<string, SdNode[]>();

    for (const node of nodes) {
        if (!node.parentId) continue;
        const list = children.get(node.parentId) ?? [];
        list.push(node);
        children.set(node.parentId, list);
    }

    return children;
}

export function descendantsOf(nodes: SdNode[], containerIds: Iterable<string>): Set<string> {
    const children = childrenByParent(nodes);
    const found = new Set<string>();
    const queue = [...containerIds];

    while (queue.length > 0) {
        const current = queue.pop() as string;

        for (const child of children.get(current) ?? []) {
            if (found.has(child.id)) continue;
            found.add(child.id);
            queue.push(child.id);
        }
    }

    return found;
}

function collapseOwner(
    nodeId: string,
    parentOf: Map<string, string | undefined>,
    collapsed: ReadonlySet<string>,
): string {
    let owner = nodeId;
    let current: string | undefined = parentOf.get(nodeId);

    while (current) {
        if (collapsed.has(current)) owner = current;
        current = parentOf.get(current);
    }

    return owner;
}

function collapsedNode(node: SdNode, childCount: number): SdNode {
    return {
        ...node,
        width: COLLAPSED_SIZE.width,
        height: COLLAPSED_SIZE.height,
        data: { ...node.data, collapsed: true, collapsedCount: childCount },
    };
}

export function buildCanvasView({ nodes, edges, collapsed, hidden }: CanvasViewInput): CanvasView {
    const hiddenRoots = hidden ?? new Set<string>();
    const insideCollapsed = descendantsOf(nodes, collapsed);
    const insideHidden = descendantsOf(nodes, hiddenRoots);
    const dropped = new Set<string>([...hiddenRoots, ...insideHidden]);
    const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));

    const visible = nodes.filter((node) => !dropped.has(node.id) && !insideCollapsed.has(node.id));
    const childCount = new Map<string, number>();

    for (const id of insideCollapsed) {
        const owner = collapseOwner(id, parentOf, collapsed);
        childCount.set(owner, (childCount.get(owner) ?? 0) + 1);
    }

    const viewNodes = visible.map((node) =>
        collapsed.has(node.id) ? collapsedNode(node, childCount.get(node.id) ?? 0) : node,
    );

    const endpointOf = (nodeId: string): string | null => {
        if (dropped.has(nodeId)) return null;
        if (!insideCollapsed.has(nodeId)) return nodeId;

        const owner = collapseOwner(nodeId, parentOf, collapsed);
        return dropped.has(owner) ? null : owner;
    };

    const merged = new Map<string, { edge: SdEdge; count: number; rewired: boolean }>();

    for (const edge of edges) {
        const source = endpointOf(edge.source);
        const target = endpointOf(edge.target);
        if (source === null || target === null || source === target) continue;

        const rewired = source !== edge.source || target !== edge.target;
        const key = rewired ? `${AGGREGATE_PREFIX}:${source}:${target}` : edge.id;
        const known = merged.get(key);

        if (known) {
            known.count += 1;
            known.rewired = true;
            continue;
        }

        merged.set(key, {
            edge: rewired
                ? {
                      ...edge,
                      id: key,
                      source,
                      target,
                      sourceHandle: source === edge.source ? edge.sourceHandle : COLLAPSED_HANDLES.out,
                      targetHandle: target === edge.target ? edge.targetHandle : COLLAPSED_HANDLES.in,
                      selected: false,
                  }
                : edge,
            count: 1,
            rewired,
        });
    }

    const viewEdges = [...merged.values()].map(({ edge, count, rewired }) =>
        rewired ? { ...edge, data: edge.data ? { ...edge.data, aggregated: count } : edge.data } : edge,
    );

    return { nodes: viewNodes, edges: viewEdges };
}

export function regionsToHide(
    nodes: SdNode[],
    view: RegionView,
    activeRegionId: string | null,
): Set<string> {
    if (view !== 'single' || activeRegionId === null) return new Set<string>();

    return new Set(
        nodes
            .filter((node) => node.data.componentType === 'region' && node.id !== activeRegionId)
            .map((node) => node.id),
    );
}

export function regionsToCollapse(nodes: SdNode[], view: RegionView): Set<string> {
    if (view !== 'collapsed') return new Set<string>();

    return new Set(nodes.filter((node) => node.data.componentType === 'region').map((node) => node.id));
}
