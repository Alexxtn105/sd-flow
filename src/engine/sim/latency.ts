import { DEFAULT_RTT_MS } from './constants';
import type { CompiledEdge, CompiledNode, CompiledTopology } from './compile';
import type { Flow } from './flows';
import { lagWaitSec, replicaReadShare } from './replication';
import { selfAbsorption } from './solver';
import type { NodeRuntime, OperationFlow } from './solver';
import type { Rng } from './rng';
import type {
    FlowResult,
    FlowWaterfall,
    HistogramScale,
    HopArm,
    HopStat,
    LatencyHistogram,
    WaterfallHop,
} from './types';

export const MAX_WALK_DEPTH = 12;
const MAX_CALLS_PER_EDGE = 16;
const MAX_TAIL_SIGMA = 2;
const BACKOFF_BASE_SEC = 0.05;
const PERCENTILE_WINDOW_SHARE = 0.005;
const BALANCING_GROUPS = new Set(['edge', 'clients']);
const ABSORBING_TARGET_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'storage']);
const QUORUM_ACK_SHARE: Record<string, number> = { sync: 1, 'semi-sync': 0.5 };
const REPLICA_COUNT_PARAMS = ['readReplicas', 'replicas'];
const REPLICA_SET_PARAMS = ['replicationFactor', 'replicaSetSize'];

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

interface CallPlan {
    edges: CompiledEdge[];
    callsPerRequest: number[];
    balanced: boolean;
    liveEdges: CompiledEdge[];
    liveReadWeights: number[];
    liveWriteWeights: number[];
    parallel: boolean;
    replicationAckSec: number;
    lagWaitSec: number;
    lagReadShare: number;
}

export interface LatencySamples {
    sampleCount: number;
    seriesFor: (flowId: string, nodeId: string) => Float64Array | null;
}

export interface LatencyRollup {
    flows: FlowResult[];
    waterfalls: FlowWaterfall[];
    samples: LatencySamples;
    truncated: boolean;
}

export interface HistogramRequest {
    buckets: number;
    scale: HistogramScale;
}

export const DEFAULT_HISTOGRAM_BUCKETS = 40;

export const MAX_HISTOGRAM_BUCKETS = 200;

function quantile(sorted: ArrayLike<number>, probability: number): number {
    if (sorted.length === 0) return 0;

    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);

    if (lower === upper) return sorted[lower];

    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function bucketCount(requested: number): number {
    if (!Number.isFinite(requested)) return DEFAULT_HISTOGRAM_BUCKETS;

    return Math.max(1, Math.min(MAX_HISTOGRAM_BUCKETS, Math.round(requested)));
}

function sortedFinite(series: ArrayLike<number>): Float64Array {
    const kept = new Float64Array(series.length);
    let size = 0;

    for (let index = 0; index < series.length; index += 1) {
        const value = series[index];
        if (Number.isFinite(value)) {
            kept[size] = value;
            size += 1;
        }
    }

    const values = kept.subarray(0, size);
    values.sort();

    return values;
}

