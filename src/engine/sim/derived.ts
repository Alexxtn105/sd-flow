import type { ComponentParams, StorageContext, StorageResult } from '../types/component';
import { BACKUP_GROUPS, BACKUP_POLICY, SECONDS_PER_DAY } from './constants';
import type { CompiledEdge, CompiledNode, CompiledTopology } from './compile';
import type { NodeRuntime, OperationFlow } from './solver';

export const HORIZON_DAYS = 365;

const OFF_PREMISE_CACHE_TYPES = new Set(['cdn']);
const EXTERNAL_SERVICE_TYPES = new Set(['external-api']);

export interface DerivedNode {
    storage: StorageResult | null;
    logsGbDay: number;
    egressGbDay: number;
    backupGb: number;
}

export function backupCopies(): number {
    const { fullsPerMonth, incrementalsPerMonth, incrementalRatio, retentionMonths } = BACKUP_POLICY;

    return (fullsPerMonth + incrementalRatio * incrementalsPerMonth) * retentionMonths;
}

function backupGbOf(node: CompiledNode, storage: StorageResult | null): number {
    if (!storage || !BACKUP_GROUPS.has(node.definition.group)) return 0;

    return storage.totalGb * backupCopies();
}

interface EgressCharge {
    nodeId: string;
    bytesPerSec: number;
}

function recordBytesOf(node: CompiledNode, runtime: NodeRuntime): number {
    const explicit = node.params.rowSizeBytes ?? node.params.documentSizeBytes ?? node.params.messageSizeBytes;
    if (typeof explicit === 'number') return explicit;

    return runtime.requestBytes;
}

function logsGbDayOf(node: CompiledNode, runtime: NodeRuntime): number {
    const lines = node.params.logLinesPerRequest;
    const bytes = node.params.logBytesPerLine;

    if (typeof lines !== 'number' || typeof bytes !== 'number') return 0;

    return (runtime.throughput * lines * bytes * SECONDS_PER_DAY) / 1e9;
}

function egressChargeOf(
    edge: CompiledEdge,
    flow: OperationFlow,
    topology: CompiledTopology,
): EgressCharge | null {
    const source = topology.nodeById.get(edge.source);
    const target = topology.nodeById.get(edge.target);
    if (!source || !target) return null;

    if (edge.scope === 'internet' || OFF_PREMISE_CACHE_TYPES.has(source.type)) {
        return { nodeId: target.id, bytesPerSec: flow.total * flow.responseBytes };
    }

    if (EXTERNAL_SERVICE_TYPES.has(target.type)) {
        return { nodeId: source.id, bytesPerSec: flow.total * flow.requestBytes };
    }

    return null;
}

export function deriveNodes(
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
    edgeFlows: Map<string, OperationFlow>,
): Map<string, DerivedNode> {
    const egressByNode = new Map<string, number>();

    for (const edge of topology.edges) {
        const flow = edgeFlows.get(edge.id);
        if (!flow) continue;

        const charge = egressChargeOf(edge, flow, topology);
        if (!charge) continue;

        const gbDay = (charge.bytesPerSec * SECONDS_PER_DAY) / 1e9;
        egressByNode.set(charge.nodeId, (egressByNode.get(charge.nodeId) ?? 0) + gbDay);
    }

    const derived = new Map<string, DerivedNode>();

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;

        const runtime = runtimes.get(node.id);
        if (!runtime) continue;

        const model = node.definition.model;
        let storage: StorageResult | null = null;

        if (model?.storage) {
            const context: StorageContext<ComponentParams> = {
                nodeId: node.id,
                params: node.params,
                instances: runtime.instances,
                lambda: runtime.lambdaNominal,
                readShare: runtime.readShare,
                writeShare: runtime.writeShare,
                requestBytes: runtime.requestBytes,
                responseBytes: runtime.responseBytes,
                writeRps: runtime.write,
                recordBytes: recordBytesOf(node, runtime),
                horizonDays: HORIZON_DAYS,
            };
            storage = model.storage(context);
        }

        derived.set(node.id, {
            storage,
            logsGbDay: logsGbDayOf(node, runtime),
            egressGbDay: egressByNode.get(node.id) ?? 0,
            backupGb: backupGbOf(node, storage),
        });
    }

    return derived;
}
