import { planClusterPods } from './clusters';
import type { CompiledNode, CompiledTopology } from './compile';
import type { Flow } from './flows';
import { createRng } from './rng';
import type { ScenarioSetup } from './scenarios';
import { shardCountOf, skewCapacityScale } from './scenarios';
import { selfAbsorption, solveFlows } from './solver';
import type { NodeRuntime } from './solver';
import type { Timeline, TimelineNodeSample, TimelineSample } from './types';

export const SCALE_UP_LAG_SEC = 90;
export const SCALE_DOWN_LAG_SEC = 300;
export const CACHE_WARMUP_SEC = 60;
export const CACHE_WARMUP_MIN_SEC = 20;
export const CACHE_WARMUP_MAX_SEC = 900;
export const BUFFERED_BACKLOG_SEC = 3600;
export const POISON_REDELIVERY_SEC = 30;
export const POISON_MAX_ATTEMPTS = 5;
export const POISON_MIN_CAPACITY_SCALE = 0.05;
export const TIMELINE_ERROR_BUDGET = 0.01;
export const MAX_TIMELINE_SAMPLES = 121;

const P99_Z_SCORE = 2.3263;
const WAIT_TAIL_FACTOR = 4.6052;
const JITTER_PER_VARIABILITY = 0.02;
const MAX_JITTER_SIGMA = 0.12;
const BACKLOG_SETTLED_SHARE = 0.02;

export interface TransientWindow {
    fromSec: number;
    toSec: number;
}

export type TransientLoadKind = 'flat' | 'step' | 'ramp' | 'plateau' | 'burst';

export interface TransientLoad {
    kind: TransientLoadKind;
    peakMultiplier: number;
    window: TransientWindow;
    rampSec: number;
}

export interface TransientPayload {
    scale: number;
    window: TransientWindow;
}

export interface TransientOutage {
    nodeIds: string[];
    window: TransientWindow;
}

export interface TransientSlowdown {
    nodeIds: string[];
    factor: number;
    window: TransientWindow;
}

export interface TransientSkew {
    nodeIds: string[];
    hotKeyShare: number;
    window: TransientWindow;
}

export interface TransientPoison {
    nodeIds: string[];
    share: number;
    window: TransientWindow;
}

export interface TransientProfile {
    stepSec: number;
    horizonSec: number;
    load: TransientLoad;
    payload: TransientPayload;
    outage: TransientOutage | null;
    slowdown: TransientSlowdown | null;
    skew: TransientSkew | null;
    cacheFlushAtSec: number | null;
    poison: TransientPoison | null;
    retryBudget: number;
}

export interface TransientEffects {
    trafficMultiplier: number;
    payloadScale: number;
    disabled: string[];
    capacityScale: Map<string, number>;
    serviceScale: Map<string, number>;
}

export interface TransientInput {
    topology: CompiledTopology;
    flows: Flow[];
    setup: ScenarioSetup;
    seed: number;
}

function inWindow(window: TransientWindow, timeSec: number): boolean {
    return timeSec >= window.fromSec && timeSec < window.toSec;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), high);
}

export function loadMultiplierAt(load: TransientLoad, timeSec: number): number {
    const { kind, peakMultiplier, window: span, rampSec } = load;
    const amplitude = peakMultiplier - 1;

    if (kind === 'flat' || amplitude === 0) return 1;

    if (kind === 'ramp') {
        const duration = rampSec > 0 ? rampSec : span.toSec;
        return 1 + amplitude * clamp(timeSec / Math.max(duration, 1e-9), 0, 1);
    }

    if (kind === 'burst') {
        if (timeSec < span.fromSec) return 1;
        if (inWindow(span, timeSec)) return peakMultiplier;

        const decaySec = Math.max(span.toSec - span.fromSec, 1e-9);
        return 1 + amplitude * Math.exp(-(timeSec - span.toSec) / decaySec);
    }

    if (!inWindow(span, timeSec)) return 1;

    if (kind === 'plateau' && rampSec > 0) {
        const risen = clamp((timeSec - span.fromSec) / rampSec, 0, 1);
        const falling = clamp((span.toSec - timeSec) / rampSec, 0, 1);
        return 1 + amplitude * Math.min(risen, falling);
    }

    return peakMultiplier;
}

