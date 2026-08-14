import type { CompiledEdge, CompiledNode, CompiledTopology } from './compile';
import type { Flow } from './flows';
import { selfAbsorption } from './solver';
import type { NodeRuntime } from './solver';
import type { Rng } from './rng';
import type { FlowResult, FlowWaterfall, HopArm, HopStat, WaterfallHop } from './types';

const MAX_WALK_DEPTH = 12;
const BACKOFF_BASE_SEC = 0.05;
const PERCENTILE_WINDOW_SHARE = 0.005;
const BALANCING_GROUPS = new Set(['edge', 'clients']);
const ABSORBING_TARGET_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'storage']);

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

interface CallSite {
    index: number;
    edgeId: string;
    nodeId: string;
    parentNodeId: string;
    depth: number;
    arm: HopArm;
    trafficShare: number;
    callsPerRequest: number;
    cacheMissShare: number | null;
    visits: number;
    serviceSec: number;
    waitSec: number;
    networkSec: number;
    retrySec: number;
    series: Float64Array;
}

export interface LatencyRollup {
    flows: FlowResult[];
    waterfalls: FlowWaterfall[];
}

function quantile(sorted: number[], probability: number): number {
    if (sorted.length === 0) return 0;

    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);

    if (lower === upper) return sorted[lower];

    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function windowMean(series: Float64Array, order: number[], probability: number): number {
    const count = order.length;
    if (count === 0) return 0;

    const half = Math.max(1, Math.round(count * PERCENTILE_WINDOW_SHARE));
    const centre = Math.round((count - 1) * probability);
    const from = Math.max(0, centre - half);
    const to = Math.min(count - 1, centre + half);

    let sum = 0;
    for (let index = from; index <= to; index += 1) sum += series[order[index]];

    return sum / (to - from + 1);
}

function trafficShareOf(source: CompiledNode, edge: CompiledEdge, topology: CompiledTopology): number {
    if (!BALANCING_GROUPS.has(source.definition.group)) return 1;

    const siblings = source.outgoing
        .map((edgeId) => topology.edgeById.get(edgeId))
        .filter((item): item is CompiledEdge => item !== undefined && !item.isReplication);

    const totalWeight = siblings.reduce((sum, item) => sum + Math.max(item.weight, 0), 0);
    if (totalWeight > 0) return Math.max(edge.weight, 0) / totalWeight;

    return siblings.length > 0 ? 1 / siblings.length : 1;
}

function callsPerRequestOf(edge: CompiledEdge): number {
    return edge.calls.reduce((sum, call) => sum + call.share * Math.max(call.fanout, 0), 0);
}

function siblingCacheHitRatio(
    source: CompiledNode,
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
): number {
    let hitRatio = 0;

    for (const siblingId of source.outgoing) {
        const sibling = topology.edgeById.get(siblingId);
        if (!sibling) continue;

        const siblingTarget = topology.nodeById.get(sibling.target);
        if (siblingTarget?.definition.group !== 'cache') continue;

        const runtime = runtimes.get(siblingTarget.id);
        if (runtime?.hitRatio) hitRatio = Math.max(hitRatio, runtime.hitRatio);
    }

    return hitRatio;
}

function cacheMissShareOf(
    source: CompiledNode,
    target: CompiledNode,
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
): number | null {
    const own = selfAbsorption(source);
    if (own > 0) return 1 - own;

    if (!ABSORBING_TARGET_GROUPS.has(target.definition.group)) return null;

    const hitRatio = siblingCacheHitRatio(source, topology, runtimes);
    return hitRatio > 0 ? 1 - hitRatio : null;
}

