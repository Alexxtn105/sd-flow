import type { CompiledEdge, CompiledNode, CompiledTopology } from '../sim/compile';
import type { Finding, NodeResult, SimResult } from '../sim/types';
import type { LintHit, LintResult } from './types';

export interface LintInput {
    topology: CompiledTopology;
    result: SimResult;
}

const POSITIVE_WEIGHT = 1;
const MAX_SCORE = 100;

const STORE_GROUPS = new Set(['sql', 'nosql', 'search', 'olap']);
const STATEFUL_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'cache']);
const DURABLE_GROUPS = new Set(['sql', 'nosql', 'search', 'olap', 'storage']);
const BUFFERED_GROUPS = new Set(['compute', 'messaging']);
const CAPACITY_GROUPS = new Set([
    'edge',
    'compute',
    'sql',
    'nosql',
    'search',
    'olap',
    'cache',
    'messaging',
    'storage',
    'platform',
]);
const WRITE_OPERATIONS = new Set(['write', 'delete']);
const SHARD_KEY_PARAMS = ['partitionKey', 'shardKey'];
const HOT_SHARE_PARAMS = ['hotPartitionShare', 'hotKeyShare'];
const BUFFER_LIMIT_PARAMS = [
    'queueLimit',
    'maxQueueDepth',
    'maxInflight',
    'maxDepth',
    'maxConcurrency',
    'concurrencyPerInstance',
    'concurrency',
    'retentionHours',
];
const RETRY_CAP_PARAMS = ['retries', 'maxReceiveCount', 'maxRetries'];

const GDPR_GEO = 'europe';
const READ_HEAVY_SHARE = 0.5;
const SLOW_OPERATION_SEC = 1;
const CHATTY_FANOUT = 10;
const N_PLUS_ONE_FANOUT = 20;
const HOT_PARTITION_SHARE = 0.3;
const OVER_PROVISIONED_UTILIZATION = 0.1;
const BLOB_BYTES = 1e6;
const FULL_SAMPLING = 1;
const DEEP_SYNC_HOPS = 5;
const MAX_SYNC_WALK = 32;

interface ConsumerLink {
    queue: CompiledNode;
    consumer: CompiledNode;
    edge: CompiledEdge;
}

interface LintContext {
    topology: CompiledTopology;
    result: SimResult;
    reachable: Set<string>;
    perimeter: Set<string>;
    trafficNodes: CompiledNode[];
    criticalNodes: CompiledNode[];
    findingsByCode: Map<string, Finding[]>;
    consumers: ConsumerLink[];
}

interface PositiveOutcome {
    applicable: boolean;
    passed: boolean;
    nodeIds?: string[];
    edgeIds?: string[];
    values?: Record<string, string | number>;
}

interface Detection {
    nodeIds?: string[];
    edgeIds?: string[];
    values?: Record<string, string | number>;
}

interface PositiveRule {
    rule: string;
    weight: number;
    evaluate: (ctx: LintContext) => PositiveOutcome;
}

interface AntipatternRule {
    rule: string;
    weight: number;
    detect: (ctx: LintContext) => Detection | null;
}

const NOT_APPLICABLE: PositiveOutcome = { applicable: false, passed: false };

