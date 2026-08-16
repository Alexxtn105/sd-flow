import type { CapacityResult, ComponentParams, NodeContext, ResourceLimit } from '../types/component';
import type { CallOperation, CallProfile } from '../types/scheme';
import { cacheHitRatio, resolveHitRatio } from './cacheModel';
import type { CompiledEdge, CompiledNode, CompiledTopology } from './compile';
import { contentionRetryShare, keySerializationLimit } from './contention';
import type { Flow } from './flows';
import { isReadOperation } from './flows';
import { retryAmplification, serviceVariabilityFromSigma, solveQueue } from './queueing';
import type { QueueResult } from './queueing';
import { routingShares } from './routing';
import type { RouteShare } from './routing';
import { occupancyBound, UNBOUNDED } from './resources';

const DAMPING = 0.5;
const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 0.0001;
export const RETRY_BUDGET = 0.5;
const ABSORBING_TARGET_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'storage']);
const FULL_SHARE: RouteShare = { read: 1, write: 1 };
const EMPTY_SHARE: RouteShare = { read: 0, write: 0 };
const BALANCING_GROUPS = new Set(['edge', 'clients']);
const QUEUE_PER_SERVER = 64;
const MIX_READ_OPERATIONS = new Set<CallOperation>(['read', 'scan']);
const MIX_WRITE_OPERATIONS = new Set<CallOperation>(['write', 'delete']);

export interface OperationFlow {
    total: number;
    read: number;
    write: number;
    accessTotal: number;
    accessRead: number;
    byOperation: Partial<Record<CallOperation, number>>;
    bytesPerSec: number;
    requestBytes: number;
    responseBytes: number;
}

export interface NodeRuntime {
    down: boolean;
    blockingSec: number;
    lambdaNominal: number;
    lambdaOffered: number;
    throughput: number;
    read: number;
    write: number;
    originWrite: number;
    readShare: number;
    writeShare: number;
    mixReadShare: number;
    mixKnown: boolean;
    requestBytes: number;
    responseBytes: number;
    instances: number;
    desiredInstances: number;
    serviceSec: number;
    capacity: number;
    boundBy: string;
    limits: ResourceLimit[];
    queue: QueueResult;
    queueLimit: number;
    timeoutSec: number;
    hitRatio: number | null;
    residentKeys: number;
    hotKeyShare: number;
    retryAmplification: number;
    contentionRetryShare: number;
}

export interface SolveOptions {
    arrivalVariability: number;
    disabledNodes: ReadonlySet<string>;
    cacheEnabled: boolean;
    retryBudget?: number;
    payloadScale?: number;
    instanceOverride?: ReadonlyMap<string, number>;
    capacityScale?: ReadonlyMap<string, number>;
    serviceScale?: ReadonlyMap<string, number>;
    hitRatioScale?: ReadonlyMap<string, number>;
    warmStart?: ReadonlyMap<string, NodeRuntime>;
}

export interface SolverOutput {
    nodes: Map<string, NodeRuntime>;
    edges: Map<string, OperationFlow>;
    iterations: number;
    converged: boolean;
}

function emptyFlow(): OperationFlow {
    return {
        total: 0,
        read: 0,
        write: 0,
        accessTotal: 0,
        accessRead: 0,
        byOperation: {},
        bytesPerSec: 0,
        requestBytes: 0,
        responseBytes: 0,
    };
}

function addFlow(target: OperationFlow, source: OperationFlow): void {
    const combined = target.total + source.total;

    if (combined > 0) {
        target.requestBytes = (target.requestBytes * target.total + source.requestBytes * source.total) / combined;
        target.responseBytes = (target.responseBytes * target.total + source.responseBytes * source.total) / combined;
    }

    target.total = combined;
    target.read += source.read;
    target.write += source.write;
    target.accessTotal += source.accessTotal;
    target.accessRead += source.accessRead;
    target.bytesPerSec += source.bytesPerSec;

    for (const [operation, value] of Object.entries(source.byOperation)) {
        const key = operation as CallOperation;
        target.byOperation[key] = (target.byOperation[key] ?? 0) + (value ?? 0);
    }
}