export function buildLatencyHistogram(series: ArrayLike<number>, request: HistogramRequest): LatencyHistogram {
    const count = bucketCount(request.buckets);
    const sorted = sortedFinite(series);
    const total = sorted.length;

    let zeroCount = 0;
    while (zeroCount < total && sorted[zeroCount] <= 0) zeroCount += 1;

    const scale: HistogramScale = request.scale === 'log' && zeroCount < total ? 'log' : 'linear';
    const low = scale === 'log' ? sorted[zeroCount] : total > 0 ? sorted[0] : 0;
    const high = total > 0 ? sorted[total - 1] : 0;

    const lowSpace = scale === 'log' ? Math.log10(low) : low;
    const highSpace = scale === 'log' ? Math.log10(high) : high;
    const topSpace = highSpace > lowSpace ? highSpace : lowSpace + 1;
    const span = topSpace - lowSpace;

    const edges: number[] = [];
    for (let index = 0; index <= count; index += 1) {
        const point = lowSpace + (span * index) / count;
        edges.push(scale === 'log' ? 10 ** point : point);
    }
    edges[0] = low;
    if (highSpace > lowSpace) edges[count] = high;

    const counts = new Array<number>(count).fill(0);
    let sum = 0;

    for (let index = 0; index < total; index += 1) {
        const value = sorted[index];
        sum += value;

        const point = scale === 'log' ? (value > 0 ? Math.log10(value) : lowSpace) : value;
        const slot = Math.floor(((point - lowSpace) / span) * count);
        counts[Math.min(count - 1, Math.max(0, slot))] += 1;
    }

    return {
        scale,
        edges,
        counts,
        total,
        zeroCount,
        meanMs: total > 0 ? sum / total : 0,
        p50Ms: quantile(sorted, 0.5),
        p95Ms: quantile(sorted, 0.95),
        p99Ms: quantile(sorted, 0.99),
    };
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

function routableEdges(node: CompiledNode, topology: CompiledTopology): CompiledEdge[] {
    return node.outgoing
        .map((edgeId) => topology.edgeById.get(edgeId))
        .filter((edge): edge is CompiledEdge => edge !== undefined && !edge.isReplication);
}

function branchWeights(edges: CompiledEdge[], edgeFlows: ReadonlyMap<string, OperationFlow>): number[] {
    const routed = edges.map((edge) => Math.max(edgeFlows.get(edge.id)?.total ?? 0, 0));
    if (routed.some((value) => value > 0)) return routed;

    return edges.map((edge) => Math.max(edge.weight, 0));
}

function operationWeights(
    edges: CompiledEdge[],
    edgeFlows: ReadonlyMap<string, OperationFlow>,
    pick: (flow: OperationFlow) => number,
    fallback: number[],
): number[] {
    const routed = edges.map((edge) => {
        const flow = edgeFlows.get(edge.id);

        return flow ? Math.max(pick(flow), 0) : 0;
    });

    return routed.some((value) => value > 0) ? routed : fallback;
}

function trafficShareOf(
    source: CompiledNode,
    edge: CompiledEdge,
    topology: CompiledTopology,
    edgeFlows: ReadonlyMap<string, OperationFlow>,
): number {
    if (!BALANCING_GROUPS.has(source.definition.group)) return 1;

    const siblings = routableEdges(source, topology).filter((item) => !item.isAsync);
    const weights = branchWeights(siblings, edgeFlows);
    const total = weights.reduce((sum, value) => sum + value, 0);
    const index = siblings.findIndex((item) => item.id === edge.id);

    if (total > 0 && index >= 0) return weights[index] / total;

    return siblings.length > 0 ? 1 / siblings.length : 1;
}

function callsPerRequestOf(edge: CompiledEdge): number {
    return edge.calls.reduce((sum, call) => sum + call.share * Math.max(call.fanout, 0), 0);
}

export function tailAtScaleFactor(sample: number[], total: number, drawn: number): number {
    if (total <= drawn || drawn < 2) return 1;

    const logs = sample.filter((value) => value > 0).map(Math.log);
    if (logs.length < 2) return 1;

    const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
    const variance = logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (logs.length - 1);
    const sigma = Math.min(Math.sqrt(variance), MAX_TAIL_SIGMA);
    if (!(sigma > 0)) return 1;

    return Math.exp(sigma * (Math.sqrt(2 * Math.log(total)) - Math.sqrt(2 * Math.log(drawn))));
}

function sampleCallCount(callsPerRequest: number, rng: Rng): number {
    if (callsPerRequest <= 0) return 0;

    const whole = Math.floor(callsPerRequest);
    const fraction = callsPerRequest - whole;

    return whole + (fraction > 0 && rng.bernoulli(fraction) ? 1 : 0);
}

function pickBalancedEdge(edges: CompiledEdge[], weights: number[], rng: Rng): CompiledEdge {
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (totalWeight <= 0) return edges[Math.min(Math.floor(rng.next() * edges.length), edges.length - 1)];

    let ticket = rng.next() * totalWeight;

    for (let index = 0; index < edges.length; index += 1) {
        ticket -= weights[index];
        if (ticket <= 0) return edges[index];
    }

    return edges[edges.length - 1];
}

function replicationRttMs(node: CompiledNode, topology: CompiledTopology): number {
    let slowest = 0;

    for (const edgeId of node.outgoing) {
        const edge = topology.edgeById.get(edgeId);
        if (edge?.isReplication) slowest = Math.max(slowest, edge.networkMs);
    }

    return slowest;
}

function hasReplicas(node: CompiledNode): boolean {
    for (const name of REPLICA_COUNT_PARAMS) {
        const value = node.params[name];
        if (typeof value === 'number' && value > 0) return true;
    }

    for (const name of REPLICA_SET_PARAMS) {
        const value = node.params[name];
        if (typeof value === 'number' && value > 1) return true;
    }

    return node.params.multiAz === true;
}

function replicationAckSec(node: CompiledNode, topology: CompiledTopology): number {
    const ackShare = QUORUM_ACK_SHARE[String(node.params.replicationMode ?? '')] ?? 0;
    if (ackShare <= 0) return 0;

    const drawnRttMs = replicationRttMs(node, topology);
    if (drawnRttMs > 0) return (ackShare * drawnRttMs) / 1000;

    return hasReplicas(node) ? (ackShare * DEFAULT_RTT_MS['cross-az']) / 1000 : 0;
}

function sampleQueueWaitSec(runtime: NodeRuntime, rng: Rng): number {
    const meanWaitSec = runtime.queue.waitSec;
    if (meanWaitSec <= 0) return 0;

    const queueFull = runtime.queue.queueFullShare ?? 0;

    return meanWaitSec * (queueFull + (1 - queueFull) * rng.exponential(1));
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
    edgeFlows: ReadonlyMap<string, OperationFlow>,
    rng: Rng,
    sampleCount: number,
): LatencyRollup {
    const flowResults: FlowResult[] = [];
    const waterfalls: FlowWaterfall[] = [];
    const plans = new Map<string, CallPlan>();
    const sitesByFlow = new Map<string, CallSite[]>();
    let truncated = false;

    const planFor = (node: CompiledNode): CallPlan => {
        const known = plans.get(node.id);
        if (known) return known;

        const edges = routableEdges(node, topology);
        const synchronous = edges.filter((edge) => !edge.isAsync);
        const live = synchronous.filter((edge) => runtimes.get(edge.target)?.boundBy !== 'disabled');
        const liveEdges = live.length > 0 ? live : synchronous;
        const liveWeights = branchWeights(liveEdges, edgeFlows);
        const utilization = runtimes.get(node.id)?.queue.utilization ?? 0;
        const plan: CallPlan = {
            edges,
            callsPerRequest: edges.map(callsPerRequestOf),
            balanced: BALANCING_GROUPS.has(node.definition.group),
            liveEdges,
            liveReadWeights: operationWeights(liveEdges, edgeFlows, (flow) => flow.read, liveWeights),
            liveWriteWeights: operationWeights(liveEdges, edgeFlows, (flow) => flow.write, liveWeights),
            parallel: node.params.callMode === 'parallel',
            replicationAckSec: replicationAckSec(node, topology),
            lagWaitSec: lagWaitSec(node.params, utilization),
            lagReadShare: replicaReadShare(node.params),
        };

        plans.set(node.id, plan);
        return plan;
    };

    for (const flow of flows) {
        const hops = new Map<string, HopAccumulator>();
        const callSites = new Map<string, CallSite>();
        const callSiteList: CallSite[] = [];
        sitesByFlow.set(flow.id, callSiteList);
        const logSite: number[] = [];
        const logSec: number[] = [];
        const totals: number[] = [];
        let failures = 0;
        let timeouts = 0;
        let deepest = 0;
        let writeSample = false;

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
                trafficShare: source ? trafficShareOf(source, edge, topology, edgeFlows) : 1,
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

        const scaleRange = (from: number, to: number, factor: number): void => {
            for (let index = from; index < to; index += 1) logSec[index] *= factor;
        };

        const discard = (from: number, to: number): void => {
            for (let index = from; index < to; index += 1) logSec[index] = 0;
        };

        const callChildren = (
            node: CompiledNode,
            depth: number,
            visited: Set<string>,
        ): { durations: number[]; spans: { from: number; to: number }[]; failed: boolean; timedOut: boolean } => {
            const plan = planFor(node);
            const durations: number[] = [];
            const spans: { from: number; to: number }[] = [];
            let failed = false;
            let timedOut = false;

            if (plan.edges.length === 0) return { durations, spans, failed, timedOut };

            const weights = writeSample ? plan.liveWriteWeights : plan.liveReadWeights;
            const chosen = plan.balanced ? pickBalancedEdge(plan.liveEdges, weights, rng) : null;

            for (let index = 0; index < plan.edges.length; index += 1) {
                const edge = plan.edges[index];
                if (chosen !== null && edge !== chosen) continue;
                if (edge.isAsync) continue;

                const calls = sampleCallCount(plan.callsPerRequest[index], rng);
                const sampled = Math.min(calls, MAX_CALLS_PER_EDGE);
                const edgeFrom = logSec.length;
                const durationsFrom = durations.length;

                for (let call = 0; call < sampled; call += 1) {
                    if (!shouldFollow(edge, node.id, topology, runtimes, rng)) continue;

                    const from = logSec.length;
                    const outcome = attempt(edge, depth, visited);

                    durations.push(outcome.seconds);
                    spans.push({ from, to: logSec.length });

                    if (outcome.failed) failed = true;
                    if (outcome.timedOut) timedOut = true;
                }

                if (calls <= sampled || durations.length === durationsFrom) continue;

                if (!plan.parallel) {
                    const scale = calls / sampled;
                    rescale(edgeFrom, scale);
                    for (let item = durationsFrom; item < durations.length; item += 1) durations[item] *= scale;
                    continue;
                }

                const drawn = durations.slice(durationsFrom);
                const factor = tailAtScaleFactor(drawn, calls, drawn.length);
                if (factor <= 1) continue;

                let slowest = durationsFrom;
                for (let item = durationsFrom + 1; item < durations.length; item += 1) {
                    if (durations[item] > durations[slowest]) slowest = item;
                }

                durations[slowest] *= factor;
                scaleRange(spans[slowest].from, spans[slowest].to, factor);
            }

            return { durations, spans, failed, timedOut };
        };

        const walk = (
            nodeId: string,
            depth: number,
            visited: Set<string>,
            siteIndex: number,
        ): WalkOutcome => {
            const node = topology.nodeById.get(nodeId);
            const runtime = runtimes.get(nodeId);

            if (depth > MAX_WALK_DEPTH) truncated = true;

            if (!node || !runtime || depth > MAX_WALK_DEPTH || visited.has(nodeId)) {
                return { seconds: 0, failed: false, timedOut: false };
            }

            visited.add(nodeId);
            deepest = Math.max(deepest, depth);

            const plan = planFor(node);
            const sigma = Number(node.params.serviceTimeSigma ?? 0.4);
            const serviceSec = runtime.serviceSec > 0 ? rng.logNormal(runtime.serviceSec, sigma) : 0;
            const queueWaitSec = sampleQueueWaitSec(runtime, rng);
            const ackSec = writeSample ? plan.replicationAckSec : 0;
            const catchUpSec =
                !writeSample && plan.lagWaitSec > 0 && rng.bernoulli(plan.lagReadShare)
                    ? plan.lagWaitSec
                    : 0;
            const waitSec = queueWaitSec + ackSec + catchUpSec;

            let selfSeconds = serviceSec + waitSec;
            let failed = rng.bernoulli(runtime.queue.overflowProbability);
            let timedOut = false;

            const site = callSiteList[siteIndex];
            site.visits += 1;
            site.serviceSec += serviceSec;
            site.waitSec += waitSec;
            record(siteIndex, serviceSec + waitSec);

            const children = callChildren(node, depth, visited);
            if (children.failed) failed = true;
            if (children.timedOut) timedOut = true;

            if (children.durations.length > 0) {
                if (plan.parallel) {
                    let slowest = 0;
                    for (let index = 1; index < children.durations.length; index += 1) {
                        if (children.durations[index] > children.durations[slowest]) slowest = index;
                    }
                    for (let index = 0; index < children.spans.length; index += 1) {
                        if (index !== slowest) discard(children.spans[index].from, children.spans[index].to);
                    }
                    selfSeconds += children.durations[slowest];
                } else {
                    selfSeconds += children.durations.reduce((sum, value) => sum + value, 0);
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

            if (runtimes.get(edge.target)?.down === true) {
                const attempts = edge.policy.circuitBreaker ? 1 : edge.policy.retries + 1;
                const waitSec = timeoutSec > 0 ? timeoutSec : networkSec;

                for (let tryIndex = 0; tryIndex < attempts; tryIndex += 1) {
                    elapsed += waitSec;
                    site.networkSec += waitSec;
                    record(siteIndex, waitSec);
                }

                return { seconds: elapsed, failed: true, timedOut: timeoutSec > 0 };
            }

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

        for (let sample = 0; sample < sampleCount; sample += 1) {
            let total = 0;
            let failed = false;
            let timedOut = false;
            writeSample = rng.bernoulli(1 - flow.readShare);

            if (entry) {
                const children = callChildren(entry, 1, new Set([flow.entryNodeId]));

                total = children.durations.reduce((sum, value) => sum + value, 0);
                failed = children.failed;
                timedOut = children.timedOut;
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
                visitsPerRequest: item.visits / Math.max(sampleCount, 1),
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
                visitsPerRequest: site.visits / Math.max(sampleCount, 1),
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

    const samples: LatencySamples = {
        sampleCount,
        seriesFor: (flowId, nodeId) => {
            const sites = (sitesByFlow.get(flowId) ?? []).filter((site) => site.nodeId === nodeId);
            if (sites.length === 0) return null;
            if (sites.length === 1) return sites[0].series;

            const summed = new Float64Array(sampleCount);
            for (const site of sites) {
                for (let index = 0; index < sampleCount; index += 1) summed[index] += site.series[index];
            }

            return summed;
        },
    };

    return { flows: flowResults, waterfalls, samples, truncated };
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
