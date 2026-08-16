import type { ComponentParams, CostBreakdown, CostContext, PricingProfile } from '../types/component';
import { DAYS_PER_MONTH, HOURS_PER_MONTH, SECONDS_PER_DAY } from './constants';
import { billableIops } from './provisioned';
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
    hosted: boolean,
): CostBreakdown | null {
    if (node.type === 'k8s-cluster') {
        const nodeCount = clusterNodes.get(node.id) ?? Number(node.params.nodes ?? 0);
        const own = hosted
            ? 0
            : clusterNodesCostMonth(node, topology, nodeCount) + Number(node.params.controlPlaneCostMonth ?? 0);

        return totalCost({
            compute: own,
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

function egressRateOf(node: CompiledNode, pricing: PricingProfile): number {
    const declared = node.params.costPerGbEgress;

    return typeof declared === 'number' ? declared : pricing.egressPerGb;
}

function withEgress(cost: CostBreakdown, egressCost: number): CostBreakdown {
    if (egressCost <= 0) return cost;

    return totalCost({
        compute: cost.compute,
        storage: cost.storage,
        network: cost.network + egressCost,
        requests: cost.requests,
    });
}

function iopsCostOf(node: CompiledNode, pricing: PricingProfile): number {
    return billableIops(node.params) * pricing.iopsPerMonth;
}

function withProvisionedIops(cost: CostBreakdown, iopsCost: number): CostBreakdown {
    if (iopsCost <= 0) return cost;

    return totalCost({
        compute: cost.compute,
        storage: cost.storage + iopsCost,
        network: cost.network,
        requests: cost.requests,
    });
}

function clusterComputeShares(
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
    clusters: readonly ClusterPodPlan[],
): Map<string, number> {
    const shares = new Map<string, number>();

    for (const plan of clusters) {
        const cluster = topology.nodeById.get(plan.clusterId);
        if (!cluster) continue;

        const members = topology.nodes.filter(
            (node) => node.clusterId === plan.clusterId && node.definition.shape === 'node',
        );
        if (members.length === 0) continue;

        const pods = members.map((node) => Math.max(runtimes.get(node.id)?.instances ?? 0, 0));
        const total = pods.reduce((sum, value) => sum + value, 0);
        const clusterCost =
            clusterNodesCostMonth(cluster, topology, plan.effectiveNodes) +
            Number(cluster.params.controlPlaneCostMonth ?? 0);

        members.forEach((node, index) => {
            const share = total > 0 ? pods[index] / total : 1 / members.length;
            shares.set(node.id, clusterCost * share);
        });
    }

    return shares;
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
    const clusterShares = clusterComputeShares(topology, runtimes, clusters);
    let total = emptyCost();

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;

        const runtime = runtimes.get(node.id);
        const nodeDerived = derived.get(node.id);
        const egressCost = (nodeDerived?.egressGbDay ?? 0) * DAYS_PER_MONTH * egressRateOf(node, pricing);
        const model = node.definition.model;

        if (!runtime || !model?.cost) {
            const bare = withEgress(emptyCost(), egressCost);
            byNode.set(node.id, bare);
            total = add(total, bare);
            continue;
        }

        const context: CostContext<ComponentParams> = {
            nodeId: node.id,
            params: node.params,
            instances: runtime.instances,
            lambda: runtime.lambdaNominal,
            readShare: runtime.readShare,
            writeShare: runtime.writeShare,
            requestBytes: runtime.requestBytes,
            responseBytes: runtime.responseBytes,
            blockingSec: runtime.blockingSec,
            pricing,
            storageGb: nodeDerived?.storage?.totalGb ?? 0,
            egressGbMonth: (nodeDerived?.egressGbDay ?? 0) * DAYS_PER_MONTH,
            regionCostMultiplier: regionMultiplierOf(node.regionId, topology),
        };

        const billed = withProvisionedIops(model.cost(context), iopsCostOf(node, pricing));
        const modelled = withManagedPremium(node, billed, pricing);
        const hostedCompute = clusterShares.get(node.id);
        const placed =
            hostedCompute === undefined
                ? modelled
                : totalCost({ ...modelled, compute: hostedCompute });
        const cost = withEgress(placed, egressCost);

        byNode.set(node.id, cost);
        total = add(total, cost);
    }

    const natGbMonth = natGbMonthByVpc(topology, edgeFlows);

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'container') continue;

        const hosted = topology.nodes.some(
            (member) => member.clusterId === node.id && member.definition.shape === 'node',
        );
        const cost = containerCost(node, topology, natGbMonth.get(node.id) ?? 0, clusterNodes, hosted);
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