function idleRuntime(node: CompiledNode): NodeRuntime {
    return {
        down: false,
        blockingSec: 0,
        lambdaNominal: 0,
        lambdaOffered: 0,
        throughput: 0,
        read: 0,
        write: 0,
        originWrite: 0,
        readShare: 1,
        writeShare: 0,
        mixReadShare: 1,
        mixKnown: false,
        requestBytes: 0,
        responseBytes: 0,
        instances: Number(node.params.instances ?? 1),
        desiredInstances: Number(node.params.instances ?? 1),
        serviceSec: 0,
        capacity: UNBOUNDED,
        boundBy: 'unbounded',
        limits: [],
        queue: {
            utilization: 0,
            waitSec: 0,
            queueDepth: 0,
            throughput: 0,
            overflowProbability: 0,
            timeoutProbability: 0,
            failureProbability: 0,
        },
        queueLimit: 0,
        timeoutSec: 0,
        hitRatio: null,
        residentKeys: 0,
        hotKeyShare: 0,
        retryAmplification: 0,
        contentionRetryShare: 0,
    };
}

function balancingShares(
    node: CompiledNode,
    topology: CompiledTopology,
    disabledNodes: ReadonlySet<string>,
    routes: ReadonlyMap<string, RouteShare>,
): Map<string, RouteShare> {
    const shares = new Map<string, RouteShare>();
    const outgoing = node.outgoing
        .map((edgeId) => topology.edgeById.get(edgeId))
        .filter((edge): edge is CompiledEdge => edge !== undefined && !edge.isReplication);

    const balanced = outgoing.filter((edge) => !edge.isAsync);
    const reachable = balanced.filter((edge) => !disabledNodes.has(edge.target));
    const routed = reachable.length > 0 ? reachable : balanced;
    const totalWeight = routed.reduce((sum, edge) => sum + Math.max(edge.weight, 0), 0);

    for (const edge of outgoing) shares.set(edge.id, edge.isAsync ? FULL_SHARE : { read: 0, write: 0 });

    for (const edge of routed) {
        const share = totalWeight > 0 ? Math.max(edge.weight, 0) / totalWeight : 1 / routed.length;
        shares.set(edge.id, { read: share, write: share });
    }

    for (const edge of outgoing) {
        const routed = routes.get(edge.id);
        if (routed) shares.set(edge.id, routed);
    }

    return shares;
}

interface MixWeights {
    read: number;
    write: number;
    access: number;
}

function mixWeightsOf(edge: CompiledEdge): MixWeights {
    let read = 0;
    let write = 0;

    for (const call of edge.calls) {
        if (MIX_READ_OPERATIONS.has(call.op)) read += Math.max(call.share, 0);
        else if (MIX_WRITE_OPERATIONS.has(call.op)) write += Math.max(call.share, 0);
    }

    return { read, write, access: read + write };
}

function inheritedShare(call: CallProfile, source: NodeRuntime, weights: MixWeights): number {
    if (MIX_READ_OPERATIONS.has(call.op)) {
        return weights.read > 0 ? (source.mixReadShare * weights.access * call.share) / weights.read : 0;
    }

    if (MIX_WRITE_OPERATIONS.has(call.op)) {
        return weights.write > 0 ? ((1 - source.mixReadShare) * weights.access * call.share) / weights.write : 0;
    }

    return call.share;
}

function computeEdgeFlow(
    edge: CompiledEdge,
    source: NodeRuntime,
    splitShare: RouteShare,
    absorption: number,
    payloadScale: number,
): OperationFlow {
    const flow = emptyFlow();

    if (edge.isReplication || edge.kind === 'cdc') {
        const rps = edge.isReplication ? source.originWrite * Math.max(edge.weight, 0) : source.write;
        flow.total = rps;
        flow.write = rps;
        flow.accessTotal = rps;
        flow.byOperation.write = rps;
        flow.requestBytes = source.requestBytes;
        flow.responseBytes = 0;
        flow.bytesPerSec = rps * source.requestBytes;
        return flow;
    }

    let requestWeighted = 0;
    let responseWeighted = 0;
    const weights = mixWeightsOf(edge);

    for (const call of edge.calls) {
        const reading = isReadOperation(call.op);
        const served = reading ? 1 - absorption : 1;
        const base = source.throughput * (reading ? splitShare.read : splitShare.write);
        const share =
            edge.inheritsMix && source.mixKnown ? inheritedShare(call, source, weights) : call.share;
        const rps = base * served * share * Math.max(call.fanout, 0);
        if (rps <= 0) continue;

        const requestBytes = call.requestBytes * payloadScale;
        const responseBytes = call.responseBytes * payloadScale;

        flow.total += rps;
        flow.byOperation[call.op] = (flow.byOperation[call.op] ?? 0) + rps;
        flow.bytesPerSec += rps * (requestBytes + responseBytes);
        requestWeighted += rps * requestBytes;
        responseWeighted += rps * responseBytes;

        if (isReadOperation(call.op)) flow.read += rps;
        else flow.write += rps;

        if (MIX_READ_OPERATIONS.has(call.op)) {
            flow.accessTotal += rps;
            flow.accessRead += rps;
        } else if (MIX_WRITE_OPERATIONS.has(call.op)) {
            flow.accessTotal += rps;
        }
    }

    if (flow.total > 0) {
        flow.requestBytes = requestWeighted / flow.total;
        flow.responseBytes = responseWeighted / flow.total;
    }

    return flow;
}

