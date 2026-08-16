import registry from '../ComponentRegistry';
import type { ComponentDefinition, ComponentParams } from '../types/component';
import type { CallProfile, EdgePolicy, EdgeKind, SchemeEdge, SchemeNode, SchemeV1 } from '../types/scheme';
import { CLIENT_RTT_MS, DEFAULT_RTT_MS, geoRttMs } from './constants';
import type { Issue, NetworkScope } from './types';

export interface CompiledNode {
    id: string;
    type: string;
    definition: ComponentDefinition;
    params: ComponentParams;
    label: string;
    regionId: string | null;
    azId: string | null;
    vpcId: string | null;
    clusterId: string | null;
    incoming: string[];
    outgoing: string[];
}

export interface CompiledEdge {
    id: string;
    source: string;
    target: string;
    kind: EdgeKind;
    calls: CallProfile[];
    policy: EdgePolicy;
    pull: boolean;
    weight: number;
    scope: NetworkScope;
    networkMs: number;
    crossVpc: boolean;
    viaNat: boolean;
    isReplication: boolean;
    isAsync: boolean;
    inheritsMix: boolean;
}

export interface CompiledTopology {
    nodes: CompiledNode[];
    nodeById: Map<string, CompiledNode>;
    edges: CompiledEdge[];
    edgeById: Map<string, CompiledEdge>;
    order: string[];
    stronglyConnected: string[][];
    entryNodes: string[];
    regions: CompiledNode[];
    multiRegionPolicy: CompiledNode | null;
    issues: Issue[];
}

const MAX_SYNC_DEPTH = 5;

function issue(
    code: string,
    severity: Issue['severity'],
    nodeIds: string[] = [],
    edgeIds: string[] = [],
    values: Record<string, string | number> = {},
): Issue {
    return { code, severity, nodeIds, edgeIds, values };
}

interface Placement {
    regionId: string | null;
    azId: string | null;
    vpcId: string | null;
    clusterId: string | null;
}

function resolvePlacement(node: SchemeNode, byId: Map<string, SchemeNode>): Placement {
    let regionId: string | null = null;
    let azId: string | null = null;
    let vpcId: string | null = null;
    let clusterId: string | null = null;
    let current = node.parentId ? byId.get(node.parentId) : undefined;
    let guard = 0;

    while (current && guard < 32) {
        if (current.type === 'az') azId = current.id;
        if (current.type === 'region') regionId = current.id;
        if (current.type === 'vpc') vpcId = current.id;
        if (current.type === 'k8s-cluster') clusterId = current.id;
        current = current.parentId ? byId.get(current.parentId) : undefined;
        guard += 1;
    }

    return { regionId, azId, vpcId, clusterId };
}

function clientRttMs(params: ComponentParams): number {
    const explicit = params.networkRttMs;
    if (typeof explicit === 'number') return explicit;

    const profile = params.networkProfile;
    if (typeof profile === 'string' && CLIENT_RTT_MS[profile] !== undefined) return CLIENT_RTT_MS[profile];

    return DEFAULT_RTT_MS.internet;
}

function networkScopeFor(
    source: CompiledNode,
    target: CompiledNode,
): NetworkScope {
    if (source.definition.group === 'clients') return 'internet';
    if (source.regionId && target.regionId && source.regionId !== target.regionId) return 'cross-region';
    if (source.azId && target.azId && source.azId !== target.azId) return 'cross-az';
    if (source.azId && target.azId && source.azId === target.azId) return 'same-az';
    return 'same-az';
}

function isCrossVpc(source: CompiledNode, target: CompiledNode): boolean {
    return Boolean(source.vpcId && target.vpcId && source.vpcId !== target.vpcId);
}

function isViaNat(
    source: CompiledNode,
    target: CompiledNode,
    nodeById: Map<string, CompiledNode>,
): boolean {
    if (source.definition.group === 'clients') return false;
    if (!source.vpcId || source.vpcId === target.vpcId) return false;

    const vpc = nodeById.get(source.vpcId);
    return vpc?.params.natRequired === true;
}

function peeringLatencyMs(vpcId: string | null, nodeById: Map<string, CompiledNode>): number {
    if (!vpcId) return 0;

    const latency = nodeById.get(vpcId)?.params.peeringLatencyMs;
    return typeof latency === 'number' ? latency : 0;
}