export function effectsAt(
    profile: TransientProfile,
    timeSec: number,
    topology: CompiledTopology,
): TransientEffects {
    const effects: TransientEffects = {
        trafficMultiplier: loadMultiplierAt(profile.load, timeSec),
        payloadScale: inWindow(profile.payload.window, timeSec) ? profile.payload.scale : 1,
        disabled: [],
        capacityScale: new Map<string, number>(),
        serviceScale: new Map<string, number>(),
    };

    if (profile.outage && inWindow(profile.outage.window, timeSec)) {
        effects.disabled = [...profile.outage.nodeIds];
    }

    if (profile.slowdown && inWindow(profile.slowdown.window, timeSec)) {
        for (const nodeId of profile.slowdown.nodeIds) {
            effects.serviceScale.set(nodeId, profile.slowdown.factor);
        }
    }

    if (profile.skew && inWindow(profile.skew.window, timeSec)) {
        for (const nodeId of profile.skew.nodeIds) {
            const node = topology.nodeById.get(nodeId);
            if (!node) continue;
            effects.capacityScale.set(nodeId, skewCapacityScale(shardCountOf(node), profile.skew.hotKeyShare));
        }
    }

    return effects;
}

function scaleLagSec(node: CompiledNode, topology: CompiledTopology, growing: boolean): number {
    const declared = growing ? node.params.scaleUpLagSec : node.params.scaleDownLagSec;
    const base = typeof declared === 'number' ? declared : growing ? SCALE_UP_LAG_SEC : SCALE_DOWN_LAG_SEC;
    const cluster = node.clusterId ? topology.nodeById.get(node.clusterId) : undefined;
    const scheduling = Number(cluster?.params.schedulingLagSec ?? 0);

    return Math.max(0, base + (Number.isFinite(scheduling) ? scheduling : 0));
}

function approach(current: number, target: number, lagSec: number, stepSec: number): number {
    const rate = lagSec <= 0 ? 1 : Math.min(1, stepSec / lagSec);
    return current + (target - current) * rate;
}

function isBuffered(node: CompiledNode, topology: CompiledTopology): boolean {
    if (node.definition.group === 'messaging') return true;

    return node.incoming.some((edgeId) => topology.edgeById.get(edgeId)?.isAsync === true);
}

function hasDeadLetter(node: CompiledNode, topology: CompiledTopology): boolean {
    for (const edgeId of node.incoming) {
        const edge = topology.edgeById.get(edgeId);
        if (!edge?.isAsync) continue;

        const source = topology.nodeById.get(edge.source);
        if (!source) continue;

        for (const outgoingId of source.outgoing) {
            const outgoing = topology.edgeById.get(outgoingId);
            if (outgoing && topology.nodeById.get(outgoing.target)?.type === 'dlq') return true;
        }
    }

    return false;
}

function frontDoorNodes(topology: CompiledTopology): Set<string> {
    const front = new Set<string>();

    for (const edge of topology.edges) {
        const source = topology.nodeById.get(edge.source);
        if (source?.definition.group === 'clients') front.add(edge.target);
    }

    return front;
}

function cacheWarmupSec(runtime: NodeRuntime): number {
    if (runtime.residentKeys <= 0) return CACHE_WARMUP_SEC;

    const readRps = Math.max(runtime.lambdaNominal * runtime.readShare, 1);
    return clamp(runtime.residentKeys / readRps, CACHE_WARMUP_MIN_SEC, CACHE_WARMUP_MAX_SEC);
}

function isCaching(node: CompiledNode, runtime: NodeRuntime): boolean {
    return runtime.hitRatio !== null || selfAbsorption(node) > 0;
}

function serviceSigmaOf(node: CompiledNode): number {
    const sigma = Number(node.params.serviceTimeSigma ?? 0.5);
    return Number.isFinite(sigma) && sigma > 0 ? sigma : 0.5;
}