function averageBytes(
    node: CompiledNode,
    topology: CompiledTopology,
    inflow: OperationFlow,
    flows: Flow[],
    payloadScale: number,
): { requestBytes: number; responseBytes: number } {
    if (node.definition.group === 'clients') {
        const flow = flows.find((item) => item.entryNodeId === node.id);
        return {
            requestBytes: (flow?.requestBytes ?? 0) * payloadScale,
            responseBytes: (flow?.responseBytes ?? 0) * payloadScale,
        };
    }

    if (inflow.total > 0) {
        return { requestBytes: inflow.requestBytes, responseBytes: inflow.responseBytes };
    }

    let requestWeighted = 0;
    let responseWeighted = 0;
    let weight = 0;

    for (const edgeId of node.incoming) {
        const edge = topology.edgeById.get(edgeId);
        if (!edge) continue;

        for (const call of edge.calls) {
            const share = call.share * Math.max(call.fanout, 0);
            requestWeighted += call.requestBytes * share;
            responseWeighted += call.responseBytes * share;
            weight += share;
        }
    }

    if (weight <= 0) return { requestBytes: 0, responseBytes: 0 };

    return {
        requestBytes: (requestWeighted / weight) * payloadScale,
        responseBytes: (responseWeighted / weight) * payloadScale,
    };
}

function resolveCapacity(
    node: CompiledNode,
    context: NodeContext<ComponentParams>,
): { capacity: CapacityResult; serviceSec: number } {
    const model = node.definition.model;

    if (!model) {
        const boundBy = node.definition.group === 'clients' ? 'source' : 'unmodelled';
        return {
            capacity: { limits: [], capacity: UNBOUNDED, boundBy },
            serviceSec: 0,
        };
    }

    return { capacity: model.capacity(context), serviceSec: model.serviceSec(context) };
}

export const BLOCKING_RESOURCE = 'blocking';

function withLimit(capacity: CapacityResult, limit: ResourceLimit | null): CapacityResult {
    if (!limit || !Number.isFinite(limit.value)) return capacity;

    const limits = [...capacity.limits, limit];

    return limit.value < capacity.capacity
        ? { limits, capacity: limit.value, boundBy: limit.resource }
        : { limits, capacity: capacity.capacity, boundBy: capacity.boundBy };
}

function blockingLimitOf(pool: number, serviceSec: number, blockingSec: number): ResourceLimit | null {
    if (pool <= 0 || blockingSec <= 0) return null;

    return occupancyBound(BLOCKING_RESOURCE, pool, serviceSec, blockingSec);
}

function serversOf(node: CompiledNode, instances: number): number {
    const pool = declaredPool(node, instances);
    if (pool > 0) return pool;

    const cores = Number(node.params.cpuCores ?? 0);
    if (cores > 0) return Math.max(cores, 1);

    return 1;
}

function declaredPool(node: CompiledNode, instances: number): number {
    const concurrency = Number(node.params.concurrencyPerInstance ?? node.params.concurrency ?? 0);
    return concurrency > 0 ? instances * concurrency : 0;
}

function callsPerRequestOn(
    edge: CompiledEdge,
    source: NodeRuntime,
    edgeFlows: ReadonlyMap<string, OperationFlow>,
): number {
    const flow = edgeFlows.get(edge.id);
    if (flow && source.throughput > 0) return flow.total / source.throughput;

    return edge.calls.reduce((sum, call) => sum + call.share * Math.max(call.fanout, 0), 0);
}

function legSec(edge: CompiledEdge, target: NodeRuntime | undefined): number {
    if (!target) return 0;

    const responseSec = target.serviceSec + target.queue.waitSec + target.blockingSec;
    const leg = edge.networkMs / 1000 + responseSec;
    const timeoutSec = edge.policy.timeoutMs / 1000;

    return timeoutSec > 0 ? Math.min(leg, timeoutSec) : leg;
}