export function rollUpLatency(
    topology: CompiledTopology,
    flows: Flow[],
    runtimes: Map<string, NodeRuntime>,
    rng: Rng,
    sampleCount: number,
): LatencyRollup {
    const flowResults: FlowResult[] = [];
    const waterfalls: FlowWaterfall[] = [];

    for (const flow of flows) {
        const hops = new Map<string, HopAccumulator>();
        const callSites = new Map<string, CallSite>();
        const callSiteList: CallSite[] = [];
        const logSite: number[] = [];
        const logSec: number[] = [];
        const totals: number[] = [];
        let failures = 0;
        let timeouts = 0;
        let deepest = 0;

        const siteFor = (edge: CompiledEdge, depth: number): number => {
            const known = callSites.get(edge.id);
            if (known) {
                known.depth = Math.min(known.depth, depth);
                return known.index;
            }

            const source = topology.nodeById.get(edge.source);
            const target = topology.nodeById.get(edge.target);

            const site: CallSite = {
                index: callSiteList.length,
                edgeId: edge.id,
                nodeId: edge.target,
                parentNodeId: edge.source,
                depth,
                arm: source?.params.callMode === 'parallel' ? 'parallel' : 'sequential',
                trafficShare: source ? trafficShareOf(source, edge, topology) : 1,
                callsPerRequest: callsPerRequestOf(edge),
                cacheMissShare:
                    source && target ? cacheMissShareOf(source, target, topology, runtimes) : null,
                visits: 0,
                serviceSec: 0,
                waitSec: 0,
                networkSec: 0,
                retrySec: 0,
                series: new Float64Array(sampleCount),
            };

            callSites.set(edge.id, site);
            callSiteList.push(site);
            return site.index;
        };

        const record = (siteIndex: number, seconds: number): void => {
            logSite.push(siteIndex);
            logSec.push(seconds);
        };

        const rescale = (from: number, factor: number): void => {
            for (let index = from; index < logSec.length; index += 1) logSec[index] *= factor;
        };

        const discard = (from: number, to: number): void => {
            for (let index = from; index < to; index += 1) logSec[index] = 0;
        };

        const walk = (
            nodeId: string,
            depth: number,
            visited: Set<string>,
            siteIndex: number,
        ): WalkOutcome => {
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

            const site = callSiteList[siteIndex];
            site.visits += 1;
            site.serviceSec += serviceSec;
            site.waitSec += waitSec;
            record(siteIndex, serviceSec + waitSec);

            const childDurations: number[] = [];
            const childSpans: { from: number; to: number }[] = [];
            const parallel = node.params.callMode === 'parallel';

            for (const edgeId of node.outgoing) {
                const edge = topology.edgeById.get(edgeId);
                if (!edge || edge.isAsync || edge.isReplication) continue;

                const target = topology.nodeById.get(edge.target);
                if (!target) continue;

                if (!shouldFollow(edge, node.id, topology, runtimes, rng)) continue;

                const from = logSec.length;
                const outcome = attempt(edge, depth, visited);
                childDurations.push(outcome.seconds);
                childSpans.push({ from, to: logSec.length });

                if (outcome.failed) failed = true;
                if (outcome.timedOut) timedOut = true;
            }

            if (childDurations.length > 0) {
                if (parallel) {
                    let slowest = 0;
                    for (let index = 1; index < childDurations.length; index += 1) {
                        if (childDurations[index] > childDurations[slowest]) slowest = index;
                    }
                    for (let index = 0; index < childSpans.length; index += 1) {
                        if (index !== slowest) discard(childSpans[index].from, childSpans[index].to);
                    }
                    selfSeconds += childDurations[slowest];
                } else {
                    selfSeconds += childDurations.reduce((sum, value) => sum + value, 0);
                }
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
            const siteIndex = siteFor(edge, depth);
            const site = callSiteList[siteIndex];
            let elapsed = 0;
            let failed = false;
            let timedOut = false;

            for (let tryIndex = 0; tryIndex <= edge.policy.retries; tryIndex += 1) {
                if (tryIndex > 0) {
                    const backoffSec = BACKOFF_BASE_SEC * Math.pow(2, tryIndex - 1);
                    elapsed += backoffSec;
                    site.retrySec += backoffSec;
                    record(siteIndex, backoffSec);
                }

                const legFrom = logSec.length;
                site.networkSec += networkSec;
                record(siteIndex, networkSec);

                const child = walk(edge.target, depth + 1, visited, siteIndex);
                let leg = networkSec + child.seconds;

                if (timeoutSec > 0 && leg > timeoutSec) {
                    rescale(legFrom, leg > 0 ? timeoutSec / leg : 0);
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

            for (let index = 0; index < logSec.length; index += 1) {
                callSiteList[logSite[index]].series[sample] += logSec[index] * 1000;
            }
            logSite.length = 0;
            logSec.length = 0;

            totals.push(total * 1000);
            if (failed) failures += 1;
            if (timedOut) timeouts += 1;
        }

        const order = totals.map((_, index) => index).sort((left, right) => totals[left] - totals[right]);
        const samples = order.map((index) => totals[index]);

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

        const latency = {
            mean,
            p50: quantile(samples, 0.5),
            p95: quantile(samples, 0.95),
            p99: quantile(samples, 0.99),
        };

        const waterfallHops: WaterfallHop[] = callSiteList.map((site) => {
            let sum = 0;
            for (let index = 0; index < site.series.length; index += 1) sum += site.series[index];

            return {
                edgeId: site.edgeId,
                nodeId: site.nodeId,
                parentNodeId: site.parentNodeId,
                depth: site.depth,
                arm: site.arm,
                shareOfRequests: site.visits / Math.max(sampleCount, 1),
                trafficShare: site.trafficShare,
                callsPerRequest: site.callsPerRequest,
                cacheMissShare: site.cacheMissShare,
                meanMs: sum / Math.max(sampleCount, 1),
                serviceMs: (site.serviceSec / Math.max(sampleCount, 1)) * 1000,
                waitMs: (site.waitSec / Math.max(sampleCount, 1)) * 1000,
                networkMs: (site.networkSec / Math.max(sampleCount, 1)) * 1000,
                retryMs: (site.retrySec / Math.max(sampleCount, 1)) * 1000,
                p50Ms: windowMean(site.series, order, 0.5),
                p95Ms: windowMean(site.series, order, 0.95),
                p99Ms: windowMean(site.series, order, 0.99),
            };
        });

        flowResults.push({
            id: flow.id,
            entryNodeId: flow.entryNodeId,
            rps: flow.rps,
            readShare: flow.readShare,
            latency,
            errorRate: failures / Math.max(sampleCount, 1),
            availability: 1 - failures / Math.max(sampleCount, 1),
            timeoutShare: timeouts / Math.max(sampleCount, 1),
            hops: hopStats,
            depth: deepest,
        });

        waterfalls.push({
            flowId: flow.id,
            entryNodeId: flow.entryNodeId,
            total: latency,
            covered: {
                p50: waterfallHops.reduce((sum, hop) => sum + hop.p50Ms, 0),
                p95: waterfallHops.reduce((sum, hop) => sum + hop.p95Ms, 0),
                p99: waterfallHops.reduce((sum, hop) => sum + hop.p99Ms, 0),
            },
            hops: waterfallHops,
        });
    }

    return { flows: flowResults, waterfalls };
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

    if (!ABSORBING_TARGET_GROUPS.has(target.definition.group)) return true;

    const hitRatio = siblingCacheHitRatio(source, topology, runtimes);

    return hitRatio <= 0 || !rng.bernoulli(hitRatio);
}
