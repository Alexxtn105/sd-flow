import type { ComponentParams } from '../types/component';
import type { CompiledNode, CompiledTopology } from '../sim/compile';
import { redundancyOfNode } from '../sim/availability';
import type { ScenarioId } from '../sim/scenarios';
import type { AnomalyRate, FlowResult, SimResult } from '../sim/types';
import type {
    AnomalyRequirement,
    BudgetRequirement,
    CapabilityRequirement,
    CapacityRequirement,
    ConsistencyRequirement,
    DurabilityRequirement,
    FreshnessRequirement,
    GeoRequirement,
    NodeMatcher,
    RedundancyRequirement,
    Requirement,
    RequirementContribution,
    RequirementEvaluation,
    RpoRtoRequirement,
    ScenarioRelaxation,
    SecurityControl,
    SecurityRequirement,
    SloRequirement,
    StorageRequirement,
} from './types';

export interface PredicateInput {
    topology: CompiledTopology;
    result: SimResult;
    scenario: ScenarioId;
    relaxation: ScenarioRelaxation;
}

const DAYS_PER_YEAR = 365;
const STORE_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'storage']);

const PROVISIONED_STORAGE_GB: Record<string, (params: ComponentParams) => number> = {
    postgres: (params) => Number(params.storageGb ?? 0),
    mysql: (params) => Number(params.storageGb ?? 0),
    mongodb: (params) => Number(params.storageGb ?? 0),
    cassandra: (params) => Number(params.nodes ?? 0) * Number(params.storageGbPerNode ?? 0),
    elasticsearch: (params) => Number(params.nodes ?? 0) * Number(params.storageGbPerNode ?? 0),
    clickhouse: (params) => Number(params.nodes ?? 0) * Number(params.storageGbPerNode ?? 0),
    minio: (params) => Number(params.usableTb ?? 0) * 1000,
    redis: (params) => Number(params.memoryGb ?? 0) * Number(params.shards ?? 1),
    s3: () => Number.POSITIVE_INFINITY,
    dynamodb: () => Number.POSITIVE_INFINITY,
};

const REPLICATION_FACTOR: Record<string, (params: ComponentParams) => number> = {
    postgres: (params) => 1 + Number(params.readReplicas ?? 0),
    mysql: (params) => 1 + Number(params.readReplicas ?? 0),
    mongodb: (params) => Number(params.replicaSetSize ?? 1),
    cassandra: (params) => Number(params.replicationFactor ?? 1),
    dynamodb: () => 3,
    elasticsearch: (params) => 1 + Number(params.replicas ?? 0),
    clickhouse: (params) => Number(params.replicas ?? 1),
    kafka: (params) => Number(params.replicationFactor ?? 1),
    s3: () => 3,
    minio: () => 3,
    redis: (params) => 1 + Number(params.replicasPerShard ?? 0),
};

function matches(node: CompiledNode, matcher: NodeMatcher): boolean {
    if (matcher.type && node.type !== matcher.type) return false;
    if (matcher.group && node.definition.group !== matcher.group) return false;
    return Boolean(matcher.type || matcher.group);
}

function matchesAny(node: CompiledNode, matchers: NodeMatcher[] | undefined): boolean {
    if (!matchers || matchers.length === 0) return false;
    return matchers.some((matcher) => matches(node, matcher));
}

export function findPath(
    topology: CompiledTopology,
    from: string,
    to: NodeMatcher,
    viaAny?: NodeMatcher[],
    notVia?: NodeMatcher[],
): string[] | null {
    const start = topology.nodeById.get(from);
    if (!start || matchesAny(start, notVia)) return null;

    const requiresVia = Boolean(viaAny && viaAny.length > 0);
    const startVia = matchesAny(start, viaAny);
    const parents = new Map<string, string>();
    const queue: { nodeId: string; via: boolean }[] = [{ nodeId: from, via: startVia }];
    const seen = new Set<string>([`${from}|${startVia ? 1 : 0}`]);

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;

        const node = topology.nodeById.get(current.nodeId);
        if (!node) continue;

        if (matches(node, to) && (!requiresVia || current.via) && current.nodeId !== from) {
            const path: string[] = [current.nodeId];
            let cursor = `${current.nodeId}|${current.via ? 1 : 0}`;
            while (parents.has(cursor)) {
                const previous = parents.get(cursor) ?? '';
                path.unshift(previous.split('|')[0]);
                cursor = previous;
            }
            return path;
        }

        for (const edgeId of node.outgoing) {
            const edge = topology.edgeById.get(edgeId);
            if (!edge) continue;

            const next = topology.nodeById.get(edge.target);
            if (!next || matchesAny(next, notVia)) continue;

            const via = current.via || matchesAny(next, viaAny);
            const key = `${next.id}|${via ? 1 : 0}`;
            if (seen.has(key)) continue;

            seen.add(key);
            parents.set(key, `${current.nodeId}|${current.via ? 1 : 0}`);
            queue.push({ nodeId: next.id, via });
        }
    }

    return null;
}