function blockingSecFor(
    node: CompiledNode,
    topology: CompiledTopology,
    runtimes: ReadonlyMap<string, NodeRuntime>,
    edgeFlows: ReadonlyMap<string, OperationFlow>,
    source: NodeRuntime,
): number {
    const parallel = node.params.callMode === 'parallel';
    let sequential = 0;
    let slowest = 0;

    for (const edgeId of node.outgoing) {
        const edge = topology.edgeById.get(edgeId);
        if (!edge || edge.isAsync || edge.isReplication) continue;

        const calls = callsPerRequestOn(edge, source, edgeFlows);
        if (calls <= 0) continue;

        const leg = legSec(edge, runtimes.get(edge.target));
        if (leg <= 0) continue;

        sequential += calls * leg;
        slowest = Math.max(slowest, leg);
    }

    return parallel ? slowest : sequential;
}

function arrivalVariabilityFor(node: CompiledNode, base: number): number {
    return node.definition.group === 'clients' ? base : base;
}

function serviceVariabilityFor(node: CompiledNode): number {
    const sigma = Number(node.params.serviceTimeSigma ?? 0.5);
    return serviceVariabilityFromSigma(sigma);
}

function timeoutSecFor(node: CompiledNode): number {
    const timeout = Number(node.params.timeoutMs ?? 0);
    return timeout > 0 ? timeout / 1000 : 0;
}

function queueLimitFor(node: CompiledNode, servers: number): number {
    const limit = node.params.queueLimit;

    return typeof limit === 'number' ? limit : servers * QUEUE_PER_SERVER;
}

function entryFlowsOf(flows: Flow[]): Map<string, OperationFlow> {
    const entry = new Map<string, OperationFlow>();

    for (const flow of flows) {
        const accumulator = entry.get(flow.entryNodeId) ?? emptyFlow();

        accumulator.total += flow.rps;
        accumulator.read += flow.rps * flow.readShare;
        accumulator.write += flow.rps * (1 - flow.readShare);
        accumulator.accessTotal += flow.rps;
        accumulator.accessRead += flow.rps * flow.readShare;
        accumulator.byOperation.read = (accumulator.byOperation.read ?? 0) + flow.rps * flow.readShare;
        accumulator.byOperation.write = (accumulator.byOperation.write ?? 0) + flow.rps * (1 - flow.readShare);

        entry.set(flow.entryNodeId, accumulator);
    }

    return entry;
}

interface ArrivedFlow {
    flow: OperationFlow;
    replicated: number;
}

function arrivedFlow(
    node: CompiledNode,
    topology: CompiledTopology,
    entryFlows: ReadonlyMap<string, OperationFlow>,
    edgeFlows: ReadonlyMap<string, OperationFlow>,
): ArrivedFlow {
    const flow = emptyFlow();
    let replicated = 0;
    const entry = entryFlows.get(node.id);
    if (entry) addFlow(flow, entry);

    for (const edgeId of node.incoming) {
        const arrived = edgeFlows.get(edgeId);
        if (!arrived) continue;

        addFlow(flow, arrived);
        if (topology.edgeById.get(edgeId)?.isReplication) replicated += arrived.write;
    }

    return { flow, replicated };
}

