import registry from '../ComponentRegistry';
import type { ComponentParams, Explain, ParamValue } from '../types/component';
import type { SchemeV1 } from '../types/scheme';
import { redundancyOfNode } from './availability';
import type { CompiledNode, CompiledTopology } from './compile';
import { DAYS_PER_MONTH, HOURS_PER_MONTH } from './constants';
import type {
    EdgeResult,
    FlowResult,
    FlowWaterfall,
    NodeResult,
    ProbeNoDataReason,
    ProbeReading,
    ProbeStatus,
    Totals,
} from './types';

export const PROBE_BACKUP_COPIES = 1;

const DAYS_PER_YEAR = 365;

const MINUTES_PER_DAY = 1440;

const WARN_BUDGET_SHARE = 0.8;

const QUEUE_WARN_SHARE = 0.5;

const PERIOD_FACTOR: Record<string, number> = {
    hour: 1 / HOURS_PER_MONTH,
    day: 1 / DAYS_PER_MONTH,
    month: 1,
    year: 12,
};

const PERIOD_UNIT: Record<string, string> = {
    hour: 'usdHour',
    day: 'usdDay',
    month: 'usdMonth',
    year: 'usdYear',
};

export interface ProbeSpec {
    id: string;
    type: string;
    params: ComponentParams;
    targetNodeId: string | null;
}

export interface ProbeContext {
    topology: CompiledTopology;
    nodes: Record<string, NodeResult>;
    edges: Record<string, EdgeResult>;
    flows: FlowResult[];
    waterfalls: FlowWaterfall[];
    totals: Totals;
}

export function isProbeType(type: string): boolean {
    return registry.get(type)?.shape === 'probe';
}

export function collectProbes(scheme: SchemeV1): ProbeSpec[] {
    const attachedTo = new Map<string, string>();

    for (const edge of scheme.edges) {
        if (attachedTo.has(edge.target)) continue;
        attachedTo.set(edge.target, edge.source);
    }

    return scheme.nodes
        .filter((node) => isProbeType(node.type))
        .map((node) => ({
            id: node.id,
            type: node.type,
            params: { ...registry.getDefaultParams(node.type), ...node.params },
            targetNodeId: attachedTo.get(node.id) ?? null,
        }));
}

export function withoutProbes(scheme: SchemeV1): SchemeV1 {
    const probeIds = new Set(scheme.nodes.filter((node) => isProbeType(node.type)).map((node) => node.id));
    if (probeIds.size === 0) return scheme;

    return {
        ...scheme,
        nodes: scheme.nodes.filter((node) => !probeIds.has(node.id)),
        edges: scheme.edges.filter((edge) => !probeIds.has(edge.source) && !probeIds.has(edge.target)),
    };
}

