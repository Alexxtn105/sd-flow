import type { ComponentParams, ParamValue } from '../types/component';
import type { CallOperation } from '../types/scheme';
import { GEO_ZONES, geoRttMs, SECONDS_PER_DAY } from './constants';
import type { CompiledNode, CompiledTopology } from './compile';

export const READ_OPERATIONS: CallOperation[] = ['read', 'scan', 'consume'];

export const GLOBAL_GEO = 'global';

export interface Flow {
    id: string;
    entryNodeId: string;
    rps: number;
    readShare: number;
    requestBytes: number;
    responseBytes: number;
    geo: string;
    geoSpread: number;
}

export function zoneShares(geo: string, spread: number): Map<string, number> {
    const shares = new Map<string, number>();

    if (geo === GLOBAL_GEO || !GEO_ZONES.includes(geo as (typeof GEO_ZONES)[number])) {
        for (const zone of GEO_ZONES) shares.set(zone, 1 / GEO_ZONES.length);

        return shares;
    }

    const remote = Math.min(Math.max(spread, 0), 1);
    shares.set(geo, 1 - remote);

    if (remote <= 0) return shares;

    const others = GEO_ZONES.filter((zone) => zone !== geo);
    const proximity = others.map((zone) => 1 / geoRttMs(geo, zone));
    const total = proximity.reduce((sum, value) => sum + value, 0);

    others.forEach((zone, index) => shares.set(zone, (remote * proximity[index]) / total));

    return shares;
}

export function isReadOperation(operation: CallOperation): boolean {
    return READ_OPERATIONS.includes(operation);
}

function numeric(value: ParamValue | undefined, fallback = 0): number {
    return Number(value ?? fallback);
}

function ratePerInterval(count: number, intervalSec: number): number {
    return intervalSec > 0 ? count / intervalSec : 0;
}

function sessionRps(params: ComponentParams): number {
    const dau = numeric(params.dau);
    const sessions = numeric(params.sessionsPerUserDay);
    const requests = numeric(params.requestsPerSession);

    return (dau * sessions * requests) / SECONDS_PER_DAY;
}

const RPS_BY_CLIENT_TYPE = new Map<string, (params: ComponentParams) => number>([
    ['client-iot', (params) => ratePerInterval(numeric(params.deviceCount), numeric(params.reportIntervalSec))],
    ['client-api', (params) => numeric(params.clients) * numeric(params.rpsPerClient)],
    ['client-bot', (params) => numeric(params.rps)],
    ['client-loadtest', (params) => numeric(params.targetRps)],
    ['client-internal', (params) => numeric(params.rps)],
]);

export function clientRpsOf(type: string, params: ComponentParams): number {
    const formula = RPS_BY_CLIENT_TYPE.get(type);

    return formula ? formula(params) : sessionRps(params);
}

export function dauForRps(params: ComponentParams, rps: number): number | null {
    const sessions = numeric(params.sessionsPerUserDay);
    const requests = numeric(params.requestsPerSession);

    if (sessions <= 0 || requests <= 0 || rps < 0) return null;

    return (rps * SECONDS_PER_DAY) / (sessions * requests);
}

function clientRps(node: CompiledNode): number {
    return clientRpsOf(node.type, node.params);
}

function clientRequestBytes(params: ComponentParams): number {
    const payloadBytes = numeric(params.payloadBytes);
    if (payloadBytes > 0) return payloadBytes * Math.max(numeric(params.batchSize, 1), 1);

    return numeric(params.avgRequestKb, 1) * 1000;
}

function clientResponseBytes(params: ComponentParams): number {
    return numeric(params.avgResponseKb, 10) * 1000;
}

export function deriveFlows(topology: CompiledTopology, trafficMultiplier: number): Flow[] {
    return topology.entryNodes
        .map((nodeId) => topology.nodeById.get(nodeId))
        .filter((node): node is CompiledNode => Boolean(node))
        .map((node) => ({
            id: node.id,
            entryNodeId: node.id,
            rps: clientRps(node) * trafficMultiplier,
            readShare: numeric(node.params.readWriteMix, 0.8),
            requestBytes: clientRequestBytes(node.params),
            responseBytes: clientResponseBytes(node.params),
            geo: String(node.params.geoDistribution ?? GLOBAL_GEO),
            geoSpread: numeric(node.params.geoSpread),
        }))
        .filter((flow) => flow.rps > 0);
}

export function peakMultiplier(topology: CompiledTopology): number {
    const factors = topology.entryNodes
        .map((nodeId) => topology.nodeById.get(nodeId))
        .filter((node): node is CompiledNode => Boolean(node))
        .map((node) => Number(node.params.peakFactor ?? 1));

    return factors.length > 0 ? Math.max(...factors) : 1;
}
