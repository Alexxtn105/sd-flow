import type { ComponentParams } from '../types/component';
import type { CompiledEdge, CompiledNode, CompiledTopology } from './compile';
import { SECONDS_PER_YEAR } from './constants';
import type { NodeRuntime } from './solver';

const CORRELATED_FAILURE_SHARE = 0.05;
const DEFAULT_AVAILABILITY = 0.999;
const FAILURES_PER_YEAR = 2;
const DEFAULT_FAILOVER_SEC = 30;
const ALTERNATIVE_GROUPS = new Set(['edge']);

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

export function redundancyOfNode(node: CompiledNode, instances: number): number {
    const { params } = node;

    if (typeof params.replicasPerShard === 'number') return 1 + params.replicasPerShard;
    if (typeof params.replicationFactor === 'number') return Math.max(1, params.replicationFactor);
    if (typeof params.readReplicas === 'number') return 1 + params.readReplicas;
    if (typeof params.replicaSetSize === 'number') return Math.max(1, params.replicaSetSize);
    if (typeof params.replicas === 'number') return 1 + params.replicas;
    if (typeof params.nodes === 'number') return Math.max(1, params.nodes);
    if (typeof params.brokers === 'number') return Math.max(1, params.brokers);
    if (typeof params.azSpread === 'number') return Math.max(1, Math.min(instances, params.azSpread));

    return Math.max(1, instances);
}

export function redundancyOf(node: CompiledNode, runtime: NodeRuntime | undefined): number {
    return redundancyOfNode(node, runtime?.instances ?? Number(node.params.instances ?? 1));
}

export function requiredReplicas(node: CompiledNode, redundancy: number): number {
    const quorum = node.definition.model?.quorum;
    if (!quorum) return 1;

    const required = quorum(node.params as ComponentParams);
    if (!Number.isFinite(required)) return 1;

    return Math.max(1, Math.min(Math.round(redundancy), Math.round(required)));
}

function binomial(total: number, chosen: number): number {
    let value = 1;

    for (let step = 1; step <= chosen; step += 1) {
        value = (value * (total - chosen + step)) / step;
    }

    return value;
}

export function quorumAvailability(single: number, total: number, required: number): number {
    const nodes = Math.max(1, Math.round(total));
    const quorum = Math.max(1, Math.min(nodes, Math.round(required)));

    if (quorum === 1) return 1 - Math.pow(1 - single, nodes);

    let alive = 0;

    for (let count = quorum; count <= nodes; count += 1) {
        alive += binomial(nodes, count) * Math.pow(single, count) * Math.pow(1 - single, nodes - count);
    }

    return alive;
}

function failoverPenalty(node: CompiledNode, redundancy: number): number {
    if (redundancy <= 1) return 0;

    const declared = node.params.failoverSec;
    const failoverSec = typeof declared === 'number' ? declared : DEFAULT_FAILOVER_SEC;

    return (FAILURES_PER_YEAR * failoverSec) / SECONDS_PER_YEAR;
}

export function effectiveAvailability(node: CompiledNode, runtime: NodeRuntime | undefined): number {
    const base = baseAvailability(node);
    const redundancy = redundancyOf(node, runtime);
    const single = 1 - base;

    const group = 1 - quorumAvailability(base, redundancy, requiredReplicas(node, redundancy));
    const unavailable = group * (1 - CORRELATED_FAILURE_SHARE) + single * CORRELATED_FAILURE_SHARE;

    return Math.max(0, 1 - unavailable - failoverPenalty(node, redundancy));
}

function servingTargets(topology: CompiledTopology, node: CompiledNode): string[] {
    const targets = new Set<string>();

    for (const edgeId of node.outgoing) {
        const edge: CompiledEdge | undefined = topology.edgeById.get(edgeId);
        if (!edge || edge.isReplication || edge.target === node.id) continue;

        targets.add(edge.target);
    }

    return [...targets];
}

function flowAvailability(topology: CompiledTopology, byNode: Map<string, number>, entry: string): number {
    const known = new Map<string, number>();
    const walking = new Set<string>();

    const downstream = (nodeId: string): number => {
        const cached = known.get(nodeId);
        if (cached !== undefined) return cached;
        if (walking.has(nodeId)) return 1;

        const node = topology.nodeById.get(nodeId);
        if (!node) return 1;

        walking.add(nodeId);
        const targets = servingTargets(topology, node);
        const branches = targets.map((target) => (byNode.get(target) ?? 1) * downstream(target));

        const value =
            branches.length === 0
                ? 1
                : ALTERNATIVE_GROUPS.has(node.definition.group) && branches.length > 1
                  ? 1 - branches.reduce((product, branch) => product * (1 - branch), 1)
                  : branches.reduce((product, branch) => product * branch, 1);

        walking.delete(nodeId);
        known.set(nodeId, value);

        return value;
    };

    return downstream(entry);
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
        const availability = flowAvailability(topology, byNode, entry);

        byFlow.set(entry, availability);
        overall = Math.min(overall, availability);
    }

    if (topology.entryNodes.length === 0) overall = 1;

    const spofNodeIds: string[] = [];

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;
        if (node.definition.managed) continue;
        if (topology.entryNodes.includes(node.id)) continue;

        const runtime = runtimes.get(node.id);
        if (!runtime || runtime.throughput <= 0) continue;
        if (redundancyOf(node, runtime) > 1) continue;

        spofNodeIds.push(node.id);
    }

    return { byNode, byFlow, overall, spofNodeIds };
}