function backlogLimitOf(node: CompiledNode, topology: CompiledTopology, capacity: number): number {
    if (!Number.isFinite(capacity) || capacity <= 0) return 0;
    if (isBuffered(node, topology)) return capacity * BUFFERED_BACKLOG_SEC;

    const declared = node.params.queueLimit;
    return typeof declared === 'number' && declared > 0 ? declared : 0;
}

interface StepOutcome {
    sample: TimelineSample;
    runtimes: Map<string, NodeRuntime>;
}

interface TransientState {
    instances: Map<string, number>;
    backlog: Map<string, number>;
    warmth: Map<string, number>;
    stuck: Map<string, number>;
}

function flushesAt(flushAtSec: number | null, timeSec: number, stepSec: number): boolean {
    if (flushAtSec === null) return false;
    return flushAtSec >= timeSec - stepSec / 2 && flushAtSec < timeSec + stepSec / 2;
}

function persistentDisabled(setup: ScenarioSetup, profile: TransientProfile): Set<string> {
    const disabled = new Set(setup.disabledNodes);
    if (profile.outage) for (const nodeId of profile.outage.nodeIds) disabled.delete(nodeId);

    return disabled;
}

function nodeSample(
    node: CompiledNode,
    runtime: NodeRuntime,
    backlog: number,
    backlogLimit: number,
    stepSec: number,
): TimelineNodeSample {
    const capacity = runtime.capacity;
    const finiteCapacity = Number.isFinite(capacity) && capacity > 0;
    const arrivals = runtime.lambdaOffered * stepSec;
    const available = Number.isFinite(capacity) ? capacity * stepSec : Number.POSITIVE_INFINITY;
    const pending = backlog + arrivals;
    const served = Math.min(pending, available);
    const waiting = Math.min(pending - served, backlogLimit);
    const dropped = pending - served - waiting;

    const backlogWaitSec = finiteCapacity ? waiting / capacity : 0;
    const responseSec = runtime.serviceSec + runtime.queue.waitSec + backlogWaitSec;
    const overflow = arrivals > 0 ? clamp(dropped / arrivals, 0, 1) : 0;
    const timeout =
        runtime.timeoutSec > 0 && responseSec > 0
            ? (1 - overflow) * Math.exp(-runtime.timeoutSec / responseSec)
            : 0;

    const serviceP99 = runtime.serviceSec * Math.exp(serviceSigmaOf(node) * P99_Z_SCORE);
    const drainSec = finiteCapacity && runtime.queueLimit > 0 ? runtime.queueLimit / capacity : Infinity;
    const waitP99 = Math.min(runtime.queue.waitSec * WAIT_TAIL_FACTOR, drainSec);
    const p99Sec = serviceP99 + waitP99 + backlogWaitSec;

    return {
        nodeId: node.id,
        lambda: runtime.lambdaOffered,
        throughput: served / stepSec,
        capacity,
        utilization: finiteCapacity ? runtime.lambdaOffered / capacity : 0,
        instances: runtime.instances,
        desiredInstances: runtime.desiredInstances,
        queueDepth: runtime.queue.queueDepth,
        backlog: waiting,
        errorRate: 1 - (1 - overflow) * (1 - timeout),
        p99Ms: p99Sec * 1000,
        hitRatio: runtime.hitRatio,
    };
}