function numericParam(node: CompiledNode, name: string): number | null {
    const value = node.params[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textParam(node: CompiledNode, name: string): string | null {
    const value = node.params[name];
    return typeof value === 'string' ? value : null;
}

function flagParam(node: CompiledNode, name: string): boolean | null {
    const value = node.params[name];
    return typeof value === 'boolean' ? value : null;
}

function firstNumericParam(node: CompiledNode, names: string[]): number | null {
    for (const name of names) {
        const value = numericParam(node, name);
        if (value !== null) return value;
    }

    return null;
}

function firstTextParam(node: CompiledNode, names: string[]): string | null {
    for (const name of names) {
        const value = textParam(node, name);
        if (value !== null) return value;
    }

    return null;
}

function nodeResultOf(ctx: LintContext, nodeId: string): NodeResult | null {
    return ctx.result.nodes[nodeId] ?? null;
}

function offeredRps(ctx: LintContext, nodeId: string): number {
    return nodeResultOf(ctx, nodeId)?.lambdaOffered ?? 0;
}

function readRpsOf(ctx: LintContext, nodeId: string): number {
    const nodeResult = nodeResultOf(ctx, nodeId);
    return nodeResult ? nodeResult.lambdaOffered * nodeResult.readShare : 0;
}

function writeRpsOf(ctx: LintContext, nodeId: string): number {
    const nodeResult = nodeResultOf(ctx, nodeId);
    return nodeResult ? nodeResult.lambdaOffered * nodeResult.writeShare : 0;
}

function utilizationOf(ctx: LintContext, nodeId: string): number {
    return nodeResultOf(ctx, nodeId)?.utilization ?? 0;
}

function edgeRpsOf(ctx: LintContext, edgeId: string): number {
    return ctx.result.edges[edgeId]?.rps ?? 0;
}

function nodeOf(ctx: LintContext, nodeId: string): CompiledNode | null {
    return ctx.topology.nodeById.get(nodeId) ?? null;
}

function edgeOf(ctx: LintContext, edgeId: string): CompiledEdge | null {
    return ctx.topology.edgeById.get(edgeId) ?? null;
}

function sourceOf(ctx: LintContext, edge: CompiledEdge): CompiledNode | null {
    return nodeOf(ctx, edge.source);
}

function targetOf(ctx: LintContext, edge: CompiledEdge): CompiledNode | null {
    return nodeOf(ctx, edge.target);
}

function outgoingEdges(ctx: LintContext, node: CompiledNode): CompiledEdge[] {
    return node.outgoing.map((edgeId) => edgeOf(ctx, edgeId)).filter((edge): edge is CompiledEdge => edge !== null);
}

function incomingEdges(ctx: LintContext, node: CompiledNode): CompiledEdge[] {
    return node.incoming.map((edgeId) => edgeOf(ctx, edgeId)).filter((edge): edge is CompiledEdge => edge !== null);
}

function isSync(edge: CompiledEdge): boolean {
    return edge.kind === 'sync';
}

function carriesWrite(edge: CompiledEdge): boolean {
    return edge.calls.some((call) => WRITE_OPERATIONS.has(call.op) && call.share > 0);
}

function fanoutOf(edge: CompiledEdge): number {
    return edge.calls.reduce((sum, call) => sum + call.share * call.fanout, 0);
}

function payloadBytesOf(edge: CompiledEdge): number {
    return edge.calls.reduce((peak, call) => Math.max(peak, call.requestBytes, call.responseBytes), 0);
}

function groupOf(node: CompiledNode): string {
    return node.definition.group;
}

function reachableFromClients(topology: CompiledTopology): Set<string> {
    const visited = new Set<string>(topology.entryNodes);
    const queue = [...topology.entryNodes];

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

    return visited;
}

function perimeterNodeIds(topology: CompiledTopology): Set<string> {
    const perimeter = new Set<string>();
    const entries = new Set<string>(topology.entryNodes);
    const visited = new Set<string>(topology.entryNodes);
    const queue = [...topology.entryNodes];

    while (queue.length > 0) {
        const current = queue.shift() as string;
        const node = topology.nodeById.get(current);
        if (!node) continue;
        if (!entries.has(current) && node.definition.group !== 'edge') continue;

        for (const edgeId of node.outgoing) {
            const edge = topology.edgeById.get(edgeId);
            if (!edge || edge.isReplication) continue;

            perimeter.add(edge.target);
            if (visited.has(edge.target)) continue;

            visited.add(edge.target);
            queue.push(edge.target);
        }
    }

    return perimeter;
}

function buildContext(input: LintInput): LintContext {
    const { topology, result } = input;
    const reachable = reachableFromClients(topology);

    const trafficNodes = topology.nodes.filter(
        (node) => node.definition.shape === 'node' && (result.nodes[node.id]?.lambdaOffered ?? 0) > 0,
    );

    const criticalNodes = trafficNodes.filter(
        (node) => node.definition.group !== 'clients' && reachable.has(node.id),
    );

    const findingsByCode = new Map<string, Finding[]>();
    for (const finding of result.findings) {
        const bucket = findingsByCode.get(finding.code);
        if (bucket) bucket.push(finding);
        else findingsByCode.set(finding.code, [finding]);
    }

    const consumers: ConsumerLink[] = [];
    for (const edge of topology.edges) {
        if (!edge.isAsync) continue;

        const queue = topology.nodeById.get(edge.source);
        const consumer = topology.nodeById.get(edge.target);
        if (!queue || !consumer) continue;
        if (queue.definition.group !== 'messaging') continue;
        if (consumer.definition.group === 'messaging') continue;

        consumers.push({ queue, consumer, edge });
    }

    return {
        topology,
        result,
        reachable,
        perimeter: perimeterNodeIds(topology),
        trafficNodes,
        criticalNodes,
        findingsByCode,
        consumers,
    };
}

function findingsOf(ctx: LintContext, code: string): Finding[] {
    return ctx.findingsByCode.get(code) ?? [];
}

function nodeCoverage(nodes: CompiledNode[], predicate: (node: CompiledNode) => boolean): PositiveOutcome {
    if (nodes.length === 0) return NOT_APPLICABLE;

    const satisfied = nodes.filter(predicate);

    return {
        applicable: true,
        passed: satisfied.length === nodes.length,
        nodeIds: satisfied.map((node) => node.id),
        values: { checked: nodes.length, satisfied: satisfied.length },
    };
}

function edgeCoverage(edges: CompiledEdge[], predicate: (edge: CompiledEdge) => boolean): PositiveOutcome {
    if (edges.length === 0) return NOT_APPLICABLE;

    const satisfied = edges.filter(predicate);

    return {
        applicable: true,
        passed: satisfied.length === edges.length,
        edgeIds: satisfied.map((edge) => edge.id),
        values: { checked: edges.length, satisfied: satisfied.length },
    };
}

function readHeavyStores(ctx: LintContext): CompiledNode[] {
    return ctx.trafficNodes.filter((node) => {
        if (!STORE_GROUPS.has(groupOf(node))) return false;
        const nodeResult = nodeResultOf(ctx, node.id);
        return nodeResult !== null && nodeResult.readShare >= READ_HEAVY_SHARE && readRpsOf(ctx, node.id) > 0;
    });
}

function hasCacheInFront(ctx: LintContext, store: CompiledNode): boolean {
    return incomingEdges(ctx, store).some((edge) => {
        const caller = sourceOf(ctx, edge);
        if (!caller) return false;
        if (groupOf(caller) === 'cache') return true;

        return outgoingEdges(ctx, caller).some((sibling) => {
            const siblingTarget = targetOf(ctx, sibling);
            return siblingTarget !== null && groupOf(siblingTarget) === 'cache';
        });
    });
}

function clientEdgesTo(ctx: LintContext, groups: Set<string>): CompiledEdge[] {
    return ctx.topology.edges.filter((edge) => {
        const source = sourceOf(ctx, edge);
        const target = targetOf(ctx, edge);
        return source !== null && target !== null && groupOf(source) === 'clients' && groups.has(groupOf(target));
    });
}

function isBehindQueue(ctx: LintContext, node: CompiledNode): boolean {
    const incoming = incomingEdges(ctx, node).filter((edge) => !edge.isReplication);
    return incoming.length > 0 && incoming.every((edge) => edge.isAsync);
}

function slowNodes(ctx: LintContext): CompiledNode[] {
    return ctx.trafficNodes.filter(
        (node) => groupOf(node) !== 'messaging' && (nodeResultOf(ctx, node.id)?.serviceSec ?? 0) > SLOW_OPERATION_SEC,
    );
}

function slowResponseSec(ctx: LintContext, node: CompiledNode): number {
    const nodeResult = nodeResultOf(ctx, node.id);
    const measured = nodeResult ? nodeResult.serviceSec + nodeResult.waitSec : 0;
    const declaredP99Ms = numericParam(node, 'p99Ms');

    return Math.max(measured, declaredP99Ms === null ? 0 : declaredP99Ms / 1000);
}

function consumerNodes(ctx: LintContext): CompiledNode[] {
    const ids = new Set(ctx.consumers.map((link) => link.consumer.id));
    return ctx.topology.nodes.filter((node) => ids.has(node.id));
}

function linksOfConsumer(ctx: LintContext, consumerId: string): ConsumerLink[] {
    return ctx.consumers.filter((link) => link.consumer.id === consumerId);
}

function deadLetterNodesOf(ctx: LintContext, node: CompiledNode): CompiledNode[] {
    return outgoingEdges(ctx, node)
        .map((edge) => targetOf(ctx, edge))
        .filter((target): target is CompiledNode => target !== null && target.type === 'dlq');
}

function hasDeadLetter(ctx: LintContext, link: ConsumerLink): boolean {
    if (flagParam(link.queue, 'dlqEnabled') === true) return true;
    if (flagParam(link.consumer, 'dlqEnabled') === true) return true;

    return deadLetterNodesOf(ctx, link.queue).length > 0 || deadLetterNodesOf(ctx, link.consumer).length > 0;
}

function hasRetryCap(ctx: LintContext, link: ConsumerLink): boolean {
    const declared = firstNumericParam(link.consumer, RETRY_CAP_PARAMS) ?? firstNumericParam(link.queue, RETRY_CAP_PARAMS);
    if (declared !== null) return declared > 0;

    const attached = [...deadLetterNodesOf(ctx, link.queue), ...deadLetterNodesOf(ctx, link.consumer)];
    return attached.some((node) => (numericParam(node, 'maxRetries') ?? 0) > 0);
}

function isIdempotentConsumer(link: ConsumerLink): boolean {
    return link.edge.policy.idempotent || flagParam(link.consumer, 'idempotent') === true;
}

function retriedWriteEdges(ctx: LintContext): CompiledEdge[] {
    return ctx.topology.edges.filter(
        (edge) => !edge.isReplication && edge.policy.retries > 0 && carriesWrite(edge) && edgeRpsOf(ctx, edge.id) > 0,
    );
}

function perimeterNodes(ctx: LintContext): CompiledNode[] {
    return ctx.topology.nodes.filter((node) => ctx.perimeter.has(node.id));
}

function bufferLimitOf(node: CompiledNode): number | null {
    return firstNumericParam(node, BUFFER_LIMIT_PARAMS);
}

function bufferedNodes(ctx: LintContext): CompiledNode[] {
    return ctx.trafficNodes.filter((node) => BUFFERED_GROUPS.has(groupOf(node)) && bufferLimitOf(node) !== null);
}

function externalNodes(ctx: LintContext): CompiledNode[] {
    return ctx.trafficNodes.filter((node) => node.type === 'external-api');
}

function isGuardedExternal(ctx: LintContext, node: CompiledNode): boolean {
    const calls = incomingEdges(ctx, node).filter((edge) => isSync(edge));
    if (calls.length === 0) return false;

    const declaredBreaker = flagParam(node, 'circuitBreaker') === true;

    return calls.every((edge) => (edge.policy.circuitBreaker || declaredBreaker) && edge.policy.timeoutMs > 0);
}

function keyedStores(ctx: LintContext): CompiledNode[] {
    return ctx.trafficNodes.filter(
        (node) => STORE_GROUPS.has(groupOf(node)) && firstTextParam(node, SHARD_KEY_PARAMS) !== null,
    );
}

function isWellPartitioned(node: CompiledNode): boolean {
    const key = firstTextParam(node, SHARD_KEY_PARAMS);
    if (key === null || key.trim() === '') return false;

    return (firstNumericParam(node, HOT_SHARE_PARAMS) ?? 0) <= HOT_PARTITION_SHARE;
}

function logNodes(ctx: LintContext): CompiledNode[] {
    return ctx.topology.nodes.filter((node) => numericParam(node, 'samplingRate') !== null);
}

function degradableNodes(ctx: LintContext): CompiledNode[] {
    return ctx.trafficNodes.filter((node) => groupOf(node) === 'cache' || node.type === 'cdn');
}

function hasStaleFallback(ctx: LintContext): boolean {
    const staleCdn = ctx.trafficNodes.some(
        (node) => node.type === 'cdn' && (numericParam(node, 'staleWhileRevalidateSec') ?? 0) > 0,
    );
    if (staleCdn) return true;

    return ctx.topology.nodes.some((node) => {
        const calls = outgoingEdges(ctx, node);
        const usesCache = calls.some((edge) => {
            const target = targetOf(ctx, edge);
            return target !== null && groupOf(target) === 'cache';
        });

        const guardedStore = calls.some((edge) => {
            const target = targetOf(ctx, edge);
            return target !== null && STORE_GROUPS.has(groupOf(target)) && edge.policy.circuitBreaker;
        });

        return usesCache && guardedStore;
    });
}

function replicaReadShareOf(node: CompiledNode): number {
    const explicit = numericParam(node, 'readFromReplica');
    if (explicit !== null) return explicit;

    const preference = textParam(node, 'readPreference');
    if (preference !== null) return preference === 'primary' ? 0 : 1;

    return 0;
}

function replicatedStores(ctx: LintContext): CompiledNode[] {
    return ctx.trafficNodes.filter((node) => {
        if (!STATEFUL_GROUPS.has(groupOf(node))) return false;
        if (numericParam(node, 'replicaLagMs') === null) return false;

        return readRpsOf(ctx, node.id) > 0 && writeRpsOf(ctx, node.id) > 0;
    });
}

function servesReadYourWrites(node: CompiledNode): boolean {
    if ((numericParam(node, 'replicaLagMs') ?? 0) <= 0) return true;
    if (replicaReadShareOf(node) <= 0) return true;

    return textParam(node, 'consistencyModel') === 'linearizable' && textParam(node, 'replicationMode') === 'sync';
}

function multiRegionPolicyMode(ctx: LintContext): string {
    const policy = ctx.topology.multiRegionPolicy;
    return policy === null ? 'single' : textParam(policy, 'mode') ?? 'single';
}

function residencyOfRegion(ctx: LintContext, regionId: string | null): string {
    if (regionId === null) return 'none';

    const region = nodeOf(ctx, regionId);
    return region === null ? 'none' : textParam(region, 'dataResidency') ?? 'none';
}

function policyResidencyIsStrict(ctx: LintContext): boolean {
    const policy = ctx.topology.multiRegionPolicy;
    return policy !== null && textParam(policy, 'dataResidency') === 'strict';
}

function residencyIsDeclared(ctx: LintContext): boolean {
    if (policyResidencyIsStrict(ctx)) return true;

    return ctx.topology.regions.some((region) => (textParam(region, 'dataResidency') ?? 'none') !== 'none');
}

function geoOfRegion(ctx: LintContext, regionId: string | null): string | null {
    if (regionId === null) return null;

    const region = nodeOf(ctx, regionId);
    return region === null ? null : textParam(region, 'geo');
}

function landsDataInTargetRegion(edge: CompiledEdge): boolean {
    return edge.isReplication || carriesWrite(edge);
}

function leavesResidencyZone(ctx: LintContext, edge: CompiledEdge): boolean {
    const source = sourceOf(ctx, edge);
    const target = targetOf(ctx, edge);
    if (!source || !target) return false;

    const residency = residencyOfRegion(ctx, source.regionId);
    if (residency === 'local-only') return true;

    const sourceGeo = geoOfRegion(ctx, source.regionId);
    const targetGeo = geoOfRegion(ctx, target.regionId);

    if (residency === 'gdpr' && targetGeo !== GDPR_GEO) return true;

    return policyResidencyIsStrict(ctx) && targetGeo !== sourceGeo;
}

function residencyViolations(ctx: LintContext): CompiledEdge[] {
    if (!residencyIsDeclared(ctx)) return [];

    return ctx.topology.edges.filter(
        (edge) =>
            edge.scope === 'cross-region' &&
            landsDataInTargetRegion(edge) &&
            edgeRpsOf(ctx, edge.id) > 0 &&
            leavesResidencyZone(ctx, edge),
    );
}

function dnsNodes(ctx: LintContext): CompiledNode[] {
    return ctx.topology.nodes.filter((node) => node.type === 'dns');
}

function rtoTargetSec(ctx: LintContext): number {
    return ctx.result.multiRegion?.rtoTargetSec ?? 0;
}

function staleDnsNodes(ctx: LintContext): CompiledNode[] {
    const target = rtoTargetSec(ctx);
    if (target <= 0) return [];

    return dnsNodes(ctx).filter((node) => (numericParam(node, 'ttlSec') ?? 0) > target);
}

function azRedundancyOf(node: CompiledNode): boolean | null {
    const spread = numericParam(node, 'azSpread');
    if (spread !== null) return spread >= 2;

    return flagParam(node, 'multiAz');
}

function azAwareNodes(ctx: LintContext): CompiledNode[] {
    return ctx.criticalNodes.filter((node) => node.azId !== null || azRedundancyOf(node) !== null);
}

function spansMultipleAz(ctx: LintContext): boolean {
    const zones = new Set(
        ctx.criticalNodes.map((node) => node.azId).filter((azId): azId is string => azId !== null),
    );
    if (zones.size >= 2) return true;

    const declared = ctx.criticalNodes.filter((node) => azRedundancyOf(node) !== null);

    return declared.length > 0 && declared.every((node) => azRedundancyOf(node) === true);
}

function hasSpofOnCriticalPath(ctx: LintContext): boolean {
    return spofNodeIds(ctx).length > 0;
}

function spofNodeIds(ctx: LintContext): string[] {
    const flagged = new Set<string>();

    for (const finding of findingsOf(ctx, 'spof')) {
        for (const nodeId of finding.nodeIds) {
            if (ctx.reachable.has(nodeId) && offeredRps(ctx, nodeId) > 0) flagged.add(nodeId);
        }
    }

    return ctx.topology.nodes.filter((node) => flagged.has(node.id)).map((node) => node.id);
}

function regionSpareRps(ctx: LintContext, regionId: string): number {
    const members = ctx.topology.nodes.filter(
        (node) => node.regionId === regionId && node.definition.shape === 'node' && CAPACITY_GROUPS.has(groupOf(node)),
    );
    if (members.length === 0) return 0;

    const spares = members
        .map((node) => nodeResultOf(ctx, node.id))
        .filter((nodeResult): nodeResult is NodeResult => nodeResult !== null && Number.isFinite(nodeResult.capacity))
        .map((nodeResult) => Math.max(0, nodeResult.capacity - nodeResult.lambdaOffered));

    return spares.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...spares);
}

interface RegionShortfall {
    regionId: string;
    code: string;
    needRps: number;
    spareRps: number;
}

function regionShortfalls(ctx: LintContext): RegionShortfall[] {
    const multiRegion = ctx.result.multiRegion;
    if (!multiRegion || multiRegion.mode === 'single' || multiRegion.regions.length < 2) return [];

    const shortfalls: RegionShortfall[] = [];

    for (const region of multiRegion.regions) {
        const spareRps = multiRegion.regions
            .filter((other) => other.nodeId !== region.nodeId)
            .reduce((sum, other) => sum + regionSpareRps(ctx, other.nodeId), 0);

        if (region.rps > spareRps) {
            shortfalls.push({ regionId: region.nodeId, code: region.code, needRps: region.rps, spareRps });
        }
    }

    return shortfalls;
}

function syncChainDepth(ctx: LintContext, entryId: string): number {
    const active = new Set<string>();
    let deepest = 0;

    const walk = (nodeId: string, depth: number): void => {
        if (active.has(nodeId) || depth > MAX_SYNC_WALK) return;

        active.add(nodeId);
        deepest = Math.max(deepest, depth);

        const node = nodeOf(ctx, nodeId);
        if (node) {
            for (const edge of outgoingEdges(ctx, node)) {
                if (!isSync(edge)) continue;
                walk(edge.target, depth + 1);
            }
        }

        active.delete(nodeId);
    };

    walk(entryId, 0);

    return deepest;
}

function durableCopiesOf(node: CompiledNode): number | null {
    const replicationFactor = numericParam(node, 'replicationFactor');
    if (replicationFactor !== null) return replicationFactor;

    const replicaSetSize = numericParam(node, 'replicaSetSize');
    if (replicaSetSize !== null) return replicaSetSize;

    const readReplicas = numericParam(node, 'readReplicas');
    if (readReplicas !== null) return 1 + readReplicas + (flagParam(node, 'multiAz') === true ? 1 : 0);

    const replicas = numericParam(node, 'replicas');
    if (replicas !== null) return groupOf(node) === 'olap' ? replicas : 1 + replicas;

    return null;
}

function hasDurableBacking(ctx: LintContext, cache: CompiledNode): boolean {
    const direct = outgoingEdges(ctx, cache).some((edge) => {
        const target = targetOf(ctx, edge);
        return target !== null && DURABLE_GROUPS.has(groupOf(target));
    });
    if (direct) return true;

    return incomingEdges(ctx, cache).some((edge) => {
        const writer = sourceOf(ctx, edge);
        if (!writer) return false;

        return outgoingEdges(ctx, writer).some((sibling) => {
            const target = targetOf(ctx, sibling);
            return target !== null && DURABLE_GROUPS.has(groupOf(target));
        });
    });
}

function totalCostOfGroup(ctx: LintContext, group: string): number {
    return ctx.topology.nodes
        .filter((node) => groupOf(node) === group)
        .reduce((sum, node) => sum + (nodeResultOf(ctx, node.id)?.cost.total ?? 0), 0);
}

const positiveRules: PositiveRule[] = [
    {
        rule: 'async-for-slow-work',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => nodeCoverage(slowNodes(ctx), (node) => isBehindQueue(ctx, node)),
    },
    {
        rule: 'auth-at-edge',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            if (ctx.topology.entryNodes.length === 0) return NOT_APPLICABLE;

            const authNodes = ctx.topology.nodes.filter((node) => node.type === 'auth');
            const gateways = perimeterNodes(ctx).filter((node) => textParam(node, 'authMode') !== null);
            if (authNodes.length === 0 && gateways.length === 0) return NOT_APPLICABLE;

            const verifying = gateways.filter((node) => textParam(node, 'authMode') !== 'none');
            const atEdge = authNodes.filter((node) => ctx.perimeter.has(node.id));

            return {
                applicable: true,
                passed: verifying.length > 0 || atEdge.length > 0,
                nodeIds: [...verifying, ...atEdge].map((node) => node.id),
                values: { gateways: verifying.length, authServices: atEdge.length },
            };
        },
    },
    {
        rule: 'backpressure',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => nodeCoverage(bufferedNodes(ctx), (node) => (bufferLimitOf(node) ?? 0) > 0),
    },
    {
        rule: 'cache-before-hot-db',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => nodeCoverage(readHeavyStores(ctx), (node) => hasCacheInFront(ctx, node)),
    },
    {
        rule: 'cdn-for-static',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            const origins = ctx.trafficNodes.filter((node) => groupOf(node) === 'storage');
            const delivery = ctx.trafficNodes.filter((node) => node.type === 'cdn');
            if (origins.length === 0 && delivery.length === 0) return NOT_APPLICABLE;

            const bypass = clientEdgesTo(ctx, new Set(['storage']));

            return {
                applicable: true,
                passed: delivery.length > 0 && bypass.length === 0,
                nodeIds: delivery.map((node) => node.id),
                edgeIds: bypass.map((edge) => edge.id),
                values: { cdnNodes: delivery.length, originNodes: origins.length, directEdges: bypass.length },
            };
        },
    },
    {
        rule: 'circuit-breaker-external',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => nodeCoverage(externalNodes(ctx), (node) => isGuardedExternal(ctx, node)),
    },
    {
        rule: 'conflict-strategy-declared',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            const policy = ctx.topology.multiRegionPolicy;
            if (policy === null || multiRegionPolicyMode(ctx) !== 'active-active') return NOT_APPLICABLE;

            const strategy = textParam(policy, 'conflictResolution') ?? 'lww';

            return {
                applicable: true,
                passed: strategy !== 'lww',
                nodeIds: [policy.id],
                values: { conflictResolution: strategy },
            };
        },
    },
    {
        rule: 'dlq-present',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) =>
            nodeCoverage(consumerNodes(ctx), (node) =>
                linksOfConsumer(ctx, node.id).every((link) => hasDeadLetter(ctx, link) && hasRetryCap(ctx, link)),
            ),
    },
    {
        rule: 'dns-ttl-matches-rto',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            const resolvers = dnsNodes(ctx);
            const target = rtoTargetSec(ctx);
            if (resolvers.length === 0 || target <= 0) return NOT_APPLICABLE;

            const aligned = resolvers.filter((node) => (numericParam(node, 'ttlSec') ?? 0) <= target);

            return {
                applicable: true,
                passed: aligned.length === resolvers.length,
                nodeIds: aligned.map((node) => node.id),
                values: {
                    rtoTargetSec: target,
                    maxTtlSec: Math.max(...resolvers.map((node) => numericParam(node, 'ttlSec') ?? 0)),
                },
            };
        },
    },
    {
        rule: 'graceful-degradation',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            const candidates = degradableNodes(ctx);
            if (candidates.length === 0) return NOT_APPLICABLE;

            return {
                applicable: true,
                passed: hasStaleFallback(ctx),
                nodeIds: candidates.map((node) => node.id),
                values: { degradableNodes: candidates.length },
            };
        },
    },
    {
        rule: 'idempotency-on-at-least-once',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) =>
            nodeCoverage(consumerNodes(ctx), (node) => linksOfConsumer(ctx, node.id).every(isIdempotentConsumer)),
    },
    {
        rule: 'idempotent-writes',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => edgeCoverage(retriedWriteEdges(ctx), (edge) => edge.policy.idempotent),
    },
    {
        rule: 'multi-az',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            const zoned = azAwareNodes(ctx);
            if (zoned.length === 0) return NOT_APPLICABLE;

            const zones = new Set(zoned.map((node) => node.azId).filter((azId): azId is string => azId !== null));

            return {
                applicable: true,
                passed: spansMultipleAz(ctx),
                nodeIds: zoned.map((node) => node.id),
                values: { zones: zones.size, criticalNodes: ctx.criticalNodes.length },
            };
        },
    },
    {
        rule: 'multi-az-and-region',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            const multiRegion = ctx.result.multiRegion;
            if (!multiRegion || multiRegion.regions.length < 2) return NOT_APPLICABLE;

            const shortfalls = regionShortfalls(ctx);
            const survivesAz = spansMultipleAz(ctx) && !hasSpofOnCriticalPath(ctx);
            const survivesRegion = multiRegion.mode !== 'single' && shortfalls.length === 0;

            return {
                applicable: true,
                passed: survivesAz && survivesRegion,
                nodeIds: ctx.topology.regions.map((region) => region.id),
                values: {
                    regions: multiRegion.regions.length,
                    mode: multiRegion.mode,
                    regionsWithoutCapacity: shortfalls.length,
                },
            };
        },
    },
    {
        rule: 'observability-sampled',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => nodeCoverage(logNodes(ctx), (node) => (numericParam(node, 'samplingRate') ?? 1) < FULL_SAMPLING),
    },
    {
        rule: 'partitioned-by-key',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => nodeCoverage(keyedStores(ctx), isWellPartitioned),
    },
    {
        rule: 'rate-limit-at-edge',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            if (ctx.topology.entryNodes.length === 0) return NOT_APPLICABLE;

            const limited = perimeterNodes(ctx).filter((node) => (numericParam(node, 'rateLimitRpsPerClient') ?? 0) > 0);

            return {
                applicable: true,
                passed: limited.length > 0,
                nodeIds: limited.map((node) => node.id),
                values: { limitedNodes: limited.length },
            };
        },
    },
    {
        rule: 'read-replicas',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            const relational = readHeavyStores(ctx).filter((node) => groupOf(node) === 'sql');

            return nodeCoverage(
                relational,
                (node) => (numericParam(node, 'readReplicas') ?? 0) >= 1 && replicaReadShareOf(node) > 0,
            );
        },
    },
    {
        rule: 'residency-respected',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => {
            if (!residencyIsDeclared(ctx)) return NOT_APPLICABLE;

            const violations = residencyViolations(ctx);

            return {
                applicable: true,
                passed: violations.length === 0,
                nodeIds: ctx.topology.regions.map((region) => region.id),
                edgeIds: violations.map((edge) => edge.id),
                values: { crossRegionExports: violations.length },
            };
        },
    },
    {
        rule: 'ryw-where-it-matters',
        weight: POSITIVE_WEIGHT,
        evaluate: (ctx) => nodeCoverage(replicatedStores(ctx), servesReadYourWrites),
    },
];

