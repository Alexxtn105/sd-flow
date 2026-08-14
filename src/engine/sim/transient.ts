import type { SchemeNode, SchemeV1 } from '../types/scheme';
import type { NodeResult, SimResult, TransientNodePoint, TransientResult } from './types';

const DEFAULT_DURATION_SEC = 900;
const DEFAULT_STEP_SEC = 15;
const DEFAULT_SCALE_UP_LAG_SEC = 60;
const DEFAULT_SCALE_DOWN_LAG_SEC = 300;
const DEFAULT_CACHE_WARMUP_SEC = 120;
const TARGET_UTILIZATION = 0.7;

interface NodeState {
    activeInstances: number;
    pendingTarget: number;
    pendingSinceSec: number | null;
    queueDepth: number;
}

function numeric(node: SchemeNode, key: string, fallback: number): number {
    const value = node.params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function flag(node: SchemeNode, key: string, fallback: boolean): boolean {
    const value = node.params[key];
    return typeof value === 'boolean' ? value : fallback;
}

function peakFactor(scheme: SchemeV1): number {
    return Math.max(
        3,
        ...scheme.nodes
            .filter((node) => node.type.startsWith('client-'))
            .map((node) => numeric(node, 'peakFactor', numeric(node, 'spikeFactor', 5))),
    );
}

function loadMultiplier(pattern: string, timeSec: number, peak: number): number {
    if (pattern === 'cache-flush') return 1;
    if (pattern === 'peak') return timeSec < 120 ? 1 + ((peak - 1) * timeSec) / 120 : peak;
    if (pattern !== 'black-friday') return 1;
    if (timeSec < 60) return 1;
    if (timeSec < 180) return 1 + ((peak - 1) * (timeSec - 60)) / 120;
    if (timeSec < 600) return peak;
    if (timeSec < 780) return peak - ((peak - 1) * (timeSec - 600)) / 180;
    return 1;
}

function cacheWarmth(pattern: string, timeSec: number, scheme: SchemeV1): number {
    if (pattern !== 'cache-flush') return 1;
    const warmupSec = Math.max(
        1,
        ...scheme.nodes
            .filter((node) => node.type.includes('cache') || node.type === 'redis' || node.type === 'memcached')
            .map((node) => numeric(node, 'warmupSec', Math.min(numeric(node, 'ttlSec', DEFAULT_CACHE_WARMUP_SEC), 600))),
    );
    return 1 - Math.exp(-timeSec / warmupSec);
}

function finiteCapacity(result: NodeResult): number {
    return Number.isFinite(result.capacity) && result.capacity > 0 ? result.capacity : Number.POSITIVE_INFINITY;
}

function initialState(node: SchemeNode, result: NodeResult): NodeState {
    const activeInstances = Math.max(
        Math.max(1, Math.round(numeric(node, 'instances', result.instances))),
        Math.max(1, Math.round(result.instances)),
    );
    return {
        activeInstances,
        pendingTarget: activeInstances,
        pendingSinceSec: null,
        queueDepth: 0,
    };
}

function targetInstances(node: SchemeNode, result: NodeResult, offeredRps: number, capacityPerInstance: number): number {
    const minimum = Math.max(1, Math.round(numeric(node, 'instances', result.instances)));
    if (!flag(node, 'autoscale', false) || !Number.isFinite(capacityPerInstance)) return minimum;
    const targetUtilization = Math.max(0.05, numeric(node, 'autoscaleTargetUtilization', TARGET_UTILIZATION));
    const maximum = Math.max(minimum, Math.round(numeric(node, 'autoscaleMax', minimum)));
    return Math.min(maximum, Math.max(minimum, Math.ceil(offeredRps / (capacityPerInstance * targetUtilization))));
}

function advanceInstances(node: SchemeNode, state: NodeState, target: number, timeSec: number): void {
    if (target === state.activeInstances) {
        state.pendingTarget = target;
        state.pendingSinceSec = null;
        return;
    }

    if (target !== state.pendingTarget) {
        state.pendingTarget = target;
        state.pendingSinceSec = timeSec;
        return;
    }

    const lag = target > state.activeInstances
        ? numeric(node, 'scaleUpLagSec', DEFAULT_SCALE_UP_LAG_SEC)
        : numeric(node, 'scaleDownLagSec', DEFAULT_SCALE_DOWN_LAG_SEC);
    if (state.pendingSinceSec !== null && timeSec - state.pendingSinceSec >= lag) {
        state.activeInstances = target;
        state.pendingSinceSec = null;
    }
}

export function simulateTransient(
    scheme: SchemeV1,
    steady: SimResult,
    pattern: string,
    durationSec = DEFAULT_DURATION_SEC,
    stepSec = DEFAULT_STEP_SEC,
): TransientResult | null {
    if (!['black-friday', 'peak', 'cache-flush'].includes(pattern)) return null;

    const nodeById = new Map(scheme.nodes.map((node) => [node.id, node]));
    const states = new Map<string, NodeState>();
    const peak = peakFactor(scheme);
    const steadyP99 = Math.max(0, ...steady.flows.map((flow) => flow.latency.p99));

    for (const [nodeId, result] of Object.entries(steady.nodes)) {
        const node = nodeById.get(nodeId);
        if (node) states.set(nodeId, initialState(node, result));
    }

    const points = [];

    for (let timeSec = 0; timeSec <= durationSec; timeSec += stepSec) {
        const multiplier = loadMultiplier(pattern, timeSec, peak);
        const warmth = cacheWarmth(pattern, timeSec, scheme);
        const nodePoints: TransientNodePoint[] = [];
        let deliveryRatio = 1;
        let queueDepth = 0;
        let activeInstances = 0;
        let bottleneckNodeId: string | null = null;
        let bottleneckUtilization = 0;
        let worstWaitMs = 0;

        for (const [nodeId, result] of Object.entries(steady.nodes)) {
            const node = nodeById.get(nodeId);
            const state = states.get(nodeId);
            if (!node || !state) continue;

            const baselineCapacity = finiteCapacity(result);
            const capacityPerInstance = Number.isFinite(baselineCapacity)
                ? baselineCapacity / Math.max(result.instances, 1)
                : Number.POSITIVE_INFINITY;
            const cachePenalty = result.hitRatio === null ? 1 : 1 + (1 - warmth) * result.hitRatio;
            const offeredRps = result.lambdaOffered * multiplier * cachePenalty;
            const target = targetInstances(node, result, offeredRps, capacityPerInstance);
            advanceInstances(node, state, target, timeSec);

            const capacity = capacityPerInstance * state.activeInstances;
            const excess = Number.isFinite(capacity) ? offeredRps - capacity : -state.queueDepth;
            state.queueDepth = Math.max(0, state.queueDepth + excess * stepSec);
            const throughput = Number.isFinite(capacity)
                ? Math.min(capacity, offeredRps + state.queueDepth / Math.max(stepSec, 1))
                : offeredRps;
            const utilization = Number.isFinite(capacity) && capacity > 0 ? offeredRps / capacity : 0;
            const ratio = offeredRps > 0 ? Math.min(1, throughput / offeredRps) : 1;
            deliveryRatio = Math.min(deliveryRatio, ratio);
            queueDepth += state.queueDepth;
            activeInstances += state.activeInstances;
            worstWaitMs = Math.max(worstWaitMs, Number.isFinite(capacity) && capacity > 0 ? (state.queueDepth / capacity) * 1000 : 0);

            if (utilization > bottleneckUtilization) {
                bottleneckUtilization = utilization;
                bottleneckNodeId = nodeId;
            }

            nodePoints.push({
                nodeId,
                activeInstances: state.activeInstances,
                targetInstances: target,
                capacity,
                offeredRps,
                queueDepth: state.queueDepth,
                utilization,
            });
        }

        const offeredRps = steady.totals.rps * multiplier;
        points.push({
            timeSec,
            multiplier,
            offeredRps,
            throughputRps: offeredRps * deliveryRatio,
            errorRate: 1 - deliveryRatio,
            p99Ms: steadyP99 + worstWaitMs,
            queueDepth,
            activeInstances,
            cacheWarmth: warmth,
            bottleneckNodeId,
            nodes: nodePoints,
        });
    }

    return { pattern, durationSec, stepSec, points };
}