export function servingNodes(topology: CompiledTopology): Set<string> {
    const serving = new Set<string>();

    for (const entry of topology.entryNodes) {
        for (const nodeId of reachableFrom(topology, entry)) serving.add(nodeId);
    }

    return serving;
}

export function reachableFrom(topology: CompiledTopology, from: string): Set<string> {
    const seen = new Set<string>([from]);
    const queue = [from];

    while (queue.length > 0) {
        const current = queue.shift();
        const node = current ? topology.nodeById.get(current) : undefined;
        if (!node) continue;

        for (const edgeId of node.outgoing) {
            const edge = topology.edgeById.get(edgeId);
            if (!edge || seen.has(edge.target)) continue;
            seen.add(edge.target);
            queue.push(edge.target);
        }
    }

    return seen;
}

function flowOf(result: SimResult, flowId: string): FlowResult | undefined {
    return result.flows.find((flow) => flow.id === flowId);
}

function unknown(
    requirement: Requirement,
    scenario: ScenarioId,
    reason: string,
    values: Record<string, string | number> = {},
): RequirementEvaluation {
    return {
        id: requirement.id,
        kind: requirement.kind,
        status: 'unknown',
        scenario,
        reason,
        actual: null,
        target: null,
        unit: '',
        headroom: null,
        nodeIds: [],
        values,
        contributions: [],
    };
}

interface ThresholdInput {
    requirement: Requirement;
    scenario: ScenarioId;
    actual: number;
    target: number;
    unit: string;
    direction: 'max' | 'min';
    reason: string;
    nodeIds?: string[];
    values?: Record<string, string | number>;
    contributions?: RequirementContribution[];
}

const MAX_CONTRIBUTIONS = 3;

export function topContributions(
    entries: { nodeId: string; value: number }[],
    limit = MAX_CONTRIBUTIONS,
): RequirementContribution[] {
    const positive = entries.filter((entry) => entry.value > 0);
    const total = positive.reduce((sum, entry) => sum + entry.value, 0);
    if (total <= 0) return [];

    return [...positive]
        .sort((left, right) => right.value - left.value)
        .slice(0, limit)
        .map((entry) => ({ nodeId: entry.nodeId, value: entry.value, share: entry.value / total }));
}

function threshold(input: ThresholdInput): RequirementEvaluation {
    const { requirement, scenario, actual, target, unit, direction, reason } = input;
    const met = direction === 'max' ? actual <= target : actual >= target;
    const headroom = target === 0 ? null : direction === 'max' ? (target - actual) / target : (actual - target) / target;

    return {
        id: requirement.id,
        kind: requirement.kind,
        status: met ? 'met' : 'unmet',
        scenario,
        reason: met ? 'ok' : reason,
        actual,
        target,
        unit,
        headroom,
        nodeIds: input.nodeIds ?? [],
        values: input.values ?? {},
        contributions: input.contributions ?? [],
    };
}

function binary(
    requirement: Requirement,
    scenario: ScenarioId,
    met: boolean,
    reason: string,
    nodeIds: string[] = [],
    values: Record<string, string | number> = {},
): RequirementEvaluation {
    return {
        id: requirement.id,
        kind: requirement.kind,
        status: met ? 'met' : 'unmet',
        scenario,
        reason: met ? 'ok' : reason,
        actual: null,
        target: null,
        unit: '',
        headroom: null,
        nodeIds,
        values,
        contributions: [],
    };
}

