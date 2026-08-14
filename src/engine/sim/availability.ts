import type { ComponentParams } from '../types/component';
import type { CompiledNode, CompiledTopology } from './compile';
import type { NodeRuntime } from './solver';

const CORRELATED_FAILURE_SHARE = 0.05;
const DEFAULT_AVAILABILITY = 0.999;

export interface AvailabilityResult {
    byNode: Map<string, number>;
    byFlow: Map<string, number>;
    overall: number;
    spofNodeIds: string[];
}

function baseAvailability(node: CompiledNode): number {
    const model = node.definition.model;
    if (model?.availability) return model.availability(node.params as ComponentParams);

    const declared = node.params.availability;
    return typeof declared === 'number' ? declared : DEFAULT_AVAILABILITY;
}

export function redundancyOf(node: CompiledNode, runtime: NodeRuntime | undefined): number {
    const { params } = node;
    const instances = runtime?.instances ?? Number(params.instances ?? 1);

    if (typeof params.replicasPerShard === 'number') return 1 + params.replicasPerShard;
    if (typeof params.replicationFactor === 'number') return Math.max(1, params.replicationFactor);
    if (typeof params.readReplicas === 'number') return 1 + params.readReplicas;
    if (typeof params.azSpread === 'number') return Math.max(1, Math.min(instances, params.azSpread));

    return Math.max(1, instances);
}

export function effectiveAvailability(node: CompiledNode, runtime: NodeRuntime | undefined): number {
    const base = baseAvailability(node);
    const redundancy = redundancyOf(node, runtime);
    const single = 1 - base;

    const independent = Math.pow(single, redundancy);
    const unavailable = independent * (1 - CORRELATED_FAILURE_SHARE) + single * CORRELATED_FAILURE_SHARE;

    return 1 - unavailable;
}

function reachableFrom(topology: CompiledTopology, entries: string[]): Set<string> {
    const visited = new Set<string>(entries);
    const queue = [...entries];

    while (queue.length > 0) {
        const current = queue.shift() as string;
        const node = topology.nodeById.get(current);
        if (!node) continue;

        for (const edgeId of node.outgoing) {
            const edge = topology.edgeById.get(edgeId);
            if (!edge || edge.isReplication || visited.has(edge.target)) continue;

            visited.add(edge.target);
            queue.push(edge.target);
        }
    }

    return visited;
}

export function computeAvailability(
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
): AvailabilityResult {
    const byNode = new Map<string, number>();

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;
        byNode.set(node.id, effectiveAvailability(node, runtimes.get(node.id)));
    }

    const byFlow = new Map<string, number>();
    let overall = 1;

    for (const entry of topology.entryNodes) {
        const reachable = reachableFrom(topology, [entry]);
        let availability = 1;

        for (const nodeId of reachable) {
            if (nodeId === entry) continue;
            availability *= byNode.get(nodeId) ?? 1;
        }

        byFlow.set(entry, availability);
        overall = Math.min(overall, availability);
    }

    if (topology.entryNodes.length === 0) overall = 1;

    const spofNodeIds: string[] = [];

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;
        if (topology.entryNodes.includes(node.id)) continue;

        const runtime = runtimes.get(node.id);
        if (!runtime || runtime.throughput <= 0) continue;
        if (redundancyOf(node, runtime) > 1) continue;

        spofNodeIds.push(node.id);
    }

    return { byNode, byFlow, overall, spofNodeIds };
}
