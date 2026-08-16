import type { ComponentParams, CostBreakdown, CostContext, PricingProfile } from '../types/component';
import { DAYS_PER_MONTH, HOURS_PER_MONTH, SECONDS_PER_DAY } from './constants';
import type { ClusterPodPlan } from './clusters';
import type { CompiledNode, CompiledTopology } from './compile';
import type { DerivedNode } from './derived';
import { emptyCost, totalCost } from './resources';
import type { NodeRuntime, OperationFlow } from './solver';

export interface CostResult {
    byNode: Map<string, CostBreakdown>;
    network: CostBreakdown;
    total: CostBreakdown;
}

function regionMultiplierOf(nodeRegionId: string | null, topology: CompiledTopology): number {
    if (!nodeRegionId) return 1;

    const region = topology.nodeById.get(nodeRegionId);
    const multiplier = region?.params.costMultiplier;

    return typeof multiplier === 'number' ? multiplier : 1;
}

function gbPerMonth(bytesPerSec: number): number {
    return (bytesPerSec * SECONDS_PER_DAY * DAYS_PER_MONTH) / 1e9;
}

function natGbMonthByVpc(
    topology: CompiledTopology,
    edgeFlows: Map<string, OperationFlow>,
): Map<string, number> {
    const byVpc = new Map<string, number>();

    for (const edge of topology.edges) {
        if (!edge.viaNat) continue;

        const vpcId = topology.nodeById.get(edge.source)?.vpcId;
        const flow = edgeFlows.get(edge.id);
        if (!vpcId || !flow) continue;

        byVpc.set(vpcId, (byVpc.get(vpcId) ?? 0) + gbPerMonth(flow.bytesPerSec));
    }

    return byVpc;
}

export function clusterNodesCostMonth(
    cluster: CompiledNode,
    topology: CompiledTopology,
    nodeCount: number,
): number {
    const perHour = Number(cluster.params.nodeCostPerHour ?? 0);

    return nodeCount * perHour * HOURS_PER_MONTH * regionMultiplierOf(cluster.regionId, topology);
}

function containerCost(
    node: CompiledNode,
    topology: CompiledTopology,
    natGbMonth: number,
    clusterNodes: ReadonlyMap<string, number>,
): CostBreakdown | null {
    if (node.type === 'k8s-cluster') {
        const nodeCount = clusterNodes.get(node.id) ?? Number(node.params.nodes ?? 0);
        const controlPlane = Number(node.params.controlPlaneCostMonth ?? 0);

        return totalCost({
            compute: clusterNodesCostMonth(node, topology, nodeCount) + controlPlane,
            storage: 0,
            network: 0,
            requests: 0,
        });
    }

    if (node.type === 'vpc') {
        return totalCost({
            compute: 0,
            storage: 0,
            network: natGbMonth * Number(node.params.costPerGbProcessed ?? 0),
            requests: 0,
        });
    }

    return null;
}

function withManagedPremium(
    node: CompiledNode,
    cost: CostBreakdown,
    pricing: PricingProfile,
): CostBreakdown {
    if (!node.definition.managed || pricing.managedMultiplier === 1) return cost;

    return totalCost({
        compute: cost.compute * pricing.managedMultiplier,
        storage: cost.storage * pricing.managedMultiplier,
        network: cost.network,
        requests: cost.requests * pricing.managedMultiplier,
    });
}

function add(target: CostBreakdown, source: CostBreakdown): CostBreakdown {
    return {
        compute: target.compute + source.compute,
        storage: target.storage + source.storage,
        network: target.network + source.network,
        requests: target.requests + source.requests,
        total: target.total + source.total,
    };
}

export function computeCost(
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
    derived: Map<string, DerivedNode>,
    edgeFlows: Map<string, OperationFlow>,
    pricing: PricingProfile,
    clusters: readonly ClusterPodPlan[],
): CostResult {
    const byNode = new Map<string, CostBreakdown>();
    const clusterNodes = new Map(clusters.map((plan) => [plan.clusterId, plan.effectiveNodes]));
    let total = emptyCost();

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;

        const runtime = runtimes.get(node.id);
        const model = node.definition.model;
        if (!runtime || !model?.cost) {
            byNode.set(node.id, emptyCost());
            continue;
        }

        const nodeDerived = derived.get(node.id);
        const context: CostContext<ComponentParams> = {
            nodeId: node.id,
            params: node.params,
            instances: runtime.instances,
            lambda: runtime.lambdaNominal,
            readShare: runtime.readShare,
            writeShare: runtime.writeShare,
            requestBytes: runtime.requestBytes,
            responseBytes: runtime.responseBytes,
            pricing,
            storageGb: nodeDerived?.storage?.totalGb ?? 0,
            egressGbMonth: (nodeDerived?.egressGbDay ?? 0) * DAYS_PER_MONTH,
            regionCostMultiplier: regionMultiplierOf(node.regionId, topology),
        };

        const cost = withManagedPremium(node, model.cost(context), pricing);

        byNode.set(node.id, cost);
        total = add(total, cost);
    }

    const natGbMonth = natGbMonthByVpc(topology, edgeFlows);

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'container') continue;

        const cost = containerCost(node, topology, natGbMonth.get(node.id) ?? 0, clusterNodes);
        if (!cost) continue;

        byNode.set(node.id, cost);
        total = add(total, cost);
    }

    let crossAzGbMonth = 0;
    let crossRegionGbMonth = 0;

    for (const edge of topology.edges) {
        const flow = edgeFlows.get(edge.id);
        if (!flow) continue;

        const gbMonth = gbPerMonth(flow.bytesPerSec);

        if (edge.scope === 'cross-az') crossAzGbMonth += gbMonth;
        if (edge.scope === 'cross-region') crossRegionGbMonth += gbMonth;
    }

    const network = totalCost({
        compute: 0,
        storage: 0,
        network: crossAzGbMonth * pricing.crossAzPerGb + crossRegionGbMonth * pricing.crossRegionPerGb,
        requests: 0,
    });

    return { byNode, network, total: add(total, network) };
}
