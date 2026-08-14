import type { ComponentParams, StorageContext, StorageResult } from '../types/component';
import { SECONDS_PER_DAY } from './constants';
import type { CompiledNode, CompiledTopology } from './compile';
import type { NodeRuntime, OperationFlow } from './solver';

export const HORIZON_DAYS = 365;

export interface DerivedNode {
    storage: StorageResult | null;
    logsGbDay: number;
    egressGbDay: number;
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

export function deriveNodes(
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
    edgeFlows: Map<string, OperationFlow>,
): Map<string, DerivedNode> {
    const egressByNode = new Map<string, number>();

    for (const edge of topology.edges) {
        if (edge.scope !== 'internet') continue;

        const flow = edgeFlows.get(edge.id);
        if (!flow) continue;

        const gbDay = (flow.total * flow.responseBytes * SECONDS_PER_DAY) / 1e9;
        egressByNode.set(edge.target, (egressByNode.get(edge.target) ?? 0) + gbDay);
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
        });
    }

    return derived;
}