function evaluateCapability(requirement: CapabilityRequirement, input: PredicateInput): RequirementEvaluation {
    const flow = flowOf(input.result, requirement.flow);
    if (!flow) return unknown(requirement, input.scenario, 'flow-missing', { flow: requirement.flow });

    const path = findPath(input.topology, flow.entryNodeId, requirement.to, requirement.viaAny, requirement.notVia);
    if (!path) return binary(requirement, input.scenario, false, 'path-missing', [flow.entryNodeId]);

    if (requirement.asyncBefore) {
        const blocking = input.topology.edges.filter((edge) => {
            const target = input.topology.nodeById.get(edge.target);
            return target !== undefined && matches(target, requirement.asyncBefore as NodeMatcher) && !edge.isAsync;
        });

        if (blocking.length > 0) {
            return binary(
                requirement,
                input.scenario,
                false,
                'sync-instead-of-async',
                blocking.map((edge) => edge.target),
                { edges: blocking.length },
            );
        }
    }

    return binary(requirement, input.scenario, true, 'ok', path);
}

function evaluateSlo(requirement: SloRequirement, input: PredicateInput): RequirementEvaluation {
    const flow = flowOf(input.result, requirement.flow);
    if (!flow) return unknown(requirement, input.scenario, 'flow-missing', { flow: requirement.flow });

    const latencyFactor = input.relaxation.latencyFactor ?? 1;
    const worstHop = [...flow.hops].sort((left, right) => right.contributionMs - left.contributionMs)[0];

    if (requirement.metric === 'availability') {
        const target = Math.min(requirement.min ?? 0, input.relaxation.availabilityFloor ?? Number.POSITIVE_INFINITY);
        const downtime = flow.hops.map((hop) => ({
            nodeId: hop.nodeId,
            value: 1 - (input.result.nodes[hop.nodeId]?.availability ?? 1),
        }));

        return threshold({
            requirement,
            scenario: input.scenario,
            actual: flow.availability,
            target,
            unit: 'ratio',
            direction: 'min',
            reason: 'below-target',
            contributions: topContributions(downtime),
        });
    }

    if (requirement.metric === 'errorRate') {
        return threshold({
            requirement,
            scenario: input.scenario,
            actual: flow.errorRate,
            target: requirement.max ?? 0,
            unit: 'ratio',
            direction: 'max',
            reason: 'above-target',
        });
    }

    const quantile =
        requirement.metric === 'latency.p50'
            ? flow.latency.p50
            : requirement.metric === 'latency.p95'
              ? flow.latency.p95
              : flow.latency.p99;

    return threshold({
        requirement,
        scenario: input.scenario,
        actual: quantile,
        target: (requirement.max ?? 0) * latencyFactor,
        unit: 'ms',
        direction: 'max',
        reason: 'above-target',
        nodeIds: worstHop ? [worstHop.nodeId] : [],
        values: worstHop ? { worstNode: worstHop.nodeId, worstMs: worstHop.contributionMs } : {},
        contributions: topContributions(
            flow.hops.map((hop) => ({ nodeId: hop.nodeId, value: hop.contributionMs })),
        ),
    });
}

function evaluateCapacity(requirement: CapacityRequirement, input: PredicateInput): RequirementEvaluation {
    const loaded = Object.values(input.result.nodes).filter((node) => node.lambdaOffered > 0);
    if (loaded.length === 0) return unknown(requirement, input.scenario, 'no-load');

    const worst = loaded.reduce((left, right) => (right.utilization > left.utilization ? right : left));
    const target = requirement.maxUtilization * (input.relaxation.utilizationFactor ?? 1);

    return threshold({
        requirement,
        scenario: input.scenario,
        actual: worst.utilization,
        target,
        unit: 'ratio',
        direction: 'max',
        reason: 'node-saturated',
        nodeIds: [worst.nodeId],
        values: { node: worst.nodeId, boundBy: worst.boundBy, capacity: worst.capacity },
        contributions: topContributions(
            loaded.map((node) => ({ nodeId: node.nodeId, value: node.utilization })),
        ),
    });
}