function numeric(params: ComponentParams, key: string, fallback: number): number {
    const value = params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function flag(params: ComponentParams, key: string, fallback: boolean): boolean {
    const value = params[key];
    return typeof value === 'boolean' ? value : fallback;
}

function option(params: ComponentParams, key: string, fallback: string): string {
    const value = params[key];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function explain(
    formula: string,
    inputs: Record<string, number | string>,
    result: number,
    unit: string,
): Explain {
    return { formula, inputs, result, unit };
}

function noData(
    spec: ProbeSpec,
    reason: ProbeNoDataReason,
    inputs: Record<string, number | string> = {},
): ProbeReading {
    return {
        probeId: spec.id,
        componentType: spec.type,
        targetNodeId: spec.targetNodeId,
        flowId: null,
        status: 'no-data',
        reason,
        value: Number.NaN,
        unit: 'none',
        explain: explain(`no-data(${reason})`, inputs, Number.NaN, 'none'),
    };
}

function reading(
    spec: ProbeSpec,
    status: ProbeStatus,
    value: number,
    unit: string,
    detail: Explain,
    flowId: string | null = null,
): ProbeReading {
    return {
        probeId: spec.id,
        componentType: spec.type,
        targetNodeId: spec.targetNodeId,
        flowId,
        status,
        reason: null,
        value,
        unit,
        explain: detail,
    };
}

function thresholdStatus(value: number, warn: number, alarm: number): ProbeStatus {
    if (value >= alarm) return 'breach';
    if (value >= warn) return 'warn';
    return 'ok';
}

function subtreeOf(topology: CompiledTopology, rootId: string): string[] {
    const visited = new Set<string>([rootId]);
    const queue = [rootId];

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

    return [...visited];
}

function flowCovering(context: ProbeContext, nodeId: string): FlowResult | null {
    const direct = context.flows.find((flow) => flow.entryNodeId === nodeId);
    if (direct) return direct;

    let best: FlowResult | null = null;
    let bestShare = 0;

    for (const flow of context.flows) {
        const hop = flow.hops.find((item) => item.nodeId === nodeId);
        if (!hop) continue;

        if (!best || hop.shareOfRequests * flow.rps > bestShare) {
            best = flow;
            bestShare = hop.shareOfRequests * flow.rps;
        }
    }

    return best;
}

function waterfallOf(context: ProbeContext, flowId: string): FlowWaterfall | null {
    return context.waterfalls.find((item) => item.flowId === flowId) ?? null;
}

function incomingRps(context: ProbeContext, node: CompiledNode): EdgeResult[] {
    return node.incoming
        .map((edgeId) => context.edges[edgeId])
        .filter((edge): edge is EdgeResult => edge !== undefined);
}

function paramSnapshot(params: ComponentParams, keys: string[]): Record<string, number | string> {
    const snapshot: Record<string, number | string> = {};

    for (const key of keys) {
        const value: ParamValue | undefined = params[key];
        if (value === undefined) continue;
        snapshot[key] = typeof value === 'boolean' ? String(value) : value;
    }

    return snapshot;
}

type ProbeCalculator = (
    spec: ProbeSpec,
    node: CompiledNode,
    metrics: NodeResult,
    context: ProbeContext,
) => ProbeReading;

const rpsProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void node;
    void context;
    const dropped = Math.max(metrics.lambdaOffered - metrics.throughput, 0);

    return reading(
        spec,
        dropped > metrics.lambdaOffered * 1e-6 ? 'breach' : 'ok',
        metrics.throughput,
        'rps',
        explain(
            'throughput = min(λ_nominal × (1 + retryAmplification), capacity)',
            {
                'λ_nominal': metrics.lambdaNominal,
                retryAmplification: metrics.retryAmplification,
                'λ_offered': metrics.lambdaOffered,
                capacity: metrics.capacity,
                read: metrics.throughput * metrics.readShare,
                write: metrics.throughput * metrics.writeShare,
                dropped,
                ...paramSnapshot(spec.params, ['windowSec', 'splitByOperation', 'splitByFlow']),
            },
            metrics.throughput,
            'rps',
        ),
    );
};

const latencyProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void node;
    const flow = flowCovering(context, spec.targetNodeId as string);
    if (!flow) return noData(spec, 'no-flow');

    const waterfall = waterfallOf(context, flow.id);
    const hop = waterfall?.hops.find((item) => item.nodeId === spec.targetNodeId) ?? null;

    if (!hop) {
        const own = (metrics.serviceSec + metrics.waitSec) * 1000;
        return reading(
            spec,
            'ok',
            own,
            'ms',
            explain(
                'ownLatency = (S + W_q) × 1000',
                { S: metrics.serviceSec, W_q: metrics.waitSec },
                own,
                'ms',
            ),
            flow.id,
        );
    }

    return reading(
        spec,
        'ok',
        hop.p99Ms,
        'ms',
        explain(
            'вклад точки в задержку потока по квантилям Monte-Carlo',
            {
                p50: hop.p50Ms,
                p95: hop.p95Ms,
                p99: hop.p99Ms,
                service: hop.serviceMs,
                queueWait: hop.waitMs,
                network: hop.networkMs,
                ...paramSnapshot(spec.params, ['buckets', 'scale', 'showQueueWait']),
            },
            hop.p99Ms,
            'ms',
        ),
        flow.id,
    );
};

const utilizationProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void node;
    void context;
    if (!Number.isFinite(metrics.capacity)) return noData(spec, 'unsupported-target');

    const warn = numeric(spec.params, 'warnThreshold', 0.7);
    const alarm = numeric(spec.params, 'alarmThreshold', 0.9);

    return reading(
        spec,
        thresholdStatus(metrics.utilization, warn, alarm),
        metrics.utilization * 100,
        'percent',
        explain(
            'ρ = λ_offered / capacity',
            {
                'λ_offered': metrics.lambdaOffered,
                capacity: metrics.capacity,
                boundBy: metrics.boundBy,
                instances: metrics.instances,
                warnThreshold: warn,
                alarmThreshold: alarm,
            },
            metrics.utilization * 100,
            'percent',
        ),
    );
};