const antipatternRules: AntipatternRule[] = [
    {
        rule: 'at-least-once-not-idempotent',
        weight: 12,
        detect: (ctx) => {
            const exposed = ctx.consumers.filter(
                (link) => edgeRpsOf(ctx, link.edge.id) > 0 && !isIdempotentConsumer(link),
            );
            if (exposed.length === 0) return null;

            const duplicates = findingsOf(ctx, 'anomaly-duplicate-processing');

            return {
                nodeIds: exposed.map((link) => link.consumer.id),
                edgeIds: exposed.map((link) => link.edge.id),
                values: { consumers: exposed.length, duplicateFindings: duplicates.length },
            };
        },
    },
    {
        rule: 'blob-in-sql',
        weight: 12,
        detect: (ctx) => {
            const offenders = ctx.trafficNodes.filter((node) => {
                if (groupOf(node) !== 'sql') return false;
                if ((numericParam(node, 'rowSizeBytes') ?? 0) >= BLOB_BYTES) return true;

                return incomingEdges(ctx, node).some((edge) => payloadBytesOf(edge) >= BLOB_BYTES);
            });
            if (offenders.length === 0) return null;

            const biggestRow = Math.max(...offenders.map((node) => numericParam(node, 'rowSizeBytes') ?? 0));

            return {
                nodeIds: offenders.map((node) => node.id),
                values: { rowSizeBytes: biggestRow, thresholdBytes: BLOB_BYTES },
            };
        },
    },
    {
        rule: 'cache-no-ttl-no-eviction',
        weight: 8,
        detect: (ctx) => {
            const offenders = ctx.trafficNodes.filter((node) => {
                if (groupOf(node) !== 'cache') return false;
                if ((numericParam(node, 'ttlSec') ?? 0) > 0) return false;

                const eviction = textParam(node, 'evictionPolicy');
                return eviction === null || eviction === 'noeviction';
            });
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((node) => node.id),
                values: { caches: offenders.length },
            };
        },
    },
    {
        rule: 'chatty-fanout',
        weight: 8,
        detect: (ctx) => {
            const offenders = ctx.trafficNodes
                .map((node) => ({
                    node,
                    fanout: outgoingEdges(ctx, node)
                        .filter((edge) => isSync(edge))
                        .reduce((sum, edge) => sum + fanoutOf(edge), 0),
                }))
                .filter((item) => item.fanout > CHATTY_FANOUT);
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((item) => item.node.id),
                values: {
                    fanout: Math.max(...offenders.map((item) => item.fanout)),
                    threshold: CHATTY_FANOUT,
                },
            };
        },
    },
    {
        rule: 'client-to-db-direct',
        weight: 15,
        detect: (ctx) => {
            const offenders = clientEdgesTo(ctx, STATEFUL_GROUPS);
            if (offenders.length === 0) return null;

            const endpoints = new Set<string>();
            for (const edge of offenders) {
                endpoints.add(edge.source);
                endpoints.add(edge.target);
            }

            return {
                nodeIds: ctx.topology.nodes.filter((node) => endpoints.has(node.id)).map((node) => node.id),
                edgeIds: offenders.map((edge) => edge.id),
                values: { edges: offenders.length },
            };
        },
    },
    {
        rule: 'cross-region-sync-write',
        weight: 8,
        detect: (ctx) => {
            const offenders = ctx.topology.edges.filter(
                (edge) =>
                    edge.scope === 'cross-region' &&
                    isSync(edge) &&
                    carriesWrite(edge) &&
                    edgeRpsOf(ctx, edge.id) > 0,
            );
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((edge) => edge.target),
                edgeIds: offenders.map((edge) => edge.id),
                values: {
                    edges: offenders.length,
                    rttMs: Math.max(...offenders.map((edge) => edge.networkMs)),
                },
            };
        },
    },
    {
        rule: 'deep-sync-chain',
        weight: 8,
        detect: (ctx) => {
            const chains = ctx.topology.entryNodes
                .map((entryId) => ({ entryId, depth: syncChainDepth(ctx, entryId) }))
                .filter((chain) => chain.depth > DEEP_SYNC_HOPS);
            if (chains.length === 0) return null;

            return {
                nodeIds: chains.map((chain) => chain.entryId),
                values: {
                    depth: Math.max(...chains.map((chain) => chain.depth)),
                    threshold: DEEP_SYNC_HOPS,
                },
            };
        },
    },
    {
        rule: 'dns-ttl-vs-rto',
        weight: 8,
        detect: (ctx) => {
            const offenders = staleDnsNodes(ctx);
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((node) => node.id),
                values: {
                    ttlSec: Math.max(...offenders.map((node) => numericParam(node, 'ttlSec') ?? 0)),
                    rtoTargetSec: rtoTargetSec(ctx),
                },
            };
        },
    },
    {
        rule: 'hot-partition',
        weight: 10,
        detect: (ctx) => {
            const declared = ctx.trafficNodes.filter(
                (node) => (firstNumericParam(node, HOT_SHARE_PARAMS) ?? 0) > HOT_PARTITION_SHARE,
            );
            const observed = findingsOf(ctx, 'hot-key').flatMap((finding) => finding.nodeIds);
            const flagged = new Set([...declared.map((node) => node.id), ...observed]);
            if (flagged.size === 0) return null;

            const shares = ctx.topology.nodes
                .filter((node) => flagged.has(node.id))
                .map((node) => firstNumericParam(node, HOT_SHARE_PARAMS) ?? 0);

            return {
                nodeIds: ctx.topology.nodes.filter((node) => flagged.has(node.id)).map((node) => node.id),
                values: {
                    hotShare: shares.length === 0 ? 0 : Math.max(...shares),
                    threshold: HOT_PARTITION_SHARE,
                    hotKeyFindings: observed.length,
                },
            };
        },
    },
    {
        rule: 'log-everything',
        weight: 6,
        detect: (ctx) => {
            const sinks = logNodes(ctx).filter((node) => (numericParam(node, 'samplingRate') ?? 1) >= FULL_SAMPLING);
            if (sinks.length === 0) return null;

            const logsCost = sinks.reduce((sum, node) => sum + (nodeResultOf(ctx, node.id)?.cost.total ?? 0), 0);
            const computeCost = totalCostOfGroup(ctx, 'compute');
            if (logsCost <= computeCost) return null;

            return {
                nodeIds: sinks.map((node) => node.id),
                values: { logsCostMonth: logsCost, computeCostMonth: computeCost },
            };
        },
    },
    {
        rule: 'n-plus-one',
        weight: 6,
        detect: (ctx) => {
            const offenders = ctx.topology.edges.filter((edge) => {
                const target = targetOf(ctx, edge);
                if (target === null || !STORE_GROUPS.has(groupOf(target))) return false;

                return fanoutOf(edge) > N_PLUS_ONE_FANOUT;
            });
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((edge) => edge.target),
                edgeIds: offenders.map((edge) => edge.id),
                values: {
                    fanout: Math.max(...offenders.map(fanoutOf)),
                    threshold: N_PLUS_ONE_FANOUT,
                },
            };
        },
    },
    {
        rule: 'no-timeout',
        weight: 10,
        detect: (ctx) => {
            const offenders = ctx.topology.edges.filter(
                (edge) => !edge.isReplication && edge.policy.timeoutMs <= 0 && edgeRpsOf(ctx, edge.id) > 0,
            );
            if (offenders.length === 0) return null;

            return {
                edgeIds: offenders.map((edge) => edge.id),
                nodeIds: offenders.map((edge) => edge.target),
                values: { edges: offenders.length },
            };
        },
    },
    {
        rule: 'orphan-node',
        weight: 3,
        detect: (ctx) => {
            const offenders = ctx.topology.nodes.filter(
                (node) => node.definition.shape === 'node' && offeredRps(ctx, node.id) <= 0,
            );
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((node) => node.id),
                values: { nodes: offenders.length },
            };
        },
    },
    {
        rule: 'over-provisioned',
        weight: 5,
        detect: (ctx) => {
            const provisioned = ctx.criticalNodes.filter((node) => !node.definition.managed);
            if (provisioned.length === 0) return null;

            const utilizations = provisioned.map((node) => utilizationOf(ctx, node.id));
            const peak = Math.max(...utilizations);
            if (peak >= OVER_PROVISIONED_UTILIZATION) return null;

            return {
                nodeIds: provisioned.map((node) => node.id),
                values: { maxUtilization: peak, threshold: OVER_PROVISIONED_UTILIZATION },
            };
        },
    },
    {
        rule: 'read-replica-for-ryw',
        weight: 10,
        detect: (ctx) => {
            const offenders = replicatedStores(ctx).filter((node) => !servesReadYourWrites(node));
            if (offenders.length === 0) return null;

            const anomalies = findingsOf(ctx, 'anomaly-read-your-writes');

            return {
                nodeIds: offenders.map((node) => node.id),
                values: {
                    stores: offenders.length,
                    replicaReadShare: Math.max(...offenders.map(replicaReadShareOf)),
                    anomalies: anomalies.length,
                },
            };
        },
    },
    {
        rule: 'region-without-capacity',
        weight: 10,
        detect: (ctx) => {
            const shortfalls = regionShortfalls(ctx);
            if (shortfalls.length === 0) return null;

            const worst = shortfalls.reduce((peak, item) =>
                item.needRps - item.spareRps > peak.needRps - peak.spareRps ? item : peak,
            );

            return {
                nodeIds: shortfalls.map((item) => item.regionId),
                values: {
                    region: worst.code,
                    needRps: worst.needRps,
                    spareRps: worst.spareRps,
                    regions: shortfalls.length,
                },
            };
        },
    },
    {
        rule: 'residency-violation',
        weight: 15,
        detect: (ctx) => {
            const offenders = residencyViolations(ctx);
            if (offenders.length === 0) return null;

            const regionIds = new Set<string>();
            for (const edge of offenders) {
                const source = sourceOf(ctx, edge);
                if (source?.regionId) regionIds.add(source.regionId);
            }

            return {
                nodeIds: ctx.topology.regions.filter((region) => regionIds.has(region.id)).map((region) => region.id),
                edgeIds: offenders.map((edge) => edge.id),
                values: { edges: offenders.length, strictPolicy: policyResidencyIsStrict(ctx) ? 1 : 0 },
            };
        },
    },
    {
        rule: 'retry-without-budget',
        weight: 10,
        detect: (ctx) => {
            const offenders = ctx.topology.edges.filter(
                (edge) =>
                    !edge.isReplication &&
                    edge.policy.retries > 0 &&
                    !edge.policy.circuitBreaker &&
                    edgeRpsOf(ctx, edge.id) > 0,
            );
            if (offenders.length === 0) return null;

            return {
                edgeIds: offenders.map((edge) => edge.id),
                nodeIds: offenders.map((edge) => edge.target),
                values: {
                    edges: offenders.length,
                    retries: Math.max(...offenders.map((edge) => edge.policy.retries)),
                },
            };
        },
    },
    {
        rule: 'rf1-on-durable-data',
        weight: 12,
        detect: (ctx) => {
            const offenders = ctx.trafficNodes.filter((node) => {
                if (!DURABLE_GROUPS.has(groupOf(node)) && groupOf(node) !== 'messaging') return false;

                const copies = durableCopiesOf(node);
                return copies !== null && copies <= 1;
            });
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((node) => node.id),
                values: { stores: offenders.length },
            };
        },
    },
    {
        rule: 'rmw-without-cas',
        weight: 12,
        detect: (ctx) => {
            const contended = new Set(findingsOf(ctx, 'anomaly-lost-update').flatMap((finding) => finding.nodeIds));
            const anomaliesEvaluated = ctx.result.consistency.mode === 'anomalies';

            const offenders = ctx.trafficNodes.filter(
                (node) =>
                    STATEFUL_GROUPS.has(groupOf(node)) &&
                    textParam(node, 'concurrencyControl') === 'none' &&
                    writeRpsOf(ctx, node.id) > 0 &&
                    (!anomaliesEvaluated || contended.has(node.id)),
            );
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((node) => node.id),
                values: { stores: offenders.length, lostUpdateFindings: contended.size },
            };
        },
    },
    {
        rule: 'silent-lww',
        weight: 14,
        detect: (ctx) => {
            const policy = ctx.topology.multiRegionPolicy;
            if (policy === null || multiRegionPolicyMode(ctx) !== 'active-active') return null;
            if (textParam(policy, 'conflictResolution') !== 'lww') return null;

            const lostWrites = findingsOf(ctx, 'anomaly-lost-write-lww');

            return {
                nodeIds: [policy.id, ...lostWrites.flatMap((finding) => finding.nodeIds)],
                values: { mode: 'active-active', conflictResolution: 'lww', findings: lostWrites.length },
            };
        },
    },
    {
        rule: 'spof-on-critical-path',
        weight: 15,
        detect: (ctx) => {
            const offenders = spofNodeIds(ctx);
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders,
                values: { nodes: offenders.length },
            };
        },
    },
    {
        rule: 'sync-call-to-slow-op',
        weight: 12,
        detect: (ctx) => {
            const offenders = ctx.topology.edges.filter((edge) => {
                if (!isSync(edge) || edgeRpsOf(ctx, edge.id) <= 0) return false;

                const target = targetOf(ctx, edge);
                return target !== null && slowResponseSec(ctx, target) > SLOW_OPERATION_SEC;
            });
            if (offenders.length === 0) return null;

            const slowest = offenders
                .map((edge) => targetOf(ctx, edge))
                .filter((target): target is CompiledNode => target !== null)
                .reduce((peak, target) => Math.max(peak, slowResponseSec(ctx, target)), 0);

            return {
                nodeIds: offenders.map((edge) => edge.target),
                edgeIds: offenders.map((edge) => edge.id),
                values: { responseSec: slowest, thresholdSec: SLOW_OPERATION_SEC },
            };
        },
    },
    {
        rule: 'unbounded-queue',
        weight: 8,
        detect: (ctx) => {
            const offenders = ctx.trafficNodes.filter((node) => {
                if (!BUFFERED_GROUPS.has(groupOf(node))) return false;

                const limit = bufferLimitOf(node);
                return limit !== null && limit <= 0;
            });
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((node) => node.id),
                values: { nodes: offenders.length },
            };
        },
    },
    {
        rule: 'write-through-no-persistence',
        weight: 8,
        detect: (ctx) => {
            const offenders = ctx.trafficNodes.filter((node) => {
                if (groupOf(node) !== 'cache') return false;
                if (writeRpsOf(ctx, node.id) <= 0) return false;
                if ((textParam(node, 'persistence') ?? 'none') !== 'none') return false;

                return !hasDurableBacking(ctx, node);
            });
            if (offenders.length === 0) return null;

            return {
                nodeIds: offenders.map((node) => node.id),
                values: { caches: offenders.length },
            };
        },
    },
];

