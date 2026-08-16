import type { PricingProfile } from '../types/component';
import { DAYS_PER_MONTH, SECONDS_PER_DAY } from './constants';
import type { CompiledTopology } from './compile';
import type { NodeRuntime, OperationFlow } from './solver';
import type { MultiRegionResult, RegionResult } from './types';

const DETECTION_SEC = 30;
const DNS_TTL_SEC = 60;
const WARMUP_SEC = 60;
const P99_Z_SCORE = 2.3263;

function lagP99Sec(medianMs: number, sigma: number): number {
    if (medianMs <= 0) return 0;
    return (medianMs / 1000) * Math.exp(sigma * P99_Z_SCORE);
}

export function analyseMultiRegion(
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
    edgeFlows: Map<string, OperationFlow>,
    pricing: PricingProfile,
    costByNode: Map<string, { total: number }>,
): MultiRegionResult | null {
    if (topology.regions.length === 0) return null;

    const policy = topology.multiRegionPolicy;
    const mode = String(policy?.params.mode ?? 'single');

    const regions: RegionResult[] = topology.regions.map((region) => {
        const members = topology.nodes.filter((node) => node.regionId === region.id);
        const rps = members.reduce((sum, node) => sum + (runtimes.get(node.id)?.throughput ?? 0), 0);
        const costMonth = members.reduce((sum, node) => sum + (costByNode.get(node.id)?.total ?? 0), 0);

        return {
            nodeId: region.id,
            code: String(region.params.code ?? region.id),
            geo: String(region.params.geo ?? 'europe'),
            trafficShare: 0,
            rps,
            costMonth,
            availability: Number(region.params.availability ?? 0.9999),
        };
    });

    const totalRps = regions.reduce((sum, region) => sum + region.rps, 0);
    for (const region of regions) {
        region.trafficShare = totalRps > 0 ? region.rps / totalRps : 0;
    }

    let replicationRps = 0;
    let replicationBytesPerSec = 0;

    for (const edge of topology.edges) {
        if (edge.scope !== 'cross-region') continue;
        if (!edge.isReplication && edge.kind !== 'cdc') continue;

        const flow = edgeFlows.get(edge.id);
        if (!flow) continue;

        replicationRps += flow.total;
        replicationBytesPerSec += flow.bytesPerSec;
    }

    if (replicationRps === 0 && regions.length > 1 && mode !== 'single') {
        const writes = topology.nodes
            .filter((node) => node.definition.group === 'sql' || node.definition.group === 'nosql')
            .reduce((sum, node) => sum + (runtimes.get(node.id)?.write ?? 0), 0);

        replicationRps = writes * (regions.length - 1);
        replicationBytesPerSec = topology.nodes
            .filter((node) => node.definition.group === 'sql' || node.definition.group === 'nosql')
            .reduce((sum, node) => {
                const runtime = runtimes.get(node.id);
                const bytes = Number(node.params.rowSizeBytes ?? runtime?.requestBytes ?? 0);
                return sum + (runtime?.write ?? 0) * bytes * (regions.length - 1);
            }, 0);
    }

    const replicationGbMonth = (replicationBytesPerSec * SECONDS_PER_DAY * DAYS_PER_MONTH) / 1e9;

    let rpoSec = 0;
    let failoverSec = 0;

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;

        const lagMs = Number(node.params.replicaLagMs ?? 0);
        const sigma = Number(node.params.replicaLagSigma ?? 0.8);
        const mode = String(node.params.replicationMode ?? 'async');

        if (lagMs > 0 && mode !== 'sync') rpoSec = Math.max(rpoSec, lagP99Sec(lagMs, sigma));
        failoverSec = Math.max(failoverSec, Number(node.params.failoverSec ?? 0));
    }

    const automatic = String(policy?.params.failoverMode ?? 'manual') === 'auto';
    const rtoSec = DETECTION_SEC + DNS_TTL_SEC + failoverSec + WARMUP_SEC + (automatic ? 0 : 900);

    return {
        mode,
        regions,
        replicationRps,
        replicationBytesPerSec,
        replicationCostMonth: replicationGbMonth * pricing.crossRegionPerGb,
        rpoSec,
        rtoSec,
        rpoTargetSec: Number(policy?.params.rpoTargetSec ?? 0),
        rtoTargetSec: Number(policy?.params.rtoTargetSec ?? 0),
    };
}