function vpcOverheadMs(
    source: CompiledNode,
    crossVpc: boolean,
    viaNat: boolean,
    nodeById: Map<string, CompiledNode>,
): number {
    if (!crossVpc && !viaNat) return 0;

    const peering = peeringLatencyMs(source.vpcId, nodeById);
    return (crossVpc ? peering : 0) + (viaNat ? peering : 0);
}

function networkLatencyMs(
    scope: NetworkScope,
    source: CompiledNode,
    target: CompiledNode,
    nodeById: Map<string, CompiledNode>,
): number {
    if (typeof source.params.originLatencyMs === 'number') return source.params.originLatencyMs;

    if (scope === 'internet') return clientRttMs(source.params);

    if (scope === 'cross-region') {
        const fromRegion = source.regionId ? nodeById.get(source.regionId) : undefined;
        const toRegion = target.regionId ? nodeById.get(target.regionId) : undefined;
        if (fromRegion && toRegion) {
            return geoRttMs(String(fromRegion.params.geo), String(toRegion.params.geo));
        }
        return DEFAULT_RTT_MS['cross-region'];
    }

    if (scope === 'same-az' && target.azId) {
        const az = nodeById.get(target.azId);
        const latency = az?.params.intraAzLatencyMs;
        if (typeof latency === 'number') return latency;
    }

    return DEFAULT_RTT_MS[scope];
}

function tarjan(nodeIds: string[], successors: Map<string, string[]>): string[][] {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const result: string[][] = [];
    let counter = 0;

    for (const start of nodeIds) {
        if (index.has(start)) continue;

        const work: { id: string; next: number }[] = [{ id: start, next: 0 }];
        index.set(start, counter);
        low.set(start, counter);
        counter += 1;
        stack.push(start);
        onStack.add(start);

        while (work.length > 0) {
            const frame = work[work.length - 1];
            const neighbours = successors.get(frame.id) ?? [];

            if (frame.next < neighbours.length) {
                const neighbour = neighbours[frame.next];
                frame.next += 1;

                if (!index.has(neighbour)) {
                    index.set(neighbour, counter);
                    low.set(neighbour, counter);
                    counter += 1;
                    stack.push(neighbour);
                    onStack.add(neighbour);
                    work.push({ id: neighbour, next: 0 });
                } else if (onStack.has(neighbour)) {
                    low.set(frame.id, Math.min(low.get(frame.id) ?? 0, index.get(neighbour) ?? 0));
                }
                continue;
            }

            work.pop();

            if (work.length > 0) {
                const parent = work[work.length - 1];
                low.set(parent.id, Math.min(low.get(parent.id) ?? 0, low.get(frame.id) ?? 0));
            }

            if (low.get(frame.id) === index.get(frame.id)) {
                const group: string[] = [];
                let member = '';
                do {
                    member = stack.pop() as string;
                    onStack.delete(member);
                    group.push(member);
                } while (member !== frame.id && stack.length > 0);
                result.push(group);
            }
        }
    }

    return result;
}

function condensationOrder(components: string[][], successors: Map<string, string[]>): string[] {
    const componentOf = new Map<string, number>();
    components.forEach((group, groupIndex) => {
        for (const id of group) componentOf.set(id, groupIndex);
    });

    const indegree = components.map(() => 0);
    const links = components.map(() => new Set<number>());

    for (const [from, targets] of successors) {
        const fromComponent = componentOf.get(from);
        if (fromComponent === undefined) continue;

        for (const to of targets) {
            const toComponent = componentOf.get(to);
            if (toComponent === undefined || toComponent === fromComponent) continue;
            if (!links[fromComponent].has(toComponent)) {
                links[fromComponent].add(toComponent);
                indegree[toComponent] += 1;
            }
        }
    }

    const queue: number[] = [];
    indegree.forEach((value, groupIndex) => {
        if (value === 0) queue.push(groupIndex);
    });

    const order: string[] = [];
    while (queue.length > 0) {
        const current = queue.shift() as number;
        order.push(...components[current]);

        for (const next of links[current]) {
            indegree[next] -= 1;
            if (indegree[next] === 0) queue.push(next);
        }
    }

    for (const group of components) {
        for (const id of group) {
            if (!order.includes(id)) order.push(id);
        }
    }

    return order;
}

function syncDepth(entry: string, nodeById: Map<string, CompiledNode>, edgeById: Map<string, CompiledEdge>): number {
    const seen = new Set<string>();
    let deepest = 0;

    const walk = (nodeId: string, depth: number): void => {
        if (seen.has(nodeId) || depth > 32) return;
        seen.add(nodeId);
        deepest = Math.max(deepest, depth);

        const node = nodeById.get(nodeId);
        if (!node) return;

        for (const edgeId of node.outgoing) {
            const edge = edgeById.get(edgeId);
            if (!edge || edge.isAsync || edge.isReplication) continue;
            walk(edge.target, depth + 1);
        }

        seen.delete(nodeId);
    };

    walk(entry, 0);
    return deepest;
}