const queueProbe: ProbeCalculator = (spec, node, metrics, context) => {
    const asyncEdges = incomingRps(context, node).filter((edge) => edge.lagSec > 0 || edge.backlog > 0);
    const isBroker = node.definition.group === 'messaging';

    if (!isBroker && asyncEdges.length === 0 && metrics.queueDepth <= 0) {
        return noData(spec, 'unsupported-target');
    }

    const lagSec = asyncEdges.reduce((max, edge) => Math.max(max, edge.lagSec), 0);
    const backlogRps = asyncEdges.reduce((sum, edge) => sum + edge.backlog, 0);
    const alarm = numeric(spec.params, 'lagAlarmSec', 60);
    const headroom = metrics.capacity - metrics.lambdaOffered;
    const drainSec = backlogRps > 0 || headroom <= 0 ? Number.POSITIVE_INFINITY : metrics.queueDepth / headroom;

    const inputs: Record<string, number | string> = {
        queueDepth: metrics.queueDepth,
        waitSec: metrics.waitSec,
        backlogRps,
        lagAlarmSec: alarm,
    };

    if (flag(spec.params, 'showTimeToDrain', true)) inputs.drainSec = drainSec;

    return reading(
        spec,
        thresholdStatus(lagSec, alarm * QUEUE_WARN_SHARE, alarm),
        lagSec,
        'sec',
        explain('lag = producerRps / consumerCapacity', inputs, lagSec, 'sec'),
    );
};

const storageProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void context;
    if (!metrics.storage) return noData(spec, 'unsupported-target');

    const horizonYears = numeric(spec.params, 'horizonYears', 3);
    const includeReplicas = flag(spec.params, 'includeReplicas', true);
    const includeBackups = flag(spec.params, 'includeBackups', true);
    const redundancy = redundancyOfNode(node, metrics.instances);

    const backupCopies = includeBackups ? PROBE_BACKUP_COPIES : 0;
    const replicaDivisor = includeReplicas ? 1 : Math.max(redundancy, 1);
    const projected =
        (metrics.storage.growthGbDay * DAYS_PER_YEAR * horizonYears * (1 + backupCopies)) / replicaDivisor;

    return reading(
        spec,
        'ok',
        projected,
        'gb',
        explain(
            'projectedGb = growthGbDay × 365 × horizonYears × (1 + backupCopies) / replicaDivisor',
            {
                growthGbDay: metrics.storage.growthGbDay,
                horizonYears,
                backupCopies,
                replicaDivisor,
                redundancy,
                currentGb: metrics.storage.totalGb,
                memoryGb: metrics.storage.memoryGb,
            },
            projected,
            'gb',
        ),
    );
};

const costProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void metrics;
    const period = option(spec.params, 'period', 'month');
    const factor = PERIOD_FACTOR[period] ?? 1;
    const subtree = subtreeOf(context.topology, node.id);

    let compute = 0;
    let storage = 0;
    let network = 0;
    let requests = 0;

    for (const nodeId of subtree) {
        const cost = context.nodes[nodeId]?.cost;
        if (!cost) continue;

        compute += cost.compute;
        storage += cost.storage;
        network += cost.network;
        requests += cost.requests;
    }

    const total = (compute + storage + network + requests) * factor;
    const schemeTotal = context.totals.costMonth * factor;
    const inputs: Record<string, number | string> = {
        blocks: subtree.length,
        period,
        shareOfScheme: schemeTotal > 0 ? total / schemeTotal : 0,
    };

    if (flag(spec.params, 'breakdown', true)) {
        inputs.compute = compute * factor;
        inputs.storage = storage * factor;
        inputs.network = network * factor;
        inputs.requests = requests * factor;
    }

    return reading(
        spec,
        'ok',
        total,
        PERIOD_UNIT[period] ?? 'usdMonth',
        explain('cost = Σ стоимость блоков поддерева × periodFactor', inputs, total, PERIOD_UNIT[period] ?? 'usdMonth'),
    );
};

const sloProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void node;
    const flow = flowCovering(context, spec.targetNodeId as string);
    if (!flow) return noData(spec, 'no-flow');

    const targetP99Ms = numeric(spec.params, 'targetP99Ms', 300);
    const targetAvailability = numeric(spec.params, 'targetAvailability', 0.999);
    const budgetDays = numeric(spec.params, 'errorBudgetDays', 30);

    const availability = Math.min(flow.availability, metrics.availability);
    const budgetMinutes = (1 - targetAvailability) * budgetDays * MINUTES_PER_DAY;
    const burnedMinutes = (1 - availability) * budgetDays * MINUTES_PER_DAY;
    const burn = budgetMinutes > 0 ? burnedMinutes / budgetMinutes : 0;
    const latencyShare = targetP99Ms > 0 ? flow.latency.p99 / targetP99Ms : 0;

    const status: ProbeStatus =
        latencyShare > 1 || burn > 1
            ? 'breach'
            : latencyShare > WARN_BUDGET_SHARE || burn > WARN_BUDGET_SHARE
              ? 'warn'
              : 'ok';

    return reading(
        spec,
        status,
        flow.latency.p99,
        'ms',
        explain(
            'p99 против targetP99Ms и доступность против targetAvailability',
            {
                p99: flow.latency.p99,
                targetP99Ms,
                availability,
                targetAvailability,
                budgetMinutes,
                burnedMinutes,
                errorBudgetDays: budgetDays,
            },
            flow.latency.p99,
            'ms',
        ),
        flow.id,
    );
};

const availabilityProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void metrics;
    const target = numeric(spec.params, 'targetAvailability', 0.999);
    const windowDays = numeric(spec.params, 'windowDays', 30);
    const subtree = subtreeOf(context.topology, node.id);

    let availability = 1;
    let weakestId = node.id;
    let weakest = 1;

    for (const nodeId of subtree) {
        const value = context.nodes[nodeId]?.availability;
        if (value === undefined) continue;

        availability *= value;
        if (value < weakest) {
            weakest = value;
            weakestId = nodeId;
        }
    }

    const budgetMinutes = (1 - target) * windowDays * MINUTES_PER_DAY;
    const downtimeMinutes = (1 - availability) * windowDays * MINUTES_PER_DAY;
    const burn = budgetMinutes > 0 ? downtimeMinutes / budgetMinutes : 0;
    const nines = availability >= 1 ? Number.POSITIVE_INFINITY : -Math.log10(1 - availability);

    const inputs: Record<string, number | string> = {
        blocks: subtree.length,
        nines,
        targetAvailability: target,
        downtimeMinutes,
        budgetMinutes,
        windowDays,
    };

    if (flag(spec.params, 'showWeakest', true)) {
        inputs.weakestNode = weakestId;
        inputs.weakestAvailability = weakest;
    }

    return reading(
        spec,
        thresholdStatus(burn, WARN_BUDGET_SHARE, 1),
        availability * 100,
        'percent',
        explain('A = Π A_блока по поддереву', inputs, availability * 100, 'percent'),
    );
};

const trafficInspectorProbe: ProbeCalculator = (spec, node, metrics, context) => {
    const groupBy = option(spec.params, 'groupBy', 'operation');
    const topN = Math.max(1, Math.round(numeric(spec.params, 'topN', 5)));
    const alarmShare = numeric(spec.params, 'errorAlarmShare', 0.01);

    const inputs: Record<string, number | string> = {
        throughput: metrics.throughput,
        errorRate: metrics.errorRate,
        errorAlarmShare: alarmShare,
        groupBy,
    };

    if (flag(spec.params, 'showBytes', true)) {
        inputs.bytesPerSec = incomingRps(context, node).reduce((sum, edge) => sum + edge.bytesPerSec, 0);
    }

    if (groupBy === 'operation') {
        const byOperation = new Map<string, number>();
        for (const edge of incomingRps(context, node)) {
            for (const [operation, value] of Object.entries(edge.byOperation)) {
                byOperation.set(operation, (byOperation.get(operation) ?? 0) + (value ?? 0));
            }
        }
        for (const [operation, value] of [...byOperation.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, topN)) {
            inputs[operation] = value;
        }
    } else if (groupBy === 'edge') {
        for (const edge of node.outgoing
            .map((edgeId) => context.edges[edgeId])
            .filter((edge): edge is EdgeResult => edge !== undefined)
            .sort((left, right) => right.rps - left.rps)
            .slice(0, topN)) {
            inputs[edge.edgeId] = edge.rps;
        }
    } else {
        for (const flow of context.flows) {
            const hop = flow.hops.find((item) => item.nodeId === node.id);
            if (!hop) continue;
            inputs[flow.id] = flow.rps * hop.shareOfRequests;
        }
    }

    return reading(
        spec,
        thresholdStatus(metrics.errorRate, alarmShare * QUEUE_WARN_SHARE, alarmShare),
        metrics.throughput,
        'rps',
        explain('разбивка потока через точку по ' + groupBy, inputs, metrics.throughput, 'rps'),
    );
};

const heatmapProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void metrics;
    const metric = option(spec.params, 'metric', 'utilization');
    const scope = option(spec.params, 'scope', 'scheme');
    const warn = numeric(spec.params, 'warnThreshold', 0.7);
    const alarm = numeric(spec.params, 'alarmThreshold', 0.9);

    const covered = scope === 'subtree' ? subtreeOf(context.topology, node.id) : Object.keys(context.nodes);

    let peak = 0;
    let hottestId = node.id;
    let warmCount = 0;
    let hotCount = 0;
    let measured = 0;

    for (const nodeId of covered) {
        const result = context.nodes[nodeId];
        if (!result) continue;
        if (metric === 'utilization' && !Number.isFinite(result.capacity)) continue;

        const value = metric === 'errors' ? result.errorRate : result.utilization;
        measured += 1;

        if (value >= alarm) hotCount += 1;
        else if (value >= warn) warmCount += 1;

        if (value > peak) {
            peak = value;
            hottestId = nodeId;
        }
    }

    if (measured === 0) return noData(spec, 'unsupported-target');

    return reading(
        spec,
        thresholdStatus(peak, warn, alarm),
        peak * 100,
        'percent',
        explain(
            'peak = max ' + metric + ' по блокам области',
            {
                scope,
                metric,
                blocks: measured,
                hottestNode: hottestId,
                overWarn: warmCount,
                overAlarm: hotCount,
                warnThreshold: warn,
                alarmThreshold: alarm,
            },
            peak * 100,
            'percent',
        ),
    );
};

const waterfallProbe: ProbeCalculator = (spec, node, metrics, context) => {
    void node;
    void metrics;
    const flow = flowCovering(context, spec.targetNodeId as string);
    if (!flow) return noData(spec, 'no-flow');

    const waterfall = waterfallOf(context, flow.id);
    if (!waterfall || waterfall.hops.length === 0) return noData(spec, 'no-flow');

    const percentile = option(spec.params, 'percentile', 'p99');
    const value =
        percentile === 'p50' ? flow.latency.p50 : percentile === 'p95' ? flow.latency.p95 : flow.latency.p99;
    const covered =
        percentile === 'p50'
            ? waterfall.covered.p50
            : percentile === 'p95'
              ? waterfall.covered.p95
              : waterfall.covered.p99;

    const parallelHops = waterfall.hops.filter((hop) => hop.arm === 'parallel').length;
    const splitHops = waterfall.hops.filter((hop) => hop.trafficShare < 1).length;
    const fanoutHops = waterfall.hops.filter((hop) => hop.callsPerRequest > 1).length;

    return reading(
        spec,
        'ok',
        value,
        'ms',
        explain(
            'latency потока = Σ вкладов хопов на выбранном квантиле',
            {
                percentile,
                hops: waterfall.hops.length,
                covered,
                residual: value - covered,
                parallelHops,
                splitHops,
                fanoutHops,
                topHops: Math.round(numeric(spec.params, 'topHops', 12)),
            },
            value,
            'ms',
        ),
        flow.id,
    );
};

const CALCULATORS: Record<string, ProbeCalculator> = {
    'probe-rps': rpsProbe,
    'probe-latency': latencyProbe,
    'probe-utilization': utilizationProbe,
    'probe-queue': queueProbe,
    'probe-storage': storageProbe,
    'probe-cost': costProbe,
    'probe-slo': sloProbe,
    'probe-availability': availabilityProbe,
    'probe-traffic-inspector': trafficInspectorProbe,
    'probe-heatmap': heatmapProbe,
    'probe-waterfall': waterfallProbe,
};

const TRAFFIC_REQUIRED = new Set([
    'probe-rps',
    'probe-latency',
    'probe-utilization',
    'probe-queue',
    'probe-traffic-inspector',
    'probe-waterfall',
]);

export function readProbes(specs: ProbeSpec[], context: ProbeContext): Record<string, ProbeReading> {
    const readings: Record<string, ProbeReading> = {};

    for (const spec of specs) {
        const calculate = CALCULATORS[spec.type];

        if (!spec.targetNodeId) {
            readings[spec.id] = noData(spec, 'unattached');
            continue;
        }

        const node = context.topology.nodeById.get(spec.targetNodeId);
        const metrics = context.nodes[spec.targetNodeId];

        if (!calculate || !node || !metrics) {
            readings[spec.id] = noData(spec, 'unknown-target');
            continue;
        }

        if (TRAFFIC_REQUIRED.has(spec.type) && metrics.lambdaOffered <= 0) {
            readings[spec.id] = noData(spec, 'no-traffic');
            continue;
        }

        readings[spec.id] = calculate(spec, node, metrics, context);
    }

    return readings;
}
