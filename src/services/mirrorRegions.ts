import type { SdEdge, SdNode } from '../store/graphStore';

export const MIRROR_SEPARATOR = '@';

const REGION_TYPE = 'region';

export interface MirrorResult {
    nodes: SdNode[];
    edges: SdEdge[];
    changed: boolean;
}

export function mirroredId(sourceId: string, regionId: string): string {
    return `${sourceId}${MIRROR_SEPARATOR}${regionId}`;
}

export function isMirror(node: SdNode): boolean {
    return typeof node.data.mirrorOf === 'string' && node.data.mirrorOf.length > 0;
}

function regionsOf(nodes: SdNode[]): SdNode[] {
    return nodes.filter((node) => node.data.componentType === REGION_TYPE);
}

function prototypeOf(mirror: SdNode, regions: SdNode[]): SdNode | null {
    const declared = mirror.data.params.mirrorOf;
    if (typeof declared !== 'string' || declared.length === 0) return null;

    const source = regions.find((region) => region.id === declared || region.data.params.code === declared);
    if (!source || source.id === mirror.id) return null;

    const sourceDeclares = source.data.params.mirrorOf;

    return typeof sourceDeclares === 'string' && sourceDeclares.length > 0 ? null : source;
}

function insideRegion(nodes: SdNode[], regionId: string): SdNode[] {
    const inside: SdNode[] = [];
    const queue = [regionId];

    while (queue.length > 0) {
        const parent = queue.pop() as string;

        for (const node of nodes) {
            if (node.parentId !== parent) continue;
            inside.push(node);
            queue.push(node.id);
        }
    }

    return inside;
}

function cloneParams(params: SdNode['data']['params']): SdNode['data']['params'] {
    const copy = { ...params };
    delete copy.mirrorOf;

    return copy;
}

function sameParams(left: SdNode, right: SdNode): boolean {
    return JSON.stringify(cloneParams(left.data.params)) === JSON.stringify(cloneParams(right.data.params));
}

function mirrorNode(source: SdNode, region: SdNode, known: SdNode | undefined): SdNode {
    const parentId = source.parentId === region.data.mirrorSourceId
        ? region.id
        : mirroredId(source.parentId as string, region.id);

    const base: SdNode = known ?? {
        ...source,
        id: mirroredId(source.id, region.id),
        position: source.position,
        selected: false,
        ...(source.width ? { width: source.width } : {}),
        ...(source.height ? { height: source.height } : {}),
        parentId,
        extent: 'parent' as const,
        data: { componentType: source.data.componentType, params: {}, label: '', mirrorOf: source.id },
    };

    return {
        ...base,
        parentId: known ? base.parentId : parentId,
        data: {
            ...base.data,
            componentType: source.data.componentType,
            params: cloneParams(source.data.params),
            label: source.data.label,
            mirrorOf: source.id,
        },
    };
}

function mirrorEdge(source: SdEdge, regionId: string, known: SdEdge | undefined): SdEdge {
    const base = known ?? source;

    return {
        ...base,
        id: mirroredId(source.id, regionId),
        source: mirroredId(source.source, regionId),
        target: mirroredId(source.target, regionId),
        selected: false,
        data: source.data
            ? {
                  ...source.data,
                  calls: source.data.calls.map((call) => ({ ...call })),
                  policy: { ...source.data.policy },
              }
            : source.data,
    };
}

export function mirrorGraph(nodes: SdNode[], edges: SdEdge[]): MirrorResult {
    const regions = regionsOf(nodes);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));

    const desiredNodes = new Map<string, SdNode>();
    const desiredEdges = new Map<string, SdEdge>();
    const managed = new Set<string>();
    let changed = false;

    for (const region of regions) {
        const prototype = prototypeOf(region, regions);
        if (!prototype) continue;

        const carrier = { ...region, data: { ...region.data, mirrorSourceId: prototype.id } };

        for (const source of insideRegion(nodes, prototype.id)) {
            const id = mirroredId(source.id, region.id);
            const known = nodeById.get(id);
            const next = mirrorNode(source, carrier, known);

            managed.add(id);
            desiredNodes.set(id, next);

            if (!known || !sameParams(known, next) || known.data.label !== next.data.label) changed = true;
        }

        for (const edge of edges) {
            const inside =
                nodeById.get(edge.source) !== undefined &&
                nodeById.get(edge.target) !== undefined &&
                managed.has(mirroredId(edge.source, region.id)) &&
                managed.has(mirroredId(edge.target, region.id));
            if (!inside) continue;

            const id = mirroredId(edge.id, region.id);
            const known = edgeById.get(id);

            managed.add(id);
            desiredEdges.set(id, mirrorEdge(edge, region.id, known));

            if (!known) changed = true;
        }
    }

    const keptNodes: SdNode[] = [];

    for (const node of nodes) {
        if (managed.has(node.id)) {
            keptNodes.push(desiredNodes.get(node.id) as SdNode);
            continue;
        }

        if (!isMirror(node)) {
            keptNodes.push(node);
            continue;
        }

        const orphaned = !nodeById.has(node.data.mirrorOf as string);

        if (orphaned) {
            changed = true;
            continue;
        }

        changed = true;
        keptNodes.push({ ...node, data: { ...node.data, mirrorOf: '' } });
    }

    for (const [id, node] of desiredNodes) {
        if (nodeById.has(id)) continue;
        keptNodes.push(node);
    }

    const keptEdges: SdEdge[] = [];
    const survivingIds = new Set(keptNodes.map((node) => node.id));

    for (const edge of edges) {
        if (managed.has(edge.id)) {
            keptEdges.push(desiredEdges.get(edge.id) as SdEdge);
            continue;
        }

        if (edge.id.includes(MIRROR_SEPARATOR) && !survivingIds.has(edge.source)) {
            changed = true;
            continue;
        }

        keptEdges.push(edge);
    }

    for (const [id, edge] of desiredEdges) {
        if (edgeById.has(id)) continue;
        keptEdges.push(edge);
    }

    return { nodes: keptNodes, edges: keptEdges, changed };
}
