import { ARRIVAL_VARIABILITY } from './constants';
import type { CompiledNode, CompiledTopology } from './compile';
import type { Flow } from './flows';
import { peakMultiplier } from './flows';
import { RETRY_BUDGET } from './solver';
import type { TransientProfile, TransientWindow } from './transient';

export type ScenarioId =
    | 'baseline'
    | 'peak'
    | 'az-failure'
    | 'region-failure'
    | 'cache-flush'
    | 'stale-read'
    | 'write-conflict'
    | 'spike'
    | 'growth'
    | 'black-friday'
    | 'db-failover'
    | 'hot-key'
    | 'slow-dependency'
    | 'thundering-herd'
    | 'retry-storm'
    | 'poison-message';

export const SCENARIOS: ScenarioId[] = [
    'baseline',
    'peak',
    'spike',
    'growth',
    'black-friday',
    'az-failure',
    'region-failure',
    'db-failover',
    'cache-flush',
    'thundering-herd',
    'hot-key',
    'slow-dependency',
    'retry-storm',
    'poison-message',
    'stale-read',
    'write-conflict',
];

export const TRANSIENT_SCENARIOS: ScenarioId[] = [
    'spike',
    'growth',
    'black-friday',
    'db-failover',
    'cache-flush',
    'thundering-herd',
    'hot-key',
    'slow-dependency',
    'retry-storm',
    'poison-message',
];

export interface ScenarioSetup {
    id: ScenarioId;
    trafficMultiplier: number;
    payloadScale: number;
    arrivalVariability: number;
    disabledNodes: Set<string>;
    rerouteEntries: boolean;
    capacityScale: Map<string, number>;
    serviceScale: Map<string, number>;
    retryBudget: number;
    cacheDisabled: boolean;
    replicationLagMultiplier: number;
    forceMultiMaster: boolean;
    transient: TransientProfile | null;
}

const SPIKE_MULTIPLIER = 5;
const GROWTH_MULTIPLIER = 10;
const BLACK_FRIDAY_MULTIPLIER = 20;
const BLACK_FRIDAY_PAYLOAD_SCALE = 1.5;
const HERD_MULTIPLIER = 8;
const RETRY_STORM_MULTIPLIER = 2;
const HOT_KEY_SHARE = 0.4;
const SLOW_DEPENDENCY_FACTOR = 25;
const POISON_SHARE = 0.01;
const DEFAULT_FAILOVER_SEC = 60;

const MINUTE_SEC = 60;
const HOUR_SEC = 3600;
const DAY_SEC = 86_400;

const STORE_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'storage']);
const SHARDED_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'storage', 'cache', 'messaging']);
const EXTERNAL_TYPES = new Set(['external-api', 'payment-external', 'webhook', 'notification']);

function nodesInsideContainer(topology: CompiledTopology, containerId: string): Set<string> {
    const disabled = new Set<string>([containerId]);

    for (const node of topology.nodes) {
        if (node.azId === containerId || node.regionId === containerId) disabled.add(node.id);
    }

    return disabled;
}

function firstContainerOf(topology: CompiledTopology, type: 'az' | 'region'): string | null {
    const container = topology.nodes.find((node) => node.type === type);
    return container ? container.id : null;
}

function trafficNodes(topology: CompiledTopology): CompiledNode[] {
    return topology.nodes.filter((node) => node.definition.shape === 'node');
}

function primaryStores(topology: CompiledTopology): CompiledNode[] {
    const stores = trafficNodes(topology).filter((node) => STORE_GROUPS.has(node.definition.group));
    const writable = stores.filter((node) => node.params.readFromReplica !== 1);
    const chosen = writable.length > 0 ? writable : stores;

    return chosen.slice(0, 1);
}

function externalDependencies(topology: CompiledTopology): CompiledNode[] {
    return trafficNodes(topology).filter((node) => EXTERNAL_TYPES.has(node.type));
}

function consumers(topology: CompiledTopology): CompiledNode[] {
    return trafficNodes(topology).filter((node) =>
        node.incoming.some((edgeId) => topology.edgeById.get(edgeId)?.isAsync === true),
    );
}

export function shardCountOf(node: CompiledNode): number {
    const declared =
        node.params.shards ?? node.params.partitions ?? node.params.nodes ?? node.params.brokers ?? 1;
    const count = Number(declared);

    return Number.isFinite(count) && count >= 1 ? count : 1;
}

export function skewCapacityScale(shards: number, hotKeyShare: number): number {
    const share = Math.min(Math.max(hotKeyShare, 0), 1);
    return 1 / (share * shards + (1 - share));
}