export function runTransient(input: TransientInput): Timeline | null {
    const { topology, flows, setup } = input;
    const profile = setup.transient;
    if (!profile || flows.length === 0) return null;

    const stepSec = Math.max(profile.stepSec, profile.horizonSec / (MAX_TIMELINE_SAMPLES - 1));
    const steps = Math.max(2, Math.round(profile.horizonSec / stepSec) + 1);
    const rng = createRng(input.seed);
    const jitterSigma = Math.min(MAX_JITTER_SIGMA, JITTER_PER_VARIABILITY * setup.arrivalVariability);

    const nodes = topology.nodes.filter((node) => node.definition.shape === 'node');
    const persistent = persistentDisabled(setup, profile);
    const front = frontDoorNodes(topology);

    const state: TransientState = {
        instances: new Map<string, number>(),
        backlog: new Map<string, number>(),
        warmth: new Map<string, number>(),
        stuck: new Map<string, number>(),
    };

    const warm = solveFlows(topology, flows, {
        arrivalVariability: setup.arrivalVariability,
        disabledNodes: persistent,
        cacheEnabled: true,
        retryBudget: profile.retryBudget,
    });

    for (const node of nodes) {
        const runtime = warm.nodes.get(node.id);
        state.instances.set(node.id, runtime?.desiredInstances ?? 1);
        state.backlog.set(node.id, 0);
        state.warmth.set(node.id, 1);
        state.stuck.set(node.id, 0);
    }

    const cachingNodes = nodes.filter((node) => {
        const runtime = warm.nodes.get(node.id);
        return runtime !== undefined && isCaching(node, runtime);
    });

    let previous = warm.nodes;
    const samples: TimelineSample[] = [];

    for (let index = 0; index < steps; index += 1) {
        const timeSec = index * stepSec;

        if (flushesAt(profile.cacheFlushAtSec, timeSec, stepSec)) {
            for (const node of cachingNodes) state.warmth.set(node.id, 0);
        }

        const outcome = runStep({
            topology,
            flows,
            setup,
            profile,
            timeSec,
            stepSec,
            nodes,
            persistent,
            front,
            state,
            previous,
            jitter: jitterSigma > 0 ? Math.exp(jitterSigma * rng.normal()) : 1,
        });

        samples.push(outcome.sample);
        previous = outcome.runtimes;
    }

    return summarise(profile, stepSec, samples);
}

interface StepInput {
    topology: CompiledTopology;
    flows: Flow[];
    setup: ScenarioSetup;
    profile: TransientProfile;
    timeSec: number;
    stepSec: number;
    nodes: CompiledNode[];
    persistent: Set<string>;
    front: Set<string>;
    state: TransientState;
    previous: Map<string, NodeRuntime>;
    jitter: number;
}

