import type { CompiledNode, CompiledTopology } from './compile';

export interface ClusterPodPlan {
    clusterId: string;
    nodes: number;
    podsPerNode: number;
    ceiling: number;
    autoscaleNodes: boolean;
    requested: number;
    granted: number;
    effectiveNodes: number;
    clamped: boolean;
}

export interface ClusterPlacement {
    plans: ClusterPodPlan[];
    instanceOverride: Map<string, number>;
    clamped: boolean;
}

function podsFor(desired: number): number {
    const rounded = Math.round(desired);
    return Number.isFinite(rounded) ? Math.max(1, rounded) : 1;
}

function compareIds(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function orderRank(topology: CompiledTopology): Map<string, number> {
    return new Map(topology.order.map((nodeId, index) => [nodeId, index]));
}

function membersOf(
    clusterId: string,
    topology: CompiledTopology,
    desiredInstances: ReadonlyMap<string, number>,
    rank: Map<string, number>,
): CompiledNode[] {
    const unplaced = topology.nodes.length;

    return topology.nodes
        .filter(
            (node) =>
                node.clusterId === clusterId &&
                node.definition.shape === 'node' &&
                desiredInstances.has(node.id),
        )
        .sort((left, right) => {
            const leftRank = rank.get(left.id) ?? unplaced;
            const rightRank = rank.get(right.id) ?? unplaced;

            if (leftRank !== rightRank) return leftRank - rightRank;
            return compareIds(left.id, right.id);
        });
}

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

export function distributePods(demand: readonly number[], ceiling: number): number[] {
    const count = demand.length;
    if (count === 0) return [];
    if (ceiling <= count) return demand.map(() => 1);

    const total = sum(demand);
    const shares = demand.map((value) => (total > 0 ? (value * ceiling) / total : ceiling / count));
    const granted = shares.map((share) => Math.max(1, Math.floor(share)));

    let outstanding = ceiling - sum(granted);

    const byFraction = shares
        .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
        .sort((left, right) => {
            if (left.fraction !== right.fraction) return right.fraction - left.fraction;
            return left.index - right.index;
        });

    for (const entry of byFraction) {
        if (outstanding <= 0) break;
        granted[entry.index] += 1;
        outstanding -= 1;
    }

    while (outstanding < 0) {
        let target = -1;

        for (let index = 0; index < count; index += 1) {
            if (granted[index] <= 1) continue;
            if (target < 0 || granted[index] > granted[target]) target = index;
        }

        if (target < 0) break;

        granted[target] -= 1;
        outstanding += 1;
    }

    return granted;
}

export function planClusterPods(
    topology: CompiledTopology,
    desiredInstances: ReadonlyMap<string, number>,
): ClusterPlacement {
    const plans: ClusterPodPlan[] = [];
    const instanceOverride = new Map<string, number>();
    const rank = orderRank(topology);

    for (const cluster of topology.nodes) {
        if (cluster.type !== 'k8s-cluster') continue;

        const declaredNodes = Math.max(0, Math.floor(Number(cluster.params.nodes ?? 0)));
        const podsPerNode = Math.max(0, Math.floor(Number(cluster.params.podsPerNode ?? 0)));
        const ceiling = declaredNodes * podsPerNode;
        const autoscaleNodes = cluster.params.autoscaleNodes !== false;

        const members = membersOf(cluster.id, topology, desiredInstances, rank);
        const demand = members.map((node) => podsFor(desiredInstances.get(node.id) ?? 0));
        const requested = sum(demand);

        const plan = {
            clusterId: cluster.id,
            nodes: declaredNodes,
            podsPerNode,
            ceiling,
            autoscaleNodes,
            requested,
        };

        if (autoscaleNodes) {
            const grown =
                podsPerNode > 0 ? Math.max(declaredNodes, Math.ceil(requested / podsPerNode)) : declaredNodes;

            plans.push({ ...plan, granted: requested, effectiveNodes: grown, clamped: false });
            continue;
        }

        if (members.length === 0 || requested <= ceiling) {
            plans.push({ ...plan, granted: requested, effectiveNodes: declaredNodes, clamped: false });
            continue;
        }

        const granted = distributePods(demand, ceiling);
        const grantedTotal = sum(granted);

        if (grantedTotal < requested) {
            members.forEach((node, index) => instanceOverride.set(node.id, granted[index]));
        }

        plans.push({
            ...plan,
            granted: grantedTotal,
            effectiveNodes: declaredNodes,
            clamped: grantedTotal < requested,
        });
    }

    return { plans, instanceOverride, clamped: instanceOverride.size > 0 };
}