function failoverSecOf(nodes: CompiledNode[]): number {
    const declared = nodes.reduce((max, node) => Math.max(max, Number(node.params.failoverSec ?? 0)), 0);
    return declared > 0 ? declared : DEFAULT_FAILOVER_SEC;
}

function window(fromSec: number, toSec: number): TransientWindow {
    return { fromSec, toSec };
}

function emptyProfile(stepSec: number, horizonSec: number): TransientProfile {
    return {
        stepSec,
        horizonSec,
        load: { kind: 'flat', peakMultiplier: 1, window: window(0, horizonSec), rampSec: 0 },
        payload: { scale: 1, window: window(0, horizonSec) },
        outage: null,
        slowdown: null,
        skew: null,
        cacheFlushAtSec: null,
        poison: null,
        retryBudget: RETRY_BUDGET,
    };
}

function transientProfileFor(topology: CompiledTopology, scenario: ScenarioId): TransientProfile | null {
    if (scenario === 'spike') {
        const profile = emptyProfile(5, 5 * MINUTE_SEC);
        profile.load = {
            kind: 'step',
            peakMultiplier: SPIKE_MULTIPLIER,
            window: window(MINUTE_SEC, 2 * MINUTE_SEC),
            rampSec: 0,
        };
        return profile;
    }

    if (scenario === 'growth') {
        const profile = emptyProfile(30 * DAY_SEC, 730 * DAY_SEC);
        profile.load = {
            kind: 'ramp',
            peakMultiplier: GROWTH_MULTIPLIER,
            window: window(0, 730 * DAY_SEC),
            rampSec: 730 * DAY_SEC,
        };
        return profile;
    }

    if (scenario === 'black-friday') {
        const profile = emptyProfile(5 * MINUTE_SEC, 6 * HOUR_SEC);
        profile.load = {
            kind: 'plateau',
            peakMultiplier: BLACK_FRIDAY_MULTIPLIER,
            window: window(30 * MINUTE_SEC, 4.5 * HOUR_SEC),
            rampSec: 15 * MINUTE_SEC,
        };
        profile.payload = {
            scale: BLACK_FRIDAY_PAYLOAD_SCALE,
            window: window(30 * MINUTE_SEC, 4.5 * HOUR_SEC),
        };
        return profile;
    }

    if (scenario === 'db-failover') {
        const stores = primaryStores(topology);
        if (stores.length === 0) return null;

        const failoverSec = failoverSecOf(stores);
        const profile = emptyProfile(5, Math.max(5 * MINUTE_SEC, 4 * failoverSec));
        profile.outage = {
            nodeIds: stores.map((node) => node.id),
            window: window(MINUTE_SEC, MINUTE_SEC + failoverSec),
        };
        return profile;
    }

    if (scenario === 'hot-key') {
        const profile = emptyProfile(10, 10 * MINUTE_SEC);
        profile.skew = {
            nodeIds: trafficNodes(topology)
                .filter((node) => SHARDED_GROUPS.has(node.definition.group))
                .map((node) => node.id),
            hotKeyShare: HOT_KEY_SHARE,
            window: window(2 * MINUTE_SEC, 7 * MINUTE_SEC),
        };
        return profile;
    }

    if (scenario === 'slow-dependency') {
        const dependencies = externalDependencies(topology);
        if (dependencies.length === 0) return null;

        const profile = emptyProfile(5, 5 * MINUTE_SEC);
        profile.slowdown = {
            nodeIds: dependencies.map((node) => node.id),
            factor: SLOW_DEPENDENCY_FACTOR,
            window: window(MINUTE_SEC, 4 * MINUTE_SEC),
        };
        return profile;
    }

    if (scenario === 'cache-flush') {
        const profile = emptyProfile(5, 5 * MINUTE_SEC);
        profile.cacheFlushAtSec = 0;
        return profile;
    }

    if (scenario === 'thundering-herd') {
        const profile = emptyProfile(2, 2 * MINUTE_SEC);
        profile.load = {
            kind: 'burst',
            peakMultiplier: HERD_MULTIPLIER,
            window: window(30, 40),
            rampSec: 0,
        };
        profile.cacheFlushAtSec = 30;
        return profile;
    }

    if (scenario === 'retry-storm') {
        const profile = emptyProfile(5, 5 * MINUTE_SEC);
        profile.load = {
            kind: 'step',
            peakMultiplier: RETRY_STORM_MULTIPLIER,
            window: window(MINUTE_SEC, 3 * MINUTE_SEC),
            rampSec: 0,
        };
        profile.retryBudget = 1;
        return profile;
    }

    if (scenario === 'poison-message') {
        const stuck = consumers(topology);
        if (stuck.length === 0) return null;

        const profile = emptyProfile(30, 30 * MINUTE_SEC);
        profile.poison = {
            nodeIds: stuck.map((node) => node.id),
            share: POISON_SHARE,
            window: window(MINUTE_SEC, 30 * MINUTE_SEC),
        };
        return profile;
    }

    return null;
}