export function compileTopology(scheme: SchemeV1): CompiledTopology {
    const issues: Issue[] = [];
    const schemeNodeById = new Map<string, SchemeNode>(scheme.nodes.map((node) => [node.id, node]));

    const nodes: CompiledNode[] = [];
    const nodeById = new Map<string, CompiledNode>();

    for (const node of scheme.nodes) {
        const definition = registry.get(node.type);
        if (!definition) {
            issues.push(issue('unknown-component', 'error', [node.id], [], { type: node.type }));
            continue;
        }

        const placement = resolvePlacement(node, schemeNodeById);
        const compiled: CompiledNode = {
            id: node.id,
            type: node.type,
            definition,
            params: { ...definition.defaultParams, ...node.params },
            label: node.label ?? '',
            regionId: placement.regionId,
            azId: placement.azId,
            vpcId: placement.vpcId,
            clusterId: placement.clusterId,
            incoming: [],
            outgoing: [],
        };

        nodes.push(compiled);
        nodeById.set(node.id, compiled);
    }

    const edges: CompiledEdge[] = [];
    const edgeById = new Map<string, CompiledEdge>();

    for (const edge of scheme.edges as SchemeEdge[]) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);

        if (!source || !target) {
            issues.push(issue('dangling-edge', 'error', [], [edge.id]));
            continue;
        }

        const scope = networkScopeFor(source, target);
        const crossVpc = isCrossVpc(source, target);
        const viaNat = isViaNat(source, target, nodeById);
        const compiled: CompiledEdge = {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            kind: edge.kind,
            calls: edge.calls,
            policy: edge.policy,
            pull: edge.pull ?? false,
            weight: edge.weight ?? 1,
            scope,
            networkMs:
                networkLatencyMs(scope, source, target, nodeById) +
                vpcOverheadMs(source, crossVpc, viaNat, nodeById),
            crossVpc,
            viaNat,
            isReplication: edge.kind === 'replication',
            isAsync: edge.kind === 'async' || edge.kind === 'stream' || edge.kind === 'cdc' || edge.kind === 'batch',
            inheritsMix: edge.mixMode !== 'manual',
        };

        edges.push(compiled);
        edgeById.set(edge.id, compiled);
        source.outgoing.push(edge.id);
        target.incoming.push(edge.id);
    }

    const traffic = nodes.filter(
        (node) => node.definition.shape === 'node' || node.definition.shape === 'container',
    );
    const successors = new Map<string, string[]>();
    for (const node of traffic) {
        successors.set(
            node.id,
            node.outgoing
                .map((edgeId) => edgeById.get(edgeId))
                .filter((edge): edge is CompiledEdge => Boolean(edge))
                .map((edge) => edge.target),
        );
    }

    const trafficIds = traffic.map((node) => node.id);
    const stronglyConnected = tarjan(trafficIds, successors);
    const order = condensationOrder(stronglyConnected, successors);

    const entryNodes = nodes
        .filter((node) => node.definition.group === 'clients' && node.outgoing.length > 0)
        .map((node) => node.id);

    const regions = nodes.filter((node) => node.type === 'region');
    const multiRegionPolicy = nodes.find((node) => node.type === 'multi-region-policy') ?? null;

    if (entryNodes.length === 0) {
        issues.push(issue('no-entry-point', 'warning'));
    }

    for (const group of stronglyConnected) {
        if (group.length > 1) {
            issues.push(issue('cycle-detected', 'info', group, [], { size: group.length }));
        }
    }

    for (const node of nodes) {
        if (node.definition.shape !== 'node') continue;
        if (node.incoming.length === 0 && node.definition.group !== 'clients') {
            issues.push(issue('unreachable-node', 'warning', [node.id]));
        }
    }

    for (const entry of entryNodes) {
        const depth = syncDepth(entry, nodeById, edgeById);
        if (depth > MAX_SYNC_DEPTH) {
            issues.push(issue('deep-sync-chain', 'warning', [entry], [], { depth }));
        }
    }

    return {
        nodes,
        nodeById,
        edges,
        edgeById,
        order,
        stronglyConnected,
        entryNodes,
        regions,
        multiRegionPolicy,
        issues,
    };
}
