import type { ComponentParams } from '../types/component';
import type { CompiledNode, CompiledTopology } from './compile';
import { explain } from './resources';
import type { NodeRuntime, OperationFlow } from './solver';
import type { AnomalyRate, ConsistencyResult } from './types';

const READ_AFTER_WRITE_SHARE = 0.5;
const READ_AFTER_WRITE_GAP_SEC = 1;
const MONOTONIC_READ_GAP_SEC = 1;
const REBALANCE_REDELIVERY_RATE = 0.01;
const KEY_COUNT_PARAMS = ['rowCount', 'uniqueKeys', 'documentCount', 'itemCount', 'keyCount'];
const REPLICA_COUNT_PARAMS = ['readReplicas', 'replicas', 'replicasPerShard'];
const REPLICA_SET_PARAMS = ['replicationFactor', 'replicaSetSize'];
const ORDERING_PARAMS = ['orderingScope', 'queueType'];
const ORDERED_DELIVERY = new Set(['per-key', 'per-partition', 'global', 'fifo']);
const PARTITION_PARAMS = ['partitions', 'shards'];
const CONSUMER_SLOT_PARAMS = ['concurrencyPerInstance', 'concurrency'];
const STORE_GROUPS = new Set(['sql', 'nosql', 'cache', 'search', 'olap']);
const READ_YOUR_WRITES_MODELS = new Set(['read-your-writes']);
const MONOTONIC_MODELS = new Set(['monotonic']);

const ISOLATION_ANOMALIES: Record<string, string[]> = {
    'read-uncommitted': ['dirty-read', 'non-repeatable-read', 'phantom-read'],
    'read-committed': ['non-repeatable-read', 'phantom-read'],
    'repeatable-read': ['phantom-read'],
    snapshot: [],
    serializable: [],
};

function erf(value: number): number {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const t = 1 / (1 + 0.3275911 * x);
    const series =
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;

    return sign * (1 - series * Math.exp(-x * x));
}

export function normalCdf(value: number): number {
    return 0.5 * (1 + erf(value / Math.SQRT2));
}

export function logNormalTail(thresholdSec: number, medianSec: number, sigma: number): number {
    if (medianSec <= 0) return 0;
    if (thresholdSec <= 0) return 1;

    return 1 - normalCdf((Math.log(thresholdSec) - Math.log(medianSec)) / Math.max(sigma, 1e-6));
}

function effectiveKeys(params: ComponentParams): number {
    for (const key of KEY_COUNT_PARAMS) {
        const value = params[key];
        if (typeof value === 'number' && value > 0) return value;
    }

    return 1e6;
}

function numericParam(params: ComponentParams, names: string[], minimum: number): number {
    for (const name of names) {
        const value = params[name];
        if (typeof value === 'number' && value >= minimum) return value;
    }

    return 0;
}

function replicaPoolSize(node: CompiledNode): number {
    const counted = numericParam(node.params, REPLICA_COUNT_PARAMS, 1);
    if (counted > 0) return 1 + counted;

    const declaredSet = numericParam(node.params, REPLICA_SET_PARAMS, 2);
    if (declaredSet > 0) return declaredSet;

    return 1;
}

function stickyReadShare(node: CompiledNode): number {
    const share = node.params.stickyReadShare;
    if (typeof share !== 'number') return 0;

    return Math.min(Math.max(share, 0), 1);
}

function preservesOrder(node: CompiledNode): boolean {
    for (const name of ORDERING_PARAMS) {
        const value = node.params[name];
        if (typeof value === 'string' && value.length > 0) return ORDERED_DELIVERY.has(value);
    }

    return false;
}

function consumerSlots(consumer: CompiledNode, runtime: NodeRuntime | undefined): number {
    const instances = runtime?.instances ?? numericParam(consumer.params, ['instances'], 1);
    const slots = numericParam(consumer.params, CONSUMER_SLOT_PARAMS, 1);

    return Math.max(1, Math.max(1, instances) * Math.max(1, slots));
}