function applyWorstMoment(setup: ScenarioSetup, profile: TransientProfile, topology: CompiledTopology): void {
    setup.trafficMultiplier = profile.load.peakMultiplier;
    setup.payloadScale = profile.payload.scale;
    setup.retryBudget = profile.retryBudget;

    if (profile.outage) {
        for (const nodeId of profile.outage.nodeIds) setup.disabledNodes.add(nodeId);
    }

    if (profile.slowdown) {
        for (const nodeId of profile.slowdown.nodeIds) setup.serviceScale.set(nodeId, profile.slowdown.factor);
    }

    if (profile.skew) {
        for (const nodeId of profile.skew.nodeIds) {
            const node = topology.nodeById.get(nodeId);
            if (!node) continue;
            setup.capacityScale.set(nodeId, skewCapacityScale(shardCountOf(node), profile.skew.hotKeyShare));
        }
    }

    if (profile.cacheFlushAtSec !== null) setup.cacheDisabled = true;
}

export function buildScenario(topology: CompiledTopology, id: string): ScenarioSetup {
    const scenario = (SCENARIOS.includes(id as ScenarioId) ? id : 'baseline') as ScenarioId;

    const setup: ScenarioSetup = {
        id: scenario,
        trafficMultiplier: 1,
        payloadScale: 1,
        arrivalVariability: ARRIVAL_VARIABILITY[scenario] ?? 1,
        disabledNodes: new Set<string>(),
        rerouteEntries: false,
        capacityScale: new Map<string, number>(),
        serviceScale: new Map<string, number>(),
        retryBudget: RETRY_BUDGET,
        cacheDisabled: false,
        replicationLagMultiplier: 1,
        forceMultiMaster: false,
        transient: null,
    };

    if (scenario === 'peak') {
        setup.trafficMultiplier = peakMultiplier(topology);
        return setup;
    }

    if (scenario === 'az-failure') {
        const az = firstContainerOf(topology, 'az');
        if (az) setup.disabledNodes = nodesInsideContainer(topology, az);
        return setup;
    }

    if (scenario === 'region-failure') {
        const region = firstContainerOf(topology, 'region');
        if (region) setup.disabledNodes = nodesInsideContainer(topology, region);
        setup.rerouteEntries = true;
        return setup;
    }

    if (scenario === 'stale-read') {
        setup.replicationLagMultiplier = 10;
        return setup;
    }

    if (scenario === 'write-conflict') {
        setup.forceMultiMaster = true;
        return setup;
    }

    const profile = transientProfileFor(topology, scenario);

    if (scenario === 'cache-flush') {
        setup.cacheDisabled = true;
        setup.transient = profile;
        return setup;
    }

    if (profile) {
        setup.transient = profile;
        applyWorstMoment(setup, profile, topology);
    }

    return setup;
}

function livingEntries(flows: Flow[], setup: ScenarioSetup): { alive: Flow[]; lostRps: number } {
    const alive: Flow[] = [];
    let lostRps = 0;

    for (const flow of flows) {
        if (setup.disabledNodes.has(flow.entryNodeId)) lostRps += flow.rps;
        else alive.push(flow);
    }

    return { alive, lostRps };
}

export function applyScenarioToFlows(flows: Flow[], setup: ScenarioSetup): Flow[] {
    const scaled =
        setup.trafficMultiplier === 1
            ? flows
            : flows.map((flow) => ({ ...flow, rps: flow.rps * setup.trafficMultiplier }));

    if (!setup.rerouteEntries) return scaled;

    const { alive, lostRps } = livingEntries(scaled, setup);
    if (lostRps <= 0 || alive.length === 0) return scaled;

    const survivingRps = alive.reduce((sum, flow) => sum + flow.rps, 0);
    if (survivingRps <= 0) return alive;

    return alive.map((flow) => ({ ...flow, rps: flow.rps + (lostRps * flow.rps) / survivingRps }));
}
