import type { CostBreakdown } from '../types/component';
import type { CompiledTopology } from './compile';
import type { NodeRuntime, OperationFlow } from './solver';
import type { AvailabilityResult } from './availability';
import type { ConsistencyResult, Finding, Severity } from './types';

const SATURATION_WARNING = 0.8;
const RETRY_STORM_THRESHOLD = 0.25;
const EGRESS_SHARE_THRESHOLD = 0.4;
const ANOMALY_SHARE_THRESHOLD = 0.001;
const STORE_GROUPS = new Set(['sql', 'nosql', 'search', 'olap']);

interface FindingInput {
    topology: CompiledTopology;
    runtimes: Map<string, NodeRuntime>;
    edgeFlows: Map<string, OperationFlow>;
    availability: AvailabilityResult;
    consistency: ConsistencyResult;
    cost: { byNode: Map<string, CostBreakdown>; total: CostBreakdown };
    converged: boolean;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function buildFindings(input: FindingInput): Finding[] {
    const { topology, runtimes, edgeFlows, availability, consistency, cost, converged } = input;
    const findings: Finding[] = [];

    const push = (
        code: string,
        severity: Severity,
        nodeIds: string[],
        edgeIds: string[],
        values: Record<string, string | number>,
    ): void => {
        findings.push({ id: `${code}:${nodeIds.join(',')}:${edgeIds.join(',')}`, code, severity, nodeIds, edgeIds, values });
    };

    if (!converged) push('retry-storm', 'error', [], [], {});

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;

        const runtime = runtimes.get(node.id);
        if (!runtime || runtime.lambdaOffered <= 0) continue;

        if (runtime.boundBy === 'unmodelled') {
            push('unmodelled', 'info', [node.id], [], {});
            continue;
        }

        if (runtime.queue.utilization >= 1) {
            push('overloaded', 'error', [node.id], [], {
                utilization: runtime.queue.utilization,
                boundBy: runtime.boundBy,
                capacity: runtime.capacity,
                dropped: runtime.lambdaOffered - runtime.throughput,
            });
        } else if (runtime.queue.utilization > SATURATION_WARNING) {
            push('saturated', 'warning', [node.id], [], {
                utilization: runtime.queue.utilization,
                boundBy: runtime.boundBy,
                capacity: runtime.capacity,
            });
        }

        if (runtime.retryAmplification > RETRY_STORM_THRESHOLD) {
            push('retry-amplification', 'warning', [node.id], [], {
                amplification: runtime.retryAmplification,
            });
        }

        if (runtime.hitRatio !== null && runtime.hotKeyShare > 0) {
            const hotKeyRps = runtime.lambdaOffered * runtime.hotKeyShare;
            const shards = Number(node.params.shards ?? 1);
            const perShardCapacity = runtime.capacity / Math.max(shards, 1);

            if (hotKeyRps > perShardCapacity) {
                push('hot-key', 'warning', [node.id], [], {
                    hotKeyRps,
                    perShardCapacity,
                });
            }
        }
    }

    for (const nodeId of availability.spofNodeIds) {
        push('spof', 'warning', [nodeId], [], {});
    }

    for (const edge of topology.edges) {
        const source = topology.nodeById.get(edge.source);
        const target = topology.nodeById.get(edge.target);
        if (!source || !target) continue;

        if (source.definition.group === 'clients' && STORE_GROUPS.has(target.definition.group)) {
            push('client-direct-to-store', 'warning', [source.id, target.id], [edge.id], {});
        }

        if (edge.policy.retries > 0 && !edge.policy.idempotent) {
            push('retry-without-idempotency', 'warning', [source.id, target.id], [edge.id], {
                retries: edge.policy.retries,
            });
        }

        if (edge.isAsync) {
            const flow = edgeFlows.get(edge.id);
            const consumer = runtimes.get(edge.target);

            if (flow && consumer && flow.total > consumer.capacity) {
                push('backlog-growing', 'error', [edge.target], [edge.id], {
                    producerRps: flow.total,
                    consumerCapacity: consumer.capacity,
                    growthPerSec: flow.total - consumer.capacity,
                });
            }
        }
    }

    for (const node of topology.nodes) {
        if (!STORE_GROUPS.has(node.definition.group)) continue;

        const runtime = runtimes.get(node.id);
        if (!runtime || runtime.read <= 0) continue;

        const hasCacheSibling = topology.edges.some((edge) => {
            if (edge.target !== node.id) return false;

            const caller = topology.nodeById.get(edge.source);
            if (!caller) return false;

            return caller.outgoing.some((siblingId) => {
                const sibling = topology.edgeById.get(siblingId);
                const siblingTarget = sibling ? topology.nodeById.get(sibling.target) : null;
                return siblingTarget?.definition.group === 'cache';
            });
        });

        if (!hasCacheSibling && runtime.queue.utilization > 0.5) {
            push('read-heavy-without-cache', 'info', [node.id], [], {
                readRps: runtime.read,
                utilization: runtime.queue.utilization,
            });
        }
    }

    const egressCost = [...cost.byNode.values()].reduce((sum, item) => sum + item.network, 0);
    if (cost.total.total > 0 && egressCost / cost.total.total > EGRESS_SHARE_THRESHOLD) {
        push('egress-dominates', 'info', [], [], {
            egressCost,
            share: egressCost / cost.total.total,
        });
    }

    for (const anomaly of consistency.anomalies) {
        if (anomaly.shareOfOperations < ANOMALY_SHARE_THRESHOLD) continue;

        push(`anomaly-${anomaly.code}`, anomaly.code === 'lost-write-lww' ? 'error' : 'warning', anomaly.nodeIds, [], {
            ratePerSec: anomaly.ratePerSec,
            share: anomaly.shareOfOperations,
        });
    }

    return findings.sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
}