function evaluateDurability(requirement: DurabilityRequirement, input: PredicateInput): RequirementEvaluation {
    const flow = flowOf(input.result, requirement.flow);
    if (!flow) return unknown(requirement, input.scenario, 'flow-missing', { flow: requirement.flow });

    const reachable = reachableFrom(input.topology, flow.entryNodeId);
    const stores = input.topology.nodes.filter(
        (node) => STORE_GROUPS.has(node.definition.group) && reachable.has(node.id),
    );

    if (stores.length === 0) return binary(requirement, input.scenario, false, 'store-missing', [flow.entryNodeId]);

    const weakest = stores.reduce((left, right) => {
        const leftFactor = REPLICATION_FACTOR[left.type]?.(left.params) ?? 1;
        const rightFactor = REPLICATION_FACTOR[right.type]?.(right.params) ?? 1;
        return rightFactor < leftFactor ? right : left;
    });

    const factor = REPLICATION_FACTOR[weakest.type]?.(weakest.params) ?? 1;

    return threshold({
        requirement,
        scenario: input.scenario,
        actual: factor,
        target: requirement.minReplication,
        unit: 'x',
        direction: 'min',
        reason: 'replication-too-low',
        nodeIds: [weakest.id],
        values: { node: weakest.id, type: weakest.type },
    });
}

function evaluateRedundancy(requirement: RedundancyRequirement, input: PredicateInput): RequirementEvaluation {
    const flow = flowOf(input.result, requirement.flow);
    if (!flow) return unknown(requirement, input.scenario, 'flow-missing', { flow: requirement.flow });

    const hops = flow.hops
        .map((hop) => input.topology.nodeById.get(hop.nodeId))
        .filter((node): node is CompiledNode => node !== undefined && node.definition.group !== 'clients');

    if (hops.length === 0) return unknown(requirement, input.scenario, 'path-missing');

    const single = hops.filter((node) => {
        const runtime = input.result.nodes[node.id];
        if (runtime === undefined) return false;
        if (node.definition.managed) return false;
        return redundancyOfNode(node, runtime.instances) < requirement.minRedundancy;
    });

    if (single.length > 0) {
        return binary(
            requirement,
            input.scenario,
            false,
            'single-instance',
            single.map((node) => node.id),
            { node: single[0].id, instances: input.result.nodes[single[0].id]?.instances ?? 0 },
        );
    }

    if (requirement.spanAzs) {
        const azs = new Set(hops.map((node) => node.azId).filter((azId): azId is string => azId !== null));
        const spread = hops.every((node) => Number(node.params.azSpread ?? 1) >= (requirement.spanAzs ?? 1));

        if (azs.size < requirement.spanAzs && !spread) {
            return threshold({
                requirement,
                scenario: input.scenario,
                actual: Math.max(azs.size, 1),
                target: requirement.spanAzs,
                unit: 'x',
                direction: 'min',
                reason: 'single-az',
                nodeIds: hops.map((node) => node.id),
            });
        }
    }

    return binary(requirement, input.scenario, true, 'ok', hops.map((node) => node.id));
}

function evaluateBudget(requirement: BudgetRequirement, input: PredicateInput): RequirementEvaluation {
    return threshold({
        requirement,
        scenario: input.scenario,
        actual: input.result.totals.costMonth,
        target: requirement.maxMonthlyCostUsd,
        unit: '$',
        direction: 'max',
        reason: 'over-budget',
        contributions: topContributions(
            Object.values(input.result.nodes).map((node) => ({
                nodeId: node.nodeId,
                value: node.cost.total,
            })),
        ),
    });
}

function evaluateStorage(requirement: StorageRequirement, input: PredicateInput): RequirementEvaluation {
    const needed = input.result.totals.growthGbDay * DAYS_PER_YEAR * requirement.horizonYears * requirement.headroom;
    const serving = servingNodes(input.topology);

    const provisioned = input.topology.nodes.reduce((sum, node) => {
        if (!serving.has(node.id)) return sum;

        const capacity = PROVISIONED_STORAGE_GB[node.type];
        return capacity ? sum + capacity(node.params) : sum;
    }, 0);

    if (needed === 0) return unknown(requirement, input.scenario, 'no-growth');

    return threshold({
        requirement,
        scenario: input.scenario,
        actual: provisioned,
        target: needed,
        unit: 'gb',
        direction: 'min',
        reason: 'not-enough-capacity',
        values: { growthGbDay: input.result.totals.growthGbDay, horizonYears: requirement.horizonYears },
    });
}

function evaluateFreshness(requirement: FreshnessRequirement, input: PredicateInput): RequirementEvaluation {
    const lagging = Object.values(input.result.edges).filter((edge) => edge.lagSec > 0);
    if (lagging.length === 0) return unknown(requirement, input.scenario, 'no-async-edges');

    const worst = lagging.reduce((left, right) => (right.lagSec > left.lagSec ? right : left));
    const target = input.topology.edgeById.get(worst.edgeId);

    return threshold({
        requirement,
        scenario: input.scenario,
        actual: worst.lagSec,
        target: requirement.maxLagSec,
        unit: 's',
        direction: 'max',
        reason: 'lag-too-high',
        nodeIds: target ? [target.target] : [],
        values: { edge: worst.edgeId },
    });
}

