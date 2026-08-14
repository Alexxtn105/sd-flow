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

function clientRps(node: CompiledNode): number {
    const dau = Number(node.params.dau ?? 0);
    const sessions = Number(node.params.sessionsPerUserDay ?? 0);
    const requests = Number(node.params.requestsPerSession ?? 0);

    return (dau * sessions * requests) / SECONDS_PER_DAY;
}

export function deriveFlows(topology: CompiledTopology, trafficMultiplier: number): Flow[] {
    return topology.entryNodes
        .map((nodeId) => topology.nodeById.get(nodeId))
        .filter((node): node is CompiledNode => Boolean(node))
        .map((node) => ({
            id: node.id,
            entryNodeId: node.id,
            rps: clientRps(node) * trafficMultiplier,
            readShare: Number(node.params.readWriteMix ?? 0.8),
            requestBytes: Number(node.params.avgRequestKb ?? 1) * 1000,
            responseBytes: Number(node.params.avgResponseKb ?? 10) * 1000,
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
