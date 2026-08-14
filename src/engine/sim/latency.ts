import type { CompiledEdge, CompiledTopology } from './compile';
import type { Flow } from './flows';
import { selfAbsorption } from './solver';
import type { NodeRuntime } from './solver';
import type { Rng } from './rng';
import type { FlowResult, HopStat } from './types';

const MAX_WALK_DEPTH = 12;
const BACKOFF_BASE_SEC = 0.05;

interface HopAccumulator {
    nodeId: string;
    depth: number;
    visits: number;
    serviceSec: number;
    waitSec: number;
    networkSec: number;
    totalSec: number;
}

interface WalkOutcome {
    seconds: number;
    failed: boolean;
    timedOut: boolean;
}

function quantile(sorted: number[], probability: number): number {
    if (sorted.length === 0) return 0;

    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);

    if (lower === upper) return sorted[lower];

    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function rollUpLatency(
    topology: CompiledTopology,
    flows: Flow[],
    runtimes: Map<string, NodeRuntime>,
    rng: Rng,
    sampleCount: number,
): FlowResult[] {
    return flows.map((flow) => {
        const hops = new Map<string, HopAccumulator>();
        const samples: number[] = [];
        let failures = 0;
        let timeouts = 0;
        let deepest = 0;

        const walk = (nodeId: string, depth: number, visited: Set<string>): WalkOutcome => {
            const node = topology.nodeById.get(nodeId);
            const runtime = runtimes.get(nodeId);

            if (!node || !runtime || depth > MAX_WALK_DEPTH || visited.has(nodeId)) {
                return { seconds: 0, failed: false, timedOut: false };
            }

            visited.add(nodeId);
            deepest = Math.max(deepest, depth);

            const sigma = Number(node.params.serviceTimeSigma ?? 0.4);
            const serviceSec = runtime.serviceSec > 0 ? rng.logNormal(runtime.serviceSec, sigma) : 0;
            const waitSec = runtime.queue.waitSec > 0 ? rng.exponential(runtime.queue.waitSec) : 0;

            let selfSeconds = serviceSec + waitSec;
            let failed = rng.bernoulli(runtime.queue.overflowProbability);
            let timedOut = false;

            const childDurations: number[] = [];
            const parallel = node.params.callMode === 'parallel';

            for (const edgeId of node.outgoing) {
                const edge = topology.edgeById.get(edgeId);
                if (!edge || edge.isAsync || edge.isReplication) continue;

                const target = topology.nodeById.get(edge.target);
                if (!target) continue;

                if (!shouldFollow(edge, node.id, topology, runtimes, rng)) continue;

                const outcome = attempt(edge, depth, visited);
                childDurations.push(outcome.seconds);

                if (outcome.failed) failed = true;
                if (outcome.timedOut) timedOut = true;
            }

            if (childDurations.length > 0) {
                selfSeconds += parallel
                    ? Math.max(...childDurations)
                    : childDurations.reduce((sum, value) => sum + value, 0);
            }

            visited.delete(nodeId);

            const accumulator = hops.get(nodeId) ?? {
                nodeId,
                depth,
                visits: 0,
                serviceSec: 0,
                waitSec: 0,
                networkSec: 0,
                totalSec: 0,
            };
            accumulator.visits += 1;
            accumulator.serviceSec += serviceSec;
            accumulator.waitSec += waitSec;
            accumulator.totalSec += serviceSec + waitSec;
            accumulator.depth = Math.min(accumulator.depth, depth);
            hops.set(nodeId, accumulator);

            return { seconds: selfSeconds, failed, timedOut };
        };

        const attempt = (edge: CompiledEdge, depth: number, visited: Set<string>): WalkOutcome => {
            const timeoutSec = edge.policy.timeoutMs / 1000;
            const networkSec = edge.networkMs / 1000;
            let elapsed = 0;
            let failed = false;
            let timedOut = false;

            for (let tryIndex = 0; tryIndex <= edge.policy.retries; tryIndex += 1) {
                if (tryIndex > 0) elapsed += BACKOFF_BASE_SEC * Math.pow(2, tryIndex - 1);

                const child = walk(edge.target, depth + 1, visited);
                let leg = networkSec + child.seconds;

                if (timeoutSec > 0 && leg > timeoutSec) {
                    leg = timeoutSec;
                    timedOut = true;
                    failed = true;
                } else {
                    failed = child.failed;
                    timedOut = timedOut || child.timedOut;
                }

                elapsed += leg;

                const hop = hops.get(edge.target);
                if (hop) hop.networkSec += networkSec;

                if (!failed) break;
                if (edge.policy.circuitBreaker) break;
            }

            return { seconds: elapsed, failed, timedOut };
        };

        const entry = topology.nodeById.get(flow.entryNodeId);
        const clientEdges = entry?.outgoing ?? [];

        for (let sample = 0; sample < sampleCount; sample += 1) {
            let total = 0;
            let failed = false;
            let timedOut = false;

            for (const edgeId of clientEdges) {
                const edge = topology.edgeById.get(edgeId);
                if (!edge || edge.isAsync || edge.isReplication) continue;

                const outcome = attempt(edge, 1, new Set([flow.entryNodeId]));
                total += outcome.seconds;
                if (outcome.failed) failed = true;
                if (outcome.timedOut) timedOut = true;
            }

            samples.push(total * 1000);
            if (failed) failures += 1;
            if (timedOut) timeouts += 1;
        }

        samples.sort((left, right) => left - right);

        const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1);
        const hopStats: HopStat[] = [...hops.values()]
            .map((item) => ({
                nodeId: item.nodeId,
                depth: item.depth,
                shareOfRequests: item.visits / Math.max(sampleCount, 1),
                serviceMs: (item.serviceSec / Math.max(item.visits, 1)) * 1000,
                waitMs: (item.waitSec / Math.max(item.visits, 1)) * 1000,
                networkMs: (item.networkSec / Math.max(item.visits, 1)) * 1000,
                contributionMs: (item.totalSec / Math.max(sampleCount, 1)) * 1000,
            }))
            .sort((left, right) => right.contributionMs - left.contributionMs);

        return {
            id: flow.id,
            entryNodeId: flow.entryNodeId,
            rps: flow.rps,
            readShare: flow.readShare,
            latency: {
                mean,
                p50: quantile(samples, 0.5),
                p95: quantile(samples, 0.95),
                p99: quantile(samples, 0.99),
            },
            errorRate: failures / Math.max(sampleCount, 1),
            availability: 1 - failures / Math.max(sampleCount, 1),
            timeoutShare: timeouts / Math.max(sampleCount, 1),
            hops: hopStats,
            depth: deepest,
        };
    });
}

function shouldFollow(
    edge: CompiledEdge,
    sourceId: string,
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
    rng: Rng,
): boolean {
    const target = topology.nodeById.get(edge.target);
    if (!target) return false;

    const source = topology.nodeById.get(sourceId);
    if (!source) return true;

    const own = selfAbsorption(source);
    if (own > 0) return !rng.bernoulli(own);

    const absorbing = ['sql', 'nosql', 'search', 'olap', 'storage'].includes(target.definition.group);
    if (!absorbing) return true;

    let hitRatio = 0;
    for (const siblingId of source.outgoing) {
        const sibling = topology.edgeById.get(siblingId);
        if (!sibling) continue;

        const siblingTarget = topology.nodeById.get(sibling.target);
        if (siblingTarget?.definition.group !== 'cache') continue;

        const runtime = runtimes.get(siblingTarget.id);
        if (runtime?.hitRatio) hitRatio = Math.max(hitRatio, runtime.hitRatio);
    }

    return hitRatio <= 0 || !rng.bernoulli(hitRatio);
}
