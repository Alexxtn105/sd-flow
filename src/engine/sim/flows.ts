import type { ComponentParams, ParamValue } from '../types/component';
import type { CallOperation } from '../types/scheme';
import { SECONDS_PER_DAY } from './constants';
import type { CompiledNode, CompiledTopology } from './compile';

export const READ_OPERATIONS: CallOperation[] = ['read', 'scan', 'consume'];

export interface Flow {
    id: string;
    entryNodeId: string;
    rps: number;
    readShare: number;
    requestBytes: number;
    responseBytes: number;
    geo: string;
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

function clientRps(node: CompiledNode): number {
    const formula = RPS_BY_CLIENT_TYPE.get(node.type);

    return formula ? formula(node.params) : sessionRps(node.params);
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
            geo: String(node.params.geoDistribution ?? 'global'),
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
