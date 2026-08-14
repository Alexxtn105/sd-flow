import type { CapacityResult, ComponentParams, NodeContext, ResourceLimit } from '../types/component';
import type { CallOperation } from '../types/scheme';
import { cacheHitRatio } from './cacheModel';
import type { CompiledEdge, CompiledNode, CompiledTopology } from './compile';
import type { Flow } from './flows';
import { isReadOperation } from './flows';
import { retryAmplification, serviceVariabilityFromSigma, solveQueue } from './queueing';
import type { QueueResult } from './queueing';
import { UNBOUNDED } from './resources';

const DAMPING = 0.5;
const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 0.001;
const RETRY_BUDGET = 0.5;
const ABSORBING_TARGET_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'storage']);
const BALANCING_GROUPS = new Set(['edge', 'clients']);

export interface OperationFlow {
    total: number;
    read: number;
    write: number;
    byOperation: Partial<Record<CallOperation, number>>;
    bytesPerSec: number;
    requestBytes: number;
    responseBytes: number;
}

export interface NodeRuntime {
    lambdaNominal: number;
    lambdaOffered: number;
    throughput: number;
    read: number;
    write: number;
    readShare: number;
    writeShare: number;
    requestBytes: number;
    responseBytes: number;
    instances: number;
    serviceSec: number;
    capacity: number;
    boundBy: string;
    limits: ResourceLimit[];
    queue: QueueResult;
    hitRatio: number | null;
    hotKeyShare: number;
    retryAmplification: number;
}

export interface SolverOutput {
    nodes: Map<string, NodeRuntime>;
    edges: Map<string, OperationFlow>;
    iterations: number;
    converged: boolean;
}

function emptyFlow(): OperationFlow {
    return { total: 0, read: 0, write: 0, byOperation: {}, bytesPerSec: 0, requestBytes: 0, responseBytes: 0 };
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
    target.bytesPerSec += source.bytesPerSec;

    for (const [operation, value] of Object.entries(source.byOperation)) {
        const key = operation as CallOperation;
        target.byOperation[key] = (target.byOperation[key] ?? 0) + (value ?? 0);
    }
}

function idleRuntime(node: CompiledNode): NodeRuntime {
    return {
        lambdaNominal: 0,
        lambdaOffered: 0,
        throughput: 0,
        read: 0,
        write: 0,
        readShare: 1,
        writeShare: 0,
        requestBytes: 0,
        responseBytes: 0,
        instances: Number(node.params.instances ?? 1),
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
        hitRatio: null,
        hotKeyShare: 0,
        retryAmplification: 0,
    };
}

function balancingShares(node: CompiledNode, topology: CompiledTopology): Map<string, number> {
    const shares = new Map<string, number>();
    const outgoing = node.outgoing
        .map((edgeId) => topology.edgeById.get(edgeId))
        .filter((edge): edge is CompiledEdge => edge !== undefined && !edge.isReplication);

    const totalWeight = outgoing.reduce((sum, edge) => sum + Math.max(edge.weight, 0), 0);

    for (const edge of outgoing) {
        shares.set(edge.id, totalWeight > 0 ? Math.max(edge.weight, 0) / totalWeight : 1 / outgoing.length);
    }

    return shares;
}