function byRule(left: LintHit, right: LintHit): number {
    if (left.rule < right.rule) return -1;
    if (left.rule > right.rule) return 1;

    return 0;
}

export function lintArchitecture(input: LintInput): LintResult {
    const ctx = buildContext(input);

    const positives: LintHit[] = [];
    let applicableWeight = 0;
    let passedWeight = 0;

    for (const rule of positiveRules) {
        const outcome = rule.evaluate(ctx);
        if (!outcome.applicable) continue;

        applicableWeight += rule.weight;
        if (!outcome.passed) continue;

        passedWeight += rule.weight;
        positives.push({
            rule: rule.rule,
            kind: 'positive',
            weight: rule.weight,
            nodeIds: outcome.nodeIds ?? [],
            edgeIds: outcome.edgeIds ?? [],
            values: outcome.values ?? {},
        });
    }

    const antipatterns: LintHit[] = [];
    let penalty = 0;

    for (const rule of antipatternRules) {
        const detection = rule.detect(ctx);
        if (detection === null) continue;

        penalty += rule.weight;
        antipatterns.push({
            rule: rule.rule,
            kind: 'antipattern',
            weight: rule.weight,
            nodeIds: detection.nodeIds ?? [],
            edgeIds: detection.edgeIds ?? [],
            values: detection.values ?? {},
        });
    }

    return {
        positives: positives.sort(byRule),
        antipatterns: antipatterns.sort(byRule),
        practiceScore: applicableWeight === 0 ? MAX_SCORE : (passedWeight / applicableWeight) * MAX_SCORE,
        penalty,
    };
}