export function solveFlows(topology: CompiledTopology, flows: Flow[], options: SolveOptions): SolverOutput {
    const { arrivalVariability, disabledNodes, cacheEnabled } = options;
    const retryBudget = options.retryBudget ?? RETRY_BUDGET;
    const payloadScale = options.payloadScale ?? 1;

    const routes = routingShares(topology, flows, disabledNodes);
    const trafficNodes = topology.nodes.filter((node) => node.definition.shape === 'node');
    const nodeOrder = topology.order
        .map((id) => topology.nodeById.get(id))
        .filter((node): node is CompiledNode => node !== undefined && node.definition.shape === 'node');

    let previous = new Map<string, NodeRuntime>(
        trafficNodes.map((node) => [node.id, options.warmStart?.get(node.id) ?? idleRuntime(node)]),
    );
    const entryFlows = entryFlowsOf(flows);
    const edgeFlows = new Map<string, OperationFlow>();
    let iterations = 0;
    let converged = false;

    for (let pass = 0; pass < MAX_ITERATIONS; pass += 1) {
        iterations = pass + 1;

        const current = new Map<string, NodeRuntime>();

        for (const node of nodeOrder) {
            const { flow: arrived, replicated } = arrivedFlow(node, topology, entryFlows, edgeFlows);
            const priorRuntime = previous.get(node.id) ?? idleRuntime(node);

            if (disabledNodes.has(node.id)) {
                const lostReadShare = arrived.total > 0 ? arrived.read / arrived.total : 1;

                current.set(node.id, {
                    ...idleRuntime(node),
                    down: true,
                    lambdaNominal: arrived.total,
                    lambdaOffered: arrived.total,
                    readShare: lostReadShare,
                    writeShare: 1 - lostReadShare,
                    capacity: 0,
                    boundBy: 'disabled',
                    queue: {
                        utilization: 0,
                        waitSec: 0,
                        queueDepth: 0,
                        throughput: 0,
                        overflowProbability: arrived.total > 0 ? 1 : 0,
                        timeoutProbability: 0,
                        failureProbability: arrived.total > 0 ? 1 : 0,
                    },
                });

                for (const edgeId of node.outgoing) edgeFlows.set(edgeId, emptyFlow());
                continue;
            }

            const damped = pass === 0 ? arrived.total : (1 - DAMPING) * priorRuntime.lambdaNominal + DAMPING * arrived.total;
            const lambdaNominal = Math.max(damped, 0);
            const readShare = arrived.total > 0 ? arrived.read / arrived.total : 1;
            const writeShare = 1 - readShare;
            const originWriteShare =
                arrived.total > 0 ? Math.max(arrived.write - replicated, 0) / arrived.total : 0;
            const mixKnown = arrived.accessTotal > 0;
            const mixReadShare = mixKnown ? arrived.accessRead / arrived.accessTotal : readShare;
            const bytes = averageBytes(node, topology, arrived, flows, payloadScale);

            const blockingSec = blockingSecFor(node, topology, previous, edgeFlows, priorRuntime);

            const baseContext: NodeContext<ComponentParams> = {
                nodeId: node.id,
                params: node.params,
                instances: Number(node.params.instances ?? 1),
                lambda: lambdaNominal,
                readShare,
                writeShare,
                requestBytes: bytes.requestBytes,
                responseBytes: bytes.responseBytes,
                blockingSec,
            };

            const model = node.definition.model;
            const desiredInstances = model?.autoscale ? model.autoscale(baseContext) : baseContext.instances;
            const override = options.instanceOverride?.get(node.id);
            const instances = override === undefined ? desiredInstances : Math.max(1, Math.round(override));
            const context: NodeContext<ComponentParams> = { ...baseContext, instances };
            const { capacity, serviceSec: nominalServiceSec } = resolveCapacity(node, context);

            const serviceScale = options.serviceScale?.get(node.id) ?? 1;
            const serviceSec = nominalServiceSec * serviceScale;
            const blocked = withLimit(
                capacity,
                blockingLimitOf(declaredPool(node, instances), serviceSec, blockingSec),
            );
            const bounded = withLimit(blocked, keySerializationLimit(node.params, writeShare, serviceSec));
            const effectiveCapacity =
                (bounded.capacity * (options.capacityScale?.get(node.id) ?? 1)) / serviceScale;

            const cacheProfile = cacheEnabled && model?.cache ? model.cache(context) : null;
            const cacheResult = cacheProfile
                ? cacheHitRatio(cacheProfile, writeShare, lambdaNominal * readShare)
                : null;
            const warmth = options.hitRatioScale?.get(node.id) ?? 1;
            const hitRatio = cacheProfile
                ? resolveHitRatio(node.params, cacheResult?.hitRatio ?? null, warmth)
                : null;

            const incomingRetries = node.incoming
                .map((edgeId) => topology.edgeById.get(edgeId))
                .filter((edge): edge is CompiledEdge => Boolean(edge))
                .reduce((max, edge) => Math.max(max, edge.policy.retries), 0);

            const amplification = retryAmplification(
                priorRuntime.queue.failureProbability,
                incomingRetries,
                retryBudget,
            );

            const retryShare = contentionRetryShare(node.params, lambdaNominal * writeShare, serviceSec);
            const lambdaOffered =
                lambdaNominal * (1 + amplification) + lambdaNominal * writeShare * retryShare;
            const servers = serversOf(node, instances);
            const timeoutSec = timeoutSecFor(node);
            const queueLimit = queueLimitFor(node, servers);

            const queue = solveQueue({
                lambdaOffered,
                capacity: effectiveCapacity,
                servers,
                serviceSec,
                arrivalVariability: arrivalVariabilityFor(node, arrivalVariability),
                serviceVariability: serviceVariabilityFor(node),
                timeoutSec,
                queueLimit,
            });

            const runtime: NodeRuntime = {
                down: false,
                blockingSec,
                lambdaNominal,
                lambdaOffered,
                throughput: queue.throughput,
                read: queue.throughput * readShare,
                write: queue.throughput * writeShare,
                originWrite: queue.throughput * originWriteShare,
                readShare,
                writeShare,
                mixReadShare,
                mixKnown,
                requestBytes: bytes.requestBytes,
                responseBytes: bytes.responseBytes,
                instances,
                desiredInstances,
                serviceSec,
                capacity: effectiveCapacity,
                boundBy: bounded.boundBy,
                limits: bounded.limits,
                queue,
                queueLimit,
                timeoutSec,
                hitRatio,
                residentKeys: cacheResult ? cacheResult.residentKeys : 0,
                hotKeyShare: cacheResult ? cacheResult.hotKeyShare : 0,
                retryAmplification: amplification,
                contentionRetryShare: retryShare,
            };

            current.set(node.id, runtime);

            const isBalancer = BALANCING_GROUPS.has(node.definition.group);
            const shares = isBalancer ? balancingShares(node, topology, disabledNodes, routes) : null;
            const siblingAbsorption = cacheAbsorptionFor(node, topology, previous);
            const ownAbsorption = cacheEnabled ? ownAbsorptionOf(node, hitRatio, warmth) : 0;

            for (const edgeId of node.outgoing) {
                const edge = topology.edgeById.get(edgeId);
                if (!edge) continue;

                const target = topology.nodeById.get(edge.target);
                if (!target) continue;

                const splitShare = shares ? (shares.get(edge.id) ?? EMPTY_SHARE) : FULL_SHARE;
                const applied =
                    ownAbsorption > 0
                        ? ownAbsorption
                        : ABSORBING_TARGET_GROUPS.has(target.definition.group)
                          ? siblingAbsorption
                          : 0;
                edgeFlows.set(edge.id, computeEdgeFlow(edge, runtime, splitShare, applied, payloadScale));
            }
        }

        const delta = maxRelativeChange(previous, current);
        previous = current;

        if (delta < CONVERGENCE_THRESHOLD) {
            converged = true;
            break;
        }
    }

    return { nodes: previous, edges: edgeFlows, iterations, converged };
}