function parallelLanes(broker: CompiledNode, consumers: number): number {
    const partitions = numericParam(broker.params, PARTITION_PARAMS, 1);

    return partitions > 0 ? Math.min(partitions, consumers) : consumers;
}

function replicaLagSec(node: CompiledNode, runtime: NodeRuntime): number {
    const declared = Number(node.params.replicaLagMs ?? 0) / 1000;
    if (declared <= 0) return 0;

    const utilization = Math.min(runtime.queue.utilization, 0.99);
    const pressure = 1 + (utilization * utilization) / (1 - utilization);

    return declared * pressure;
}

function expectedLagSec(medianSec: number, sigma: number): number {
    return medianSec * Math.exp((sigma * sigma) / 2);
}

function replicaReadShare(node: CompiledNode): number {
    const share = node.params.readFromReplica;
    if (typeof share === 'number') return share;

    const mode = node.params.replicationMode;
    return mode === 'async' ? 1 : 0;
}

function quorumIsStrong(params: ComponentParams): boolean {
    const total = params.quorumN;
    const read = params.quorumR;
    const write = params.quorumW;

    if (typeof total !== 'number' || typeof read !== 'number' || typeof write !== 'number') return false;

    return read + write > total;
}

function staleReadsEliminated(node: CompiledNode): boolean {
    const model = String(node.params.consistencyModel ?? '');
    const replication = String(node.params.replicationMode ?? '');

    if (quorumIsStrong(node.params)) return true;

    return model === 'linearizable' && replication === 'sync';
}

function readYourWritesGuaranteed(node: CompiledNode): boolean {
    return READ_YOUR_WRITES_MODELS.has(String(node.params.consistencyModel ?? ''));
}

function monotonicGuaranteed(node: CompiledNode): boolean {
    return MONOTONIC_MODELS.has(String(node.params.consistencyModel ?? ''));
}

function mergesConflicts(node: CompiledNode): boolean {
    return String(node.params.concurrencyControl ?? '') === 'crdt';
}