function runStep(input: StepInput): StepOutcome {
    const { topology, setup, profile, timeSec, stepSec, nodes, state, previous } = input;

    const effects = effectsAt(profile, timeSec, topology);
    const multiplier = effects.trafficMultiplier * input.jitter;
    const flows = input.flows.map((flow) => ({ ...flow, rps: flow.rps * multiplier }));

    const disabled = new Set(input.persistent);
    for (const nodeId of effects.disabled) disabled.add(nodeId);

    const capacityScale = new Map(effects.capacityScale);
    for (const node of nodes) {
        const stuck = state.stuck.get(node.id) ?? 0;
        if (stuck <= 0) continue;

        const capacity = previous.get(node.id)?.capacity ?? 0;
        if (!Number.isFinite(capacity) || capacity <= 0) continue;

        const occupancy = stuck / POISON_REDELIVERY_SEC / capacity;
        const free = Math.max(POISON_MIN_CAPACITY_SCALE, 1 - occupancy);
        capacityScale.set(node.id, (capacityScale.get(node.id) ?? 1) * free);
    }

    const options = {
        arrivalVariability: setup.arrivalVariability,
        disabledNodes: disabled,
        cacheEnabled: true,
        retryBudget: profile.retryBudget,
        payloadScale: effects.payloadScale,
        capacityScale,
        serviceScale: effects.serviceScale,
        hitRatioScale: state.warmth,
        warmStart: previous,
    };

    const demand = solveFlows(topology, flows, { ...options, instanceOverride: state.instances });

    for (const node of nodes) {
        const desired = demand.nodes.get(node.id)?.desiredInstances;
        if (desired === undefined) continue;

        const current = state.instances.get(node.id) ?? desired;
        const lagSec = scaleLagSec(node, topology, desired > current);
        state.instances.set(node.id, approach(current, desired, lagSec, stepSec));
    }

    const placement = planClusterPods(topology, state.instances);
    const scheduled = placement.clamped
        ? new Map([...state.instances, ...placement.instanceOverride])
        : state.instances;

    const solved = solveFlows(topology, flows, {
        ...options,
        instanceOverride: scheduled,
        warmStart: demand.nodes,
    });

    const nodeSamples: Record<string, TimelineNodeSample> = {};
    let backlogTotal = 0;
    let instancesTotal = 0;
    let peakUtilization = 0;
    let worstP99Ms = 0;
    let throughput = 0;
    let survival = 1;

    for (const node of nodes) {
        const runtime = solved.nodes.get(node.id);
        if (!runtime) continue;

        const backlog = state.backlog.get(node.id) ?? 0;
        const limit = backlogLimitOf(node, topology, runtime.capacity);
        const sample = nodeSample(node, runtime, backlog, limit, stepSec);

        nodeSamples[node.id] = sample;
        state.backlog.set(node.id, sample.backlog);

        if (isCaching(node, runtime)) {
            const warmth = state.warmth.get(node.id) ?? 1;
            state.warmth.set(node.id, warmth + (1 - warmth) * (1 - Math.exp(-stepSec / cacheWarmupSec(runtime))));
        }

        updatePoison(node, runtime, input);

        backlogTotal += sample.backlog;
        instancesTotal += sample.instances;
        peakUtilization = Math.max(peakUtilization, sample.utilization);
        worstP99Ms = Math.max(worstP99Ms, sample.p99Ms);
        if (node.definition.group !== 'clients') survival *= 1 - sample.errorRate;
        if (input.front.has(node.id)) throughput += sample.throughput;
    }

    const lambda = flows.reduce((sum, flow) => sum + flow.rps, 0);
    const errorRate = 1 - survival;

    return {
        runtimes: solved.nodes,
        sample: {
            timeSec,
            lambda,
            throughput,
            errorRate,
            peakUtilization,
            worstP99Ms,
            backlog: backlogTotal,
            instances: instancesTotal,
            breach: errorRate > TIMELINE_ERROR_BUDGET || peakUtilization >= 1,
            nodes: nodeSamples,
        },
    };
}

function updatePoison(node: CompiledNode, runtime: NodeRuntime, input: StepInput): void {
    const poison = input.profile.poison;
    if (!poison || !poison.nodeIds.includes(node.id)) return;

    const { stepSec } = input;
    const stuck = input.state.stuck.get(node.id) ?? 0;
    const arriving = inWindow(poison.window, input.timeSec) ? poison.share * runtime.throughput * stepSec : 0;
    const retired = hasDeadLetter(node, input.topology)
        ? (stuck / (POISON_REDELIVERY_SEC * POISON_MAX_ATTEMPTS)) * stepSec
        : 0;

    input.state.stuck.set(node.id, Math.max(0, stuck + arriving - retired));
}

function summarise(profile: TransientProfile, stepSec: number, samples: TimelineSample[]): Timeline {
    let peakLambda = 0;
    let peakBacklog = 0;
    let peakP99Ms = 0;
    let breachFromSec: number | null = null;
    let lastBreachSec: number | null = null;

    for (const sample of samples) {
        peakLambda = Math.max(peakLambda, sample.lambda);
        peakBacklog = Math.max(peakBacklog, sample.backlog);
        peakP99Ms = Math.max(peakP99Ms, sample.worstP99Ms);

        if (!sample.breach) continue;
        if (breachFromSec === null) breachFromSec = sample.timeSec;
        lastBreachSec = sample.timeSec;
    }

    const settled = peakBacklog * BACKLOG_SETTLED_SHARE;
    const recovered = samples.find(
        (sample) => lastBreachSec !== null && sample.timeSec > lastBreachSec && !sample.breach && sample.backlog <= settled,
    );

    return {
        stepSec,
        horizonSec: profile.horizonSec,
        samples,
        peakLambda,
        peakBacklog,
        peakP99Ms,
        breachFromSec,
        recoveredAtSec: recovered ? recovered.timeSec : null,
    };
}