function ownAbsorptionOf(node: CompiledNode, hitRatio: number | null, warmth: number): number {
    if (hitRatio !== null) return hitRatio;

    return selfAbsorption(node) * warmth;
}

export function selfAbsorption(node: CompiledNode): number {
    const declared = node.params.cacheHitRatio ?? node.params.resolverCacheHitRatio;
    return typeof declared === 'number' ? Math.min(Math.max(declared, 0), 1) : 0;
}

function cacheAbsorptionFor(
    node: CompiledNode,
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
): number {
    let absorption = 0;

    for (const edgeId of node.outgoing) {
        const edge = topology.edgeById.get(edgeId);
        if (!edge) continue;

        const target = topology.nodeById.get(edge.target);
        if (!target || target.definition.group !== 'cache') continue;

        const runtime = runtimes.get(target.id);
        if (runtime?.hitRatio) absorption = Math.max(absorption, runtime.hitRatio);
    }

    return absorption;
}

function maxRelativeChange(
    previous: Map<string, NodeRuntime>,
    current: Map<string, NodeRuntime>,
): number {
    return Math.max(
        relativeChange(previous, current, (runtime) => runtime.lambdaNominal),
        relativeChange(previous, current, (runtime) => runtime.blockingSec),
    );
}

function relativeChange(
    previous: Map<string, NodeRuntime>,
    current: Map<string, NodeRuntime>,
    pick: (runtime: NodeRuntime) => number,
): number {
    let peak = 0;
    let largest = 0;

    for (const runtime of current.values()) largest = Math.max(largest, pick(runtime));
    if (largest <= 0) return 0;

    for (const [nodeId, runtime] of current) {
        const before = previous.get(nodeId);
        peak = Math.max(peak, Math.abs(pick(runtime) - (before ? pick(before) : 0)));
    }

    return peak / largest;
}