export function analyseConsistency(
    topology: CompiledTopology,
    runtimes: Map<string, NodeRuntime>,
    edgeFlows: Map<string, OperationFlow>,
    mode: 'off' | 'attribute' | 'anomalies',
): ConsistencyResult {
    if (mode !== 'anomalies') return { mode, anomalies: [] };

    const anomalies: AnomalyRate[] = [];
    const policy = topology.multiRegionPolicy;
    const conflictResolution = String(policy?.params.conflictResolution ?? 'lww');
    const multiMaster =
        policy !== null &&
        policy.params.mode === 'active-active' &&
        policy.params.replicationDirection === 'bidirectional' &&
        topology.regions.length > 1 &&
        conflictResolution !== 'single-writer-per-key' &&
        conflictResolution !== 'crdt';

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;
        if (!STORE_GROUPS.has(node.definition.group)) continue;

        const runtime = runtimes.get(node.id);
        if (!runtime || runtime.throughput <= 0) continue;

        const keys = effectiveKeys(node.params);
        const sigma = Number(node.params.replicaLagSigma ?? 0.8);
        const lagSec = replicaLagSec(node, runtime);
        const meanLagSec = expectedLagSec(lagSec, sigma);
        const replicaShare = replicaReadShare(node);
        const writePerKey = runtime.write / keys;

        if (lagSec > 0 && replicaShare > 0 && !staleReadsEliminated(node)) {
            const staleProbability = 1 - Math.exp(-writePerKey * meanLagSec);
            const rate = runtime.read * replicaShare * staleProbability;

            if (rate > 0) {
                anomalies.push({
                    code: 'stale-read',
                    ratePerSec: rate,
                    shareOfOperations: runtime.read > 0 ? rate / runtime.read : 0,
                    nodeIds: [node.id],
                    explain: explain(
                        'λ_read × replicaShare × (1 − e^(−λ_write,key × E[L]))',
                        {
                            lambdaRead: runtime.read,
                            replicaShare,
                            lambdaWriteKey: writePerKey,
                            expectedLagSec: meanLagSec,
                        },
                        rate,
                        'op/s',
                    ),
                });
            }

            const sticky = stickyReadShare(node);
            const rywProbability = logNormalTail(READ_AFTER_WRITE_GAP_SEC, lagSec, sigma);
            const rywRate = readYourWritesGuaranteed(node)
                ? 0
                : runtime.write * READ_AFTER_WRITE_SHARE * replicaShare * rywProbability * (1 - sticky);

            if (rywRate > 0) {
                anomalies.push({
                    code: 'read-your-writes',
                    ratePerSec: rywRate,
                    shareOfOperations: runtime.write > 0 ? rywRate / runtime.write : 0,
                    nodeIds: [node.id],
                    explain: explain(
                        'λ_write × readAfterWriteShare × replicaShare × (1 − stickyReadShare) × P(L > Δt)',
                        {
                            lambdaWrite: runtime.write,
                            readAfterWriteShare: READ_AFTER_WRITE_SHARE,
                            replicaShare,
                            stickyReadShare: sticky,
                            deltaSec: READ_AFTER_WRITE_GAP_SEC,
                            medianLagSec: lagSec,
                        },
                        rywRate,
                        'op/s',
                    ),
                });
            }

            const replicaPool = replicaPoolSize(node);
            const pairSigma = sigma * Math.SQRT2;
            const divergenceProbability = logNormalTail(MONOTONIC_READ_GAP_SEC, lagSec, pairSigma);
            const monotonicRate = monotonicGuaranteed(node)
                ? 0
                : rate * (1 - sticky) * (1 - 1 / replicaPool) * divergenceProbability;

            if (monotonicRate > 0) {
                anomalies.push({
                    code: 'monotonic-read',
                    ratePerSec: monotonicRate,
                    shareOfOperations: monotonicRate / runtime.read,
                    nodeIds: [node.id],
                    explain: explain(
                        'λ_read × replicaShare × (1 − e^(−λ_write,key × E[L])) × (1 − stickyReadShare) × (1 − 1/nReplicas) × P(|L₁ − L₂| > Δt)',
                        {
                            lambdaRead: runtime.read,
                            replicaShare,
                            lambdaWriteKey: writePerKey,
                            expectedLagSec: meanLagSec,
                            stickyReadShare: sticky,
                            nReplicas: replicaPool,
                            deltaSec: MONOTONIC_READ_GAP_SEC,
                            pairSigma,
                        },
                        monotonicRate,
                        'op/s',
                    ),
                });
            }
        }

        const control = String(node.params.concurrencyControl ?? 'none');
        if (control === 'none' && runtime.write > 0) {
            const windowSec = runtime.serviceSec * 2;
            const collisionProbability = 1 - Math.exp(-writePerKey * windowSec);
            const rate = runtime.write * collisionProbability;

            if (rate > 0) {
                anomalies.push({
                    code: 'lost-update',
                    ratePerSec: rate,
                    shareOfOperations: rate / runtime.write,
                    nodeIds: [node.id],
                    explain: explain(
                        'λ_write × (1 − e^(−λ_write,key × W_rmw))',
                        { lambdaWrite: runtime.write, lambdaWriteKey: writePerKey, windowSec },
                        rate,
                        'op/s',
                    ),
                });
            }
        }

        const isolationLevel = String(node.params.isolationLevel ?? '');
        const isolationCodes = ISOLATION_ANOMALIES[isolationLevel] ?? [];

        if (isolationCodes.length > 0 && runtime.read > 0 && runtime.write > 0) {
            const windowSec = runtime.serviceSec * 2;
            const overlapProbability = 1 - Math.exp(-writePerKey * windowSec);
            const rate = runtime.read * overlapProbability;

            for (const code of rate > 0 ? isolationCodes : []) {
                anomalies.push({
                    code,
                    ratePerSec: rate,
                    shareOfOperations: rate / runtime.read,
                    nodeIds: [node.id],
                    upperBound: true,
                    explain: explain(
                        '≤ λ_read × (1 − e^(−λ_write,key × W_tx))',
                        {
                            isolationLevel,
                            lambdaRead: runtime.read,
                            lambdaWriteKey: writePerKey,
                            windowSec,
                        },
                        rate,
                        'op/s',
                    ),
                });
            }
        }

        if (multiMaster && runtime.write > 0 && !mergesConflicts(node)) {
            const regionCount = Math.max(topology.regions.length, 2);
            const propagationSec = meanLagSec > 0 ? meanLagSec : 0.1;
            const foreignWritePerKey = writePerKey * (regionCount - 1);
            const conflictProbability = 1 - Math.exp(-foreignWritePerKey * propagationSec);
            const rate = runtime.write * conflictProbability;
            const resolution = conflictResolution;

            if (rate > 0) {
                anomalies.push({
                    code: 'write-conflict',
                    ratePerSec: rate,
                    shareOfOperations: rate / runtime.write,
                    nodeIds: [node.id],
                    explain: explain(
                        'λ_write × (1 − e^(−Σλ_key,other × T_prop))',
                        {
                            lambdaWrite: runtime.write,
                            foreignWritePerKey,
                            propagationSec,
                            conflictResolution: resolution,
                        },
                        rate,
                        'op/s',
                    ),
                });

                if (resolution === 'lww') {
                    anomalies.push({
                        code: 'lost-write-lww',
                        ratePerSec: rate * 0.5,
                        shareOfOperations: (rate * 0.5) / runtime.write,
                        nodeIds: [node.id],
                        explain: explain(
                            'rate_conflict × 0.5',
                            { conflictRate: rate },
                            rate * 0.5,
                            'op/s',
                        ),
                    });
                }
            }
        }
    }

    for (const edge of topology.edges) {
        if (!edge.isAsync) continue;

        const flow = edgeFlows.get(edge.id);
        const consumer = topology.nodeById.get(edge.target);
        if (!flow || !consumer || flow.total <= 0) continue;
        if (consumer.definition.group === 'messaging') continue;

        const idempotent = edge.policy.idempotent || consumer.params.idempotent === true;
        const consumerRuntime = runtimes.get(consumer.id);

        if (!idempotent) {
            const redeliveryRate =
                (consumerRuntime?.queue.failureProbability ?? 0) + REBALANCE_REDELIVERY_RATE;
            const rate = flow.total * redeliveryRate;

            if (rate > 0) {
                anomalies.push({
                    code: 'duplicate-processing',
                    ratePerSec: rate,
                    shareOfOperations: rate / flow.total,
                    nodeIds: [consumer.id],
                    explain: explain(
                        'λ_async × (p_fail_consumer + rebalanceRate)',
                        { lambdaAsync: flow.total, redeliveryRate },
                        rate,
                        'op/s',
                    ),
                });
            }
        }

        const broker = topology.nodeById.get(edge.source);
        if (!broker || preservesOrder(broker)) continue;

        const declaredConsumers = numericParam(broker.params, ['consumersPerGroup'], 1);
        const consumers =
            declaredConsumers > 0 ? declaredConsumers : consumerSlots(consumer, consumerRuntime);
        const lanes = parallelLanes(broker, consumers);
        const windowSec = consumerRuntime?.serviceSec ?? 0;

        if (lanes <= 1 || windowSec <= 0) continue;

        const keys = effectiveKeys(broker.params);
        const perKey = flow.total / keys;
        const overlapProbability = 1 - Math.exp(-perKey * windowSec);
        const orderingRate = flow.total * overlapProbability * (1 - 1 / lanes);

        if (orderingRate > 0) {
            anomalies.push({
                code: 'ordering-violation',
                ratePerSec: orderingRate,
                shareOfOperations: orderingRate / flow.total,
                nodeIds: [broker.id, consumer.id],
                explain: explain(
                    'λ_async × (1 − e^(−λ_async,key × W_processing)) × (1 − 1/lanes), lanes = min(partitions, consumers)',
                    {
                        lambdaAsync: flow.total,
                        orderingGuarantee: 'none',
                        keys,
                        lambdaAsyncKey: perKey,
                        windowSec,
                        consumers,
                        lanes,
                    },
                    orderingRate,
                    'op/s',
                ),
            });
        }
    }

    return { mode, anomalies };
}