function computeEdgeFlow(
    edge: CompiledEdge,
    source: NodeRuntime,
    splitShare: number,
    absorption: number,
): OperationFlow {
    const flow = emptyFlow();

    if (edge.isReplication || edge.kind === 'cdc') {
        const rps = edge.isReplication ? source.write * Math.max(edge.weight, 0) : source.write;
        flow.total = rps;
        flow.write = rps;
        flow.byOperation.write = rps;
        flow.requestBytes = source.requestBytes;
        flow.responseBytes = 0;
        flow.bytesPerSec = rps * source.requestBytes;
        return flow;
    }

    const base = source.throughput * splitShare * (1 - absorption);
    let requestWeighted = 0;
    let responseWeighted = 0;

    for (const call of edge.calls) {
        const rps = base * call.share * Math.max(call.fanout, 0);
        if (rps <= 0) continue;

        const { requestBytes, responseBytes } = call;

        flow.total += rps;
        flow.byOperation[call.op] = (flow.byOperation[call.op] ?? 0) + rps;
        flow.bytesPerSec += rps * (requestBytes + responseBytes);
        requestWeighted += rps * requestBytes;
        responseWeighted += rps * responseBytes;

        if (isReadOperation(call.op)) flow.read += rps;
        else flow.write += rps;
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
): { requestBytes: number; responseBytes: number } {
    if (node.definition.group === 'clients') {
        const flow = flows.find((item) => item.entryNodeId === node.id);
        return {
            requestBytes: flow?.requestBytes ?? 0,
            responseBytes: flow?.responseBytes ?? 0,
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

    return { requestBytes: requestWeighted / weight, responseBytes: responseWeighted / weight };
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

function serversOf(node: CompiledNode, instances: number): number {
    const concurrency = Number(node.params.concurrencyPerInstance ?? node.params.concurrency ?? 0);
    if (concurrency > 0) return instances * concurrency;

    const cores = Number(node.params.cpuCores ?? 0);
    if (cores > 0) return Math.max(cores, 1);

    return 1;
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
    return typeof limit === 'number' ? limit : servers;
}

export function solveFlows(
    topology: CompiledTopology,
    flows: Flow[],
    arrivalVariability: number,
    disabledNodes: Set<string>,
    cacheEnabled: boolean,
): SolverOutput {
    const trafficNodes = topology.nodes.filter((node) => node.definition.shape === 'node');
    const nodeOrder = topology.order
        .map((id) => topology.nodeById.get(id))
        .filter((node): node is CompiledNode => node !== undefined && node.definition.shape === 'node');

    let previous = new Map<string, NodeRuntime>(trafficNodes.map((node) => [node.id, idleRuntime(node)]));
    let edgeFlows = new Map<string, OperationFlow>();
    let iterations = 0;
    let converged = false;

    for (let pass = 0; pass < MAX_ITERATIONS; pass += 1) {
        iterations = pass + 1;

        const current = new Map<string, NodeRuntime>();
        const inflow = new Map<string, OperationFlow>(trafficNodes.map((node) => [node.id, emptyFlow()]));
        const nextEdgeFlows = new Map<string, OperationFlow>();

        for (const flow of flows) {
            const accumulator = inflow.get(flow.entryNodeId);
            if (!accumulator) continue;

            accumulator.total += flow.rps;
            accumulator.read += flow.rps * flow.readShare;
            accumulator.write += flow.rps * (1 - flow.readShare);
            accumulator.byOperation.read = (accumulator.byOperation.read ?? 0) + flow.rps * flow.readShare;
            accumulator.byOperation.write = (accumulator.byOperation.write ?? 0) + flow.rps * (1 - flow.readShare);
        }

        for (const node of nodeOrder) {
            const arrived = inflow.get(node.id) ?? emptyFlow();
            const priorRuntime = previous.get(node.id) ?? idleRuntime(node);

            if (disabledNodes.has(node.id)) {
                current.set(node.id, { ...idleRuntime(node), instances: 0, capacity: 0, boundBy: 'disabled' });
                continue;
            }

            const damped = pass === 0 ? arrived.total : (1 - DAMPING) * priorRuntime.lambdaNominal + DAMPING * arrived.total;
            const lambdaNominal = Math.max(damped, 0);
            const readShare = arrived.total > 0 ? arrived.read / arrived.total : 1;
            const writeShare = 1 - readShare;
            const bytes = averageBytes(node, topology, arrived, flows);

            const baseContext: NodeContext<ComponentParams> = {
                nodeId: node.id,
                params: node.params,
                instances: Number(node.params.instances ?? 1),
                lambda: lambdaNominal,
                readShare,
                writeShare,
                requestBytes: bytes.requestBytes,
                responseBytes: bytes.responseBytes,
            };

            const model = node.definition.model;
            const instances = model?.autoscale ? model.autoscale(baseContext) : baseContext.instances;
            const context: NodeContext<ComponentParams> = { ...baseContext, instances };
            const { capacity, serviceSec } = resolveCapacity(node, context);

            const cacheProfile = cacheEnabled && model?.cache ? model.cache(context) : null;
            const cacheResult = cacheProfile
                ? cacheHitRatio(cacheProfile, writeShare, lambdaNominal * readShare)
                : null;

            const incomingRetries = node.incoming
                .map((edgeId) => topology.edgeById.get(edgeId))
                .filter((edge): edge is CompiledEdge => Boolean(edge))
                .reduce((max, edge) => Math.max(max, edge.policy.retries), 0);

            const amplification = retryAmplification(
                priorRuntime.queue.failureProbability,
                incomingRetries,
                RETRY_BUDGET,
            );

            const lambdaOffered = lambdaNominal * (1 + amplification);
            const servers = serversOf(node, instances);

            const queue = solveQueue({
                lambdaOffered,
                capacity: capacity.capacity,
                servers,
                serviceSec,
                arrivalVariability: arrivalVariabilityFor(node, arrivalVariability),
                serviceVariability: serviceVariabilityFor(node),
                timeoutSec: timeoutSecFor(node),
                queueLimit: queueLimitFor(node, servers),
            });

            const runtime: NodeRuntime = {
                lambdaNominal,
                lambdaOffered,
                throughput: queue.throughput,
                read: queue.throughput * readShare,
                write: queue.throughput * writeShare,
                readShare,
                writeShare,
                requestBytes: bytes.requestBytes,
                responseBytes: bytes.responseBytes,
                instances,
                serviceSec,
                capacity: capacity.capacity,
                boundBy: capacity.boundBy,
                limits: capacity.limits,
                queue,
                hitRatio: cacheResult ? cacheResult.hitRatio : null,
                hotKeyShare: cacheResult ? cacheResult.hotKeyShare : 0,
                retryAmplification: amplification,
            };

            current.set(node.id, runtime);

            const isBalancer = BALANCING_GROUPS.has(node.definition.group);
            const shares = isBalancer ? balancingShares(node, topology) : null;
            const siblingAbsorption = cacheAbsorptionFor(node, topology, previous);
            const ownAbsorption = cacheEnabled ? selfAbsorption(node) : 0;

            for (const edgeId of node.outgoing) {
                const edge = topology.edgeById.get(edgeId);
                if (!edge) continue;

                const target = topology.nodeById.get(edge.target);
                if (!target) continue;

                const splitShare = shares ? (shares.get(edge.id) ?? 0) : 1;
                const applied =
                    ownAbsorption > 0
                        ? ownAbsorption
                        : ABSORBING_TARGET_GROUPS.has(target.definition.group)
                          ? siblingAbsorption
                          : 0;
                const flow = computeEdgeFlow(edge, runtime, splitShare, applied);

                nextEdgeFlows.set(edge.id, flow);

                const accumulator = inflow.get(edge.target);
                if (accumulator) addFlow(accumulator, flow);
            }
        }

        const delta = maxRelativeChange(previous, current);
        previous = current;
        edgeFlows = nextEdgeFlows;

        if (delta < CONVERGENCE_THRESHOLD) {
            converged = true;
            break;
        }
    }

    return { nodes: previous, edges: edgeFlows, iterations, converged };
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
    let peak = 0;
    let largest = 0;

    for (const runtime of current.values()) largest = Math.max(largest, runtime.lambdaNominal);
    if (largest <= 0) return 0;

    for (const [nodeId, runtime] of current) {
        const before = previous.get(nodeId)?.lambdaNominal ?? 0;
        peak = Math.max(peak, Math.abs(runtime.lambdaNominal - before));
    }

    return peak / largest;
}