const CONSISTENCY_CODES: Record<string, string[]> = {
    strong: ['stale-read', 'read-your-writes', 'lost-update', 'lost-write-lww'],
    'read-your-writes': ['read-your-writes'],
    eventual: [],
};

function evaluateConsistency(requirement: ConsistencyRequirement, input: PredicateInput): RequirementEvaluation {
    if (input.result.consistency.mode !== 'anomalies') {
        return unknown(requirement, input.scenario, 'consistency-model-off');
    }

    const codes = CONSISTENCY_CODES[requirement.requires] ?? [];
    const hits = input.result.consistency.anomalies.filter((anomaly) => codes.includes(anomaly.code));

    if (hits.length === 0) return binary(requirement, input.scenario, true, 'ok');

    const worst = hits.reduce((left, right) => (right.ratePerSec > left.ratePerSec ? right : left));

    return threshold({
        requirement,
        scenario: input.scenario,
        actual: worst.ratePerSec,
        target: 0,
        unit: 'rps',
        direction: 'max',
        reason: 'anomaly-present',
        nodeIds: worst.nodeIds,
        values: { anomaly: worst.code, share: worst.shareOfOperations },
    });
}

function evaluateAnomaly(requirement: AnomalyRequirement, input: PredicateInput): RequirementEvaluation {
    if (input.result.consistency.mode !== 'anomalies') {
        return unknown(requirement, input.scenario, 'consistency-model-off');
    }

    const matching = input.result.consistency.anomalies.filter((item) => item.code === requirement.code);
    const worstBy = (pick: (item: AnomalyRate) => number): AnomalyRate | undefined =>
        matching.reduce<AnomalyRate | undefined>(
            (worst, item) => (worst === undefined || pick(item) > pick(worst) ? item : worst),
            undefined,
        );

    const worstShare = worstBy((item) => item.shareOfOperations);
    const worstRate = worstBy((item) => item.ratePerSec);
    const share = worstShare?.shareOfOperations ?? 0;
    const ratePerSec = worstRate?.ratePerSec ?? 0;

    if (requirement.maxSharePercent !== undefined) {
        return threshold({
            requirement,
            scenario: input.scenario,
            actual: share * 100,
            target: requirement.maxSharePercent,
            unit: '%',
            direction: 'max',
            reason: 'anomaly-above-threshold',
            nodeIds: worstShare?.nodeIds ?? [],
            values: { anomaly: requirement.code, ratePerSec },
        });
    }

    return threshold({
        requirement,
        scenario: input.scenario,
        actual: ratePerSec,
        target: requirement.maxRatePerSec ?? 0,
        unit: 'rps',
        direction: 'max',
        reason: 'anomaly-above-threshold',
        nodeIds: worstRate?.nodeIds ?? [],
        values: { anomaly: requirement.code, share },
    });
}

function evaluateGeo(requirement: GeoRequirement, input: PredicateInput): RequirementEvaluation {
    if (requirement.minRegions !== undefined) {
        const regions = input.topology.regions.length;
        if (regions < requirement.minRegions) {
            return threshold({
                requirement,
                scenario: input.scenario,
                actual: regions,
                target: requirement.minRegions,
                unit: 'x',
                direction: 'min',
                reason: 'not-enough-regions',
            });
        }
    }

    if (requirement.residency) {
        const policy = input.topology.multiRegionPolicy;
        const declared = String(policy?.params.dataResidency ?? 'none');
        if (declared === 'none') {
            return binary(requirement, input.scenario, false, 'residency-not-declared', policy ? [policy.id] : []);
        }
    }

    if (requirement.maxClientRttMs !== undefined) {
        const entryHops = input.result.flows
            .map((flow) => flow.hops.find((hop) => hop.depth === 1))
            .filter((hop): hop is NonNullable<typeof hop> => hop !== undefined);

        if (entryHops.length > 0) {
            const worst = entryHops.reduce((left, right) => (right.networkMs > left.networkMs ? right : left));
            return threshold({
                requirement,
                scenario: input.scenario,
                actual: worst.networkMs,
                target: requirement.maxClientRttMs,
                unit: 'ms',
                direction: 'max',
                reason: 'client-too-far',
                nodeIds: [worst.nodeId],
            });
        }
    }

    return binary(requirement, input.scenario, true, 'ok');
}

