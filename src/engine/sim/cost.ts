import type { ComponentParams, CostBreakdown, CostContext, PricingProfile } from '../types/component';
import { DAYS_PER_MONTH } from './constants';
import type { CompiledTopology } from './compile';
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
): CostResult {
    const byNode = new Map<string, CostBreakdown>();
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

        const cost = model.cost(context);
        byNode.set(node.id, cost);
        total = add(total, cost);
    }

    let crossAzGbMonth = 0;
    let crossRegionGbMonth = 0;

    for (const edge of topology.edges) {
        const flow = edgeFlows.get(edge.id);
        if (!flow) continue;

        const gbMonth = (flow.bytesPerSec * 86400 * DAYS_PER_MONTH) / 1e9;

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