function evaluateRpoRto(requirement: RpoRtoRequirement, input: PredicateInput): RequirementEvaluation {
    const multiRegion = input.result.multiRegion;
    if (!multiRegion) return unknown(requirement, input.scenario, 'no-multi-region');

    if (multiRegion.rpoSec > requirement.maxRpoSec) {
        return threshold({
            requirement,
            scenario: input.scenario,
            actual: multiRegion.rpoSec,
            target: requirement.maxRpoSec,
            unit: 's',
            direction: 'max',
            reason: 'rpo-too-high',
        });
    }

    return threshold({
        requirement,
        scenario: input.scenario,
        actual: multiRegion.rtoSec,
        target: requirement.maxRtoSec,
        unit: 's',
        direction: 'max',
        reason: 'rto-too-high',
    });
}

function hasAuthOnEdge(topology: CompiledTopology): boolean {
    const gateways = topology.nodes.filter((node) => node.type === 'api-gateway');
    const authenticated = gateways.some((node) => String(node.params.authMode ?? 'none') !== 'none');
    const authNode = topology.nodes.some((node) => node.type === 'auth');
    return authenticated || authNode;
}

function hasDirectClientToStore(topology: CompiledTopology): CompiledNode[] {
    const offenders: CompiledNode[] = [];

    for (const edge of topology.edges) {
        const source = topology.nodeById.get(edge.source);
        const target = topology.nodeById.get(edge.target);
        if (!source || !target) continue;
        if (source.definition.group === 'clients' && STORE_GROUPS.has(target.definition.group)) offenders.push(target);
    }

    return offenders;
}

function controlSatisfied(control: SecurityControl, topology: CompiledTopology): { met: boolean; nodeIds: string[] } {
    if (control === 'auth-on-edge') return { met: hasAuthOnEdge(topology), nodeIds: [] };

    if (control === 'no-direct-client-to-db') {
        const offenders = hasDirectClientToStore(topology);
        return { met: offenders.length === 0, nodeIds: offenders.map((node) => node.id) };
    }

    if (control === 'tls-terminate') {
        const terminators = topology.nodes.filter(
            (node) => node.params.tlsTerminate === true || node.type === 'api-gateway' || node.type === 'cdn',
        );
        return { met: terminators.length > 0, nodeIds: [] };
    }

    const limited = topology.nodes.filter(
        (node) => node.type === 'api-gateway' && Number(node.params.rateLimitRpsPerClient ?? 0) > 0,
    );
    return { met: limited.length > 0, nodeIds: [] };
}

function evaluateSecurity(requirement: SecurityRequirement, input: PredicateInput): RequirementEvaluation {
    for (const control of requirement.requires) {
        const outcome = controlSatisfied(control, input.topology);
        if (!outcome.met) {
            return binary(requirement, input.scenario, false, `control-${control}`, outcome.nodeIds, { control });
        }
    }

    return binary(requirement, input.scenario, true, 'ok');
}

export function evaluateRequirement(requirement: Requirement, input: PredicateInput): RequirementEvaluation {
    switch (requirement.kind) {
        case 'capability':
            return evaluateCapability(requirement, input);
        case 'slo':
            return evaluateSlo(requirement, input);
        case 'capacity':
            return evaluateCapacity(requirement, input);
        case 'durability':
            return evaluateDurability(requirement, input);
        case 'redundancy':
            return evaluateRedundancy(requirement, input);
        case 'budget':
            return evaluateBudget(requirement, input);
        case 'storage':
            return evaluateStorage(requirement, input);
        case 'freshness':
            return evaluateFreshness(requirement, input);
        case 'consistency':
            return evaluateConsistency(requirement, input);
        case 'anomaly':
            return evaluateAnomaly(requirement, input);
        case 'geo':
            return evaluateGeo(requirement, input);
        case 'rpo-rto':
            return evaluateRpoRto(requirement, input);
        case 'security':
            return evaluateSecurity(requirement, input);
    }
}

export function evaluateRequirements(requirements: Requirement[], input: PredicateInput): RequirementEvaluation[] {
    return requirements
        .filter((requirement) => (requirement.scenario ?? 'baseline') === input.scenario)
        .map((requirement) => evaluateRequirement(requirement, input));
}
