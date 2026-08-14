import type { ComponentDefinition, ComponentParams, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    connectionBound,
    defineModel,
    explain,
    explicitRps,
    iopsBound,
    littleLaw,
    totalCost,
    weightedUnitBound,
} from '../sim/resources';
import { bool, choice, defineComponent, num, text } from './_shared/params';

const SQL_PORTS: PortSpec = {
    in: [{ id: 'sql', protocols: ['sql'], role: 'serve' }],
    out: [
        { id: 'replication', protocols: ['sql'], role: 'replicate' },
        { id: 'cdc', protocols: ['kafka'], role: 'emit' },
        { id: 'backup', protocols: ['s3'], role: 'call' },
    ],
};

const CONSISTENCY_MODEL = [
    'linearizable',
    'sequential',
    'bounded-staleness',
    'read-your-writes',
    'monotonic',
    'eventual',
];

const REPLICATION_MODE = ['sync', 'semi-sync', 'async'];

const CONCURRENCY_CONTROL = ['none', 'optimistic', 'pessimistic', 'crdt'];

const CONFLICT_RESOLUTION = ['lww', 'vector-clock', 'crdt', 'single-writer-per-key', 'manual'];

const ISOLATION_LEVEL = [
    'read-uncommitted',
    'read-committed',
    'repeatable-read',
    'snapshot',
    'serializable',
];

const QUERY_PROFILE = ['point-read', 'range-scan', 'join', 'aggregate', 'full-scan'];

const CONNECTION_POOLER = ['none', 'pgbouncer-transaction', 'pgbouncer-session', 'proxy-managed'];

const TRANSACTION_SCOPE = ['none', 'single-row', 'single-shard', 'cross-shard', 'distributed-2pc'];

const SHARD_STRATEGY = ['hash', 'range', 'directory'];

const PARTITION_STRATEGY = ['range', 'geo-partitioned', 'global-table'];

const POOLER_MULTIPLIER: Record<string, number> = {
    none: 1,
    'pgbouncer-transaction': 10,
    'pgbouncer-session': 2,
    'proxy-managed': 5,
};

const TRANSACTION_SCOPE_COST: Record<string, number> = {
    none: 1,
    'single-row': 1,
    'single-shard': 1.2,
    'cross-shard': 1.8,
    'distributed-2pc': 2.5,
};

const SHARD_IMBALANCE: Record<string, number> = {
    hash: 1,
    range: 1.4,
    directory: 1.15,
};

function transactionScopeCost(scope: string): number {
    return TRANSACTION_SCOPE_COST[scope] ?? 1;
}

function poolerMultiplier(pooler: string): number {
    return POOLER_MULTIPLIER[pooler] ?? 1;
}

interface RelationalParams extends ComponentParams {
    readReplicas: number;
    shardCount: number;
    maxConnections: number;
    connectionPooler: string;
    connectionsPerQuery: number;
    cpuCores: number;
    provisionedIops: number;
    iopsPerRead: number;
    iopsPerWrite: number;
    rowSizeBytes: number;
    rowCount: number;
    indexOverhead: number;
    readServiceMs: number;
    writeServiceMs: number;
    readFromReplica: number;
    availability: number;
    costPerInstanceHour: number;
    costPerGbMonth: number;
}

function weightedServiceSec(params: RelationalParams, readShare: number, writeShare: number): number {
    return (readShare * params.readServiceMs + writeShare * params.writeServiceMs) / 1000;
}

function replicationFactor(params: RelationalParams): number {
    return 1 + params.readReplicas;
}

function relationalModel<P extends RelationalParams>() {
    return defineModel<P>({
        serviceSec: (ctx) => weightedServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
        resources: (ctx) => {
            const serviceSec = weightedServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
            const readCapacityFactor = 1 + ctx.params.readReplicas * ctx.params.readFromReplica;
            const pooler = POOLER_MULTIPLIER[ctx.params.connectionPooler] ?? 1;

            return [
                littleLaw(
                    'cpu',
                    ctx.params.cpuCores * ctx.params.shardCount * readCapacityFactor,
                    serviceSec,
                ),
                connectionBound(
                    'connections',
                    ctx.params.maxConnections * ctx.params.shardCount * pooler,
                    ctx.params.connectionsPerQuery,
                    serviceSec,
                ),
                iopsBound(
                    'iops',
                    ctx.params.provisionedIops * ctx.params.shardCount,
                    ctx.params.iopsPerRead,
                    ctx.params.iopsPerWrite,
                    ctx.readShare,
                    ctx.writeShare,
                ),
            ];
        },
        storage: (ctx) => {
            const factor = replicationFactor(ctx.params);
            const bytesPerRow = ctx.params.rowSizeBytes * (1 + ctx.params.indexOverhead);
            const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * bytesPerRow * factor) / 1e9;
            const baseGb = (ctx.params.rowCount * bytesPerRow * factor) / 1e9;

            return {
                totalGb: baseGb + growthGbDay * ctx.horizonDays,
                growthGbDay,
                memoryGb: 0,
                explain: [
                    explain(
                        'rowCount × rowSize × (1 + indexOverhead) × RF / 10⁹',
                        {
                            rowCount: ctx.params.rowCount,
                            rowSize: ctx.params.rowSizeBytes,
                            indexOverhead: ctx.params.indexOverhead,
                            RF: factor,
                        },
                        baseGb,
                        'gb',
                    ),
                    explain(
                        'writeRps × 86400 × rowSize × (1 + indexOverhead) × RF / 10⁹',
                        {
                            writeRps: ctx.writeRps,
                            rowSize: ctx.params.rowSizeBytes,
                            indexOverhead: ctx.params.indexOverhead,
                            RF: factor,
                        },
                        growthGbDay,
                        'gb/day',
                    ),
                ],
            };
        },
        cost: (ctx) => {
            const nodes = replicationFactor(ctx.params) * ctx.params.shardCount;
            return totalCost({
                compute: nodes * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
                storage: ctx.storageGb * ctx.params.costPerGbMonth,
                network: 0,
                requests: 0,
            });
        },
        availability: (params) => params.availability,
    });
}

const postgresDefaults = {
    readReplicas: 2,
    shardCount: 1,
    maxConnections: 200,
    connectionPooler: 'none',
    connectionsPerQuery: 1,
    cpuCores: 8,
    bufferPoolGb: 8,
    storageGb: 500,
    provisionedIops: 12000,
    iopsPerRead: 1,
    iopsPerWrite: 4,
    rowSizeBytes: 400,
    rowCount: 200000000,
    indexOverhead: 0.4,
    workingSetGb: 20,
    queryProfile: 'point-read',
    readServiceMs: 0.8,
    writeServiceMs: 2.5,
    consistencyModel: 'linearizable',
    replicationMode: 'async',
    replicaLagMs: 200,
    replicaLagSigma: 0.8,
    readFromReplica: 0.3,
    concurrencyControl: 'pessimistic',
    isolationLevel: 'read-committed',
    conflictResolution: 'single-writer-per-key',
    multiAz: true,
    failoverSec: 45,
    availability: 0.9995,
    costPerInstanceHour: 0.65,
    costPerGbMonth: 0.115,
};

const RELATIONAL_SCHEMA = {
    readReplicas: num('topology', { min: 0, max: 30 }),
    shardCount: num('topology', { min: 1, max: 4096 }),
    maxConnections: num('capacity', { min: 10, max: 20000, realistic: { min: 100, max: 1000 } }),
    connectionPooler: choice('capacity', CONNECTION_POOLER),
    connectionsPerQuery: num('capacity', { min: 0.01, max: 10, step: 0.01 }),
    cpuCores: num('capacity', { min: 1, max: 192 }),
    bufferPoolGb: num('capacity', { unitKey: 'gb', min: 0.25, max: 4096, step: 0.25 }),
    storageGb: num('capacity', { unitKey: 'gb', min: 1, max: 1000000 }),
    provisionedIops: num('capacity', { min: 100, max: 1000000 }),
    iopsPerRead: num('capacity', { min: 0.1, max: 100, step: 0.1 }),
    iopsPerWrite: num('capacity', { min: 0.1, max: 100, step: 0.1, realistic: { min: 3, max: 8 } }),
    rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
    rowCount: num('data', { min: 0, max: 1000000000000 }),
    indexOverhead: num('data', { min: 0, max: 3, step: 0.1, realistic: { min: 0.2, max: 1 } }),
    workingSetGb: num('data', { unitKey: 'gb', min: 0.1, max: 100000, step: 0.1 }),
    queryProfile: choice('performance', QUERY_PROFILE),
    readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
    writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
    consistencyModel: choice('consistency', CONSISTENCY_MODEL),
    replicationMode: choice('consistency', REPLICATION_MODE),
    replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 50, max: 2000 } }),
    replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
    readFromReplica: num('consistency', { min: 0, max: 1, step: 0.05 }),
    concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
    isolationLevel: choice('consistency', ISOLATION_LEVEL),
    conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
    multiAz: bool('reliability'),
    failoverSec: num('reliability', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 15, max: 120 } }),
    availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
    costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
};

const postgres = defineComponent({
    id: 'postgres',
    group: 'sql',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-sql',
    ports: SQL_PORTS,
    defaultParams: postgresDefaults,
    paramSchema: RELATIONAL_SCHEMA,
    model: relationalModel<typeof postgresDefaults>(),
    helpId: 'postgres',
});

const mysqlDefaults = {
    ...postgresDefaults,
    maxConnections: 500,
    bufferPoolGb: 24,
    iopsPerWrite: 3,
    rowSizeBytes: 300,
    rowCount: 300000000,
    indexOverhead: 0.35,
    workingSetGb: 24,
    readServiceMs: 0.6,
    writeServiceMs: 2,
    replicationMode: 'semi-sync',
    replicaLagMs: 500,
    readFromReplica: 0.4,
    isolationLevel: 'repeatable-read',
    failoverSec: 60,
    costPerInstanceHour: 0.58,
};

const mysql = defineComponent({
    id: 'mysql',
    group: 'sql',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-sql',
    ports: SQL_PORTS,
    defaultParams: mysqlDefaults,
    paramSchema: RELATIONAL_SCHEMA,
    model: relationalModel<typeof mysqlDefaults>(),
    helpId: 'mysql',
});

const auroraDefaults = {
    readReplicas: 3,
    quorumN: 6,
    quorumR: 3,
    quorumW: 4,
    maxConnections: 3000,
    connectionPooler: 'proxy-managed',
    connectionsPerQuery: 1,
    cpuCores: 16,
    bufferPoolGb: 64,
    storageGb: 2000,
    provisionedIops: 60000,
    iopsPerRead: 1,
    iopsPerWrite: 1,
    rowSizeBytes: 400,
    rowCount: 500000000,
    indexOverhead: 0.4,
    workingSetGb: 60,
    queryProfile: 'point-read',
    readServiceMs: 0.6,
    writeServiceMs: 1.8,
    consistencyModel: 'linearizable',
    replicationMode: 'async',
    replicaLagMs: 20,
    replicaLagSigma: 0.8,
    readFromReplica: 0.6,
    concurrencyControl: 'pessimistic',
    isolationLevel: 'read-committed',
    conflictResolution: 'single-writer-per-key',
    transactionScope: 'single-shard',
    multiAz: true,
    failoverSec: 30,
    availability: 0.9999,
    costPerInstanceHour: 0.58,
    costPerGbMonth: 0.1,
    costPerMillionIo: 0.2,
};

function auroraWriteSec(params: typeof auroraDefaults): number {
    return (params.writeServiceMs * transactionScopeCost(params.transactionScope)) / 1000;
}

function auroraServiceSec(params: typeof auroraDefaults, readShare: number, writeShare: number): number {
    return (readShare * params.readServiceMs) / 1000 + writeShare * auroraWriteSec(params);
}

function auroraServingCores(params: typeof auroraDefaults, readShare: number): number {
    return params.cpuCores * (1 + params.readReplicas * params.readFromReplica * readShare);
}

function auroraIoPerRequest(
    params: typeof auroraDefaults,
    readShare: number,
    writeShare: number,
): number {
    return readShare * params.iopsPerRead + writeShare * params.iopsPerWrite * params.quorumW;
}

const auroraModel = defineModel<typeof auroraDefaults>({
    serviceSec: (ctx) => auroraServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = auroraServiceSec(ctx.params, ctx.readShare, ctx.writeShare);

        return [
            littleLaw('cpu', auroraServingCores(ctx.params, ctx.readShare), serviceSec),
            connectionBound(
                'connections',
                ctx.params.maxConnections * poolerMultiplier(ctx.params.connectionPooler),
                ctx.params.connectionsPerQuery,
                serviceSec,
            ),
            weightedUnitBound(
                'iops',
                'provisionedIops / (readShare × iopsPerRead + writeShare × iopsPerWrite × quorumW)',
                {
                    provisionedIops: ctx.params.provisionedIops,
                    iopsPerRead: ctx.params.iopsPerRead,
                    iopsPerWrite: ctx.params.iopsPerWrite,
                    quorumW: ctx.params.quorumW,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                ctx.params.iopsPerRead / ctx.params.provisionedIops,
                (ctx.params.iopsPerWrite * ctx.params.quorumW) / ctx.params.provisionedIops,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const bytesPerRow = ctx.params.rowSizeBytes * (1 + ctx.params.indexOverhead);
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * bytesPerRow) / 1e9;
        const baseGb = (ctx.params.rowCount * bytesPerRow) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'rowCount × rowSize × (1 + indexOverhead) / 10⁹',
                    {
                        rowCount: ctx.params.rowCount,
                        rowSize: ctx.params.rowSizeBytes,
                        indexOverhead: ctx.params.indexOverhead,
                        readReplicas: ctx.params.readReplicas,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × rowSize × (1 + indexOverhead) / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        rowSize: ctx.params.rowSizeBytes,
                        indexOverhead: ctx.params.indexOverhead,
                    },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const ioPerMonth =
            ctx.lambda * auroraIoPerRequest(ctx.params, ctx.readShare, ctx.writeShare) * SECONDS_PER_MONTH;

        return totalCost({
            compute:
                (1 + ctx.params.readReplicas) *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: (ioPerMonth / 1e6) * ctx.params.costPerMillionIo,
        });
    },
    availability: (params) => params.availability,
});

const aurora = defineComponent({
    id: 'aurora',
    group: 'sql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-sql-managed',
    ports: SQL_PORTS,
    managed: true,
    defaultParams: auroraDefaults,
    paramSchema: {
        readReplicas: num('topology', { min: 0, max: 15, realistic: { min: 1, max: 15 } }),
        quorumN: num('consistency', { min: 1, max: 12 }),
        quorumR: num('consistency', { min: 1, max: 12 }),
        quorumW: num('consistency', { min: 1, max: 12 }),
        maxConnections: num('capacity', { min: 10, max: 20000, realistic: { min: 500, max: 5000 } }),
        connectionPooler: choice('capacity', CONNECTION_POOLER),
        connectionsPerQuery: num('capacity', { min: 0.01, max: 10, step: 0.01 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        bufferPoolGb: num('capacity', { unitKey: 'gb', min: 0.25, max: 4096, step: 0.25 }),
        storageGb: num('capacity', { unitKey: 'gb', min: 1, max: 128000 }),
        provisionedIops: num('capacity', { min: 100, max: 1000000, realistic: { min: 20000, max: 200000 } }),
        iopsPerRead: num('capacity', { min: 0.1, max: 100, step: 0.1 }),
        iopsPerWrite: num('capacity', { min: 0.1, max: 100, step: 0.1, realistic: { min: 1, max: 2 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
        rowCount: num('data', { min: 0, max: 1000000000000 }),
        indexOverhead: num('data', { min: 0, max: 3, step: 0.1, realistic: { min: 0.2, max: 1 } }),
        workingSetGb: num('data', { unitKey: 'gb', min: 0.1, max: 100000, step: 0.1 }),
        queryProfile: choice('performance', QUERY_PROFILE),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 5, max: 100 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        readFromReplica: num('consistency', { min: 0, max: 1, step: 0.05 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        isolationLevel: choice('consistency', ISOLATION_LEVEL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        transactionScope: choice('consistency', TRANSACTION_SCOPE),
        multiAz: bool('reliability'),
        failoverSec: num('reliability', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 15, max: 60 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
        costPerMillionIo: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
    },
    model: auroraModel,
    helpId: 'aurora',
});

const vitessDefaults = {
    shardCount: 8,
    replicasPerShard: 2,
    shardKey: 'customerId',
    shardStrategy: 'hash',
    crossShardQueryShare: 0.1,
    vtgateInstances: 4,
    vtgateMaxRps: 12000,
    vtgateLatencyMs: 0.4,
    maxConnections: 500,
    connectionPooler: 'proxy-managed',
    connectionsPerQuery: 1,
    cpuCores: 8,
    bufferPoolGb: 32,
    storageGb: 4000,
    provisionedIops: 12000,
    iopsPerRead: 1,
    iopsPerWrite: 3,
    rowSizeBytes: 300,
    rowCount: 4000000000,
    indexOverhead: 0.35,
    workingSetGb: 40,
    queryProfile: 'point-read',
    readServiceMs: 0.6,
    writeServiceMs: 2,
    consistencyModel: 'sequential',
    replicationMode: 'semi-sync',
    replicaLagMs: 500,
    replicaLagSigma: 0.8,
    readFromReplica: 0.5,
    concurrencyControl: 'pessimistic',
    isolationLevel: 'repeatable-read',
    conflictResolution: 'single-writer-per-key',
    transactionScope: 'single-shard',
    multiAz: true,
    failoverSec: 30,
    availability: 0.9995,
    costPerInstanceHour: 0.45,
    costPerGbMonth: 0.115,
};

function vitessScatterFanout(params: typeof vitessDefaults): number {
    return 1 + params.crossShardQueryShare * (params.shardCount - 1);
}

function vitessEffectiveShards(params: typeof vitessDefaults): number {
    const imbalance = SHARD_IMBALANCE[params.shardStrategy] ?? 1;

    return params.shardCount / (vitessScatterFanout(params) * imbalance);
}

function vitessServiceSec(params: typeof vitessDefaults, readShare: number, writeShare: number): number {
    const writeMs = params.writeServiceMs * transactionScopeCost(params.transactionScope);

    return (readShare * params.readServiceMs + writeShare * writeMs + params.vtgateLatencyMs) / 1000;
}

function vitessServingTablets(params: typeof vitessDefaults, readShare: number): number {
    return 1 + params.replicasPerShard * params.readFromReplica * readShare;
}

const vitessModel = defineModel<typeof vitessDefaults>({
    serviceSec: (ctx) => vitessServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = vitessServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const effectiveShards = vitessEffectiveShards(ctx.params);
        const shardIops = ctx.params.provisionedIops * effectiveShards;

        return [
            explicitRps('vtgate', ctx.params.vtgateInstances, ctx.params.vtgateMaxRps),
            littleLaw(
                'cpu',
                ctx.params.cpuCores * effectiveShards * vitessServingTablets(ctx.params, ctx.readShare),
                serviceSec,
            ),
            connectionBound(
                'connections',
                ctx.params.maxConnections *
                    ctx.params.shardCount *
                    poolerMultiplier(ctx.params.connectionPooler),
                ctx.params.connectionsPerQuery * vitessScatterFanout(ctx.params),
                serviceSec,
            ),
            weightedUnitBound(
                'iops',
                'provisionedIops × effectiveShards / (readShare × iopsPerRead + writeShare × iopsPerWrite)',
                {
                    provisionedIops: ctx.params.provisionedIops,
                    effectiveShards,
                    shardCount: ctx.params.shardCount,
                    scatterFanout: vitessScatterFanout(ctx.params),
                    iopsPerRead: ctx.params.iopsPerRead,
                    iopsPerWrite: ctx.params.iopsPerWrite,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                ctx.params.iopsPerRead / shardIops,
                ctx.params.iopsPerWrite / shardIops,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const copies = 1 + ctx.params.replicasPerShard;
        const bytesPerRow = ctx.params.rowSizeBytes * (1 + ctx.params.indexOverhead);
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * bytesPerRow * copies) / 1e9;
        const baseGb = (ctx.params.rowCount * bytesPerRow * copies) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'rowCount × rowSize × (1 + indexOverhead) × copies / 10⁹',
                    {
                        rowCount: ctx.params.rowCount,
                        rowSize: ctx.params.rowSizeBytes,
                        indexOverhead: ctx.params.indexOverhead,
                        copies,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × rowSize × (1 + indexOverhead) × copies / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        rowSize: ctx.params.rowSizeBytes,
                        indexOverhead: ctx.params.indexOverhead,
                        copies,
                    },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const tablets = ctx.params.shardCount * (1 + ctx.params.replicasPerShard);

        return totalCost({
            compute:
                (tablets + ctx.params.vtgateInstances) *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        });
    },
    availability: (params) => params.availability,
});

const vitess = defineComponent({
    id: 'vitess',
    group: 'sql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-sql-sharded',
    ports: SQL_PORTS,
    defaultParams: vitessDefaults,
    paramSchema: {
        shardCount: num('topology', { min: 1, max: 4096, realistic: { min: 4, max: 256 } }),
        replicasPerShard: num('topology', { min: 0, max: 10 }),
        shardKey: text('topology'),
        shardStrategy: choice('topology', SHARD_STRATEGY),
        crossShardQueryShare: num('performance', { min: 0, max: 1, step: 0.01, realistic: { min: 0, max: 0.2 } }),
        vtgateInstances: num('topology', { min: 1, max: 500 }),
        vtgateMaxRps: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 5000, max: 50000 } }),
        vtgateLatencyMs: num('performance', { unitKey: 'ms', min: 0.01, max: 100, step: 0.01, realistic: { min: 0.2, max: 2 } }),
        maxConnections: num('capacity', { min: 10, max: 20000, realistic: { min: 100, max: 1000 } }),
        connectionPooler: choice('capacity', CONNECTION_POOLER),
        connectionsPerQuery: num('capacity', { min: 0.01, max: 10, step: 0.01 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        bufferPoolGb: num('capacity', { unitKey: 'gb', min: 0.25, max: 4096, step: 0.25 }),
        storageGb: num('capacity', { unitKey: 'gb', min: 1, max: 1000000 }),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        iopsPerRead: num('capacity', { min: 0.1, max: 100, step: 0.1 }),
        iopsPerWrite: num('capacity', { min: 0.1, max: 100, step: 0.1, realistic: { min: 3, max: 8 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
        rowCount: num('data', { min: 0, max: 1000000000000 }),
        indexOverhead: num('data', { min: 0, max: 3, step: 0.1, realistic: { min: 0.2, max: 1 } }),
        workingSetGb: num('data', { unitKey: 'gb', min: 0.1, max: 100000, step: 0.1 }),
        queryProfile: choice('performance', QUERY_PROFILE),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 50, max: 2000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        readFromReplica: num('consistency', { min: 0, max: 1, step: 0.05 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        isolationLevel: choice('consistency', ISOLATION_LEVEL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        transactionScope: choice('consistency', TRANSACTION_SCOPE),
        multiAz: bool('reliability'),
        failoverSec: num('reliability', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 15, max: 120 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: vitessModel,
    helpId: 'vitess',
});

const cockroachDefaults = {
    nodes: 9,
    regions: 3,
    replicationFactor: 3,
    partitionStrategy: 'geo-partitioned',
    partitionKey: 'region',
    partitionSizeMb: 512,
    maxConnections: 500,
    connectionPooler: 'proxy-managed',
    connectionsPerQuery: 1,
    cpuCores: 16,
    maxOpsPerSecPerNode: 8000,
    storageGbPerNode: 3000,
    provisionedIops: 16000,
    iopsPerRead: 1,
    iopsPerWrite: 2,
    rowSizeBytes: 400,
    rowCount: 2000000000,
    indexOverhead: 0.4,
    queryProfile: 'point-read',
    intraAzLatencyMs: 0.5,
    crossRegionRttMs: 70,
    readServiceMs: 0.8,
    writeServiceMs: 1.5,
    consistencyModel: 'linearizable',
    replicationMode: 'sync',
    replicaLagMs: 50,
    replicaLagSigma: 0.8,
    readFromReplica: 0,
    concurrencyControl: 'optimistic',
    isolationLevel: 'serializable',
    conflictResolution: 'single-writer-per-key',
    transactionScope: 'distributed-2pc',
    multiAz: true,
    failoverSec: 10,
    availability: 0.9999,
    costPerInstanceHour: 0.7,
    costPerGbMonth: 0.1,
};

function cockroachWriteQuorum(params: typeof cockroachDefaults): number {
    return Math.floor(params.replicationFactor / 2) + 1;
}

function cockroachQuorumRttMs(params: typeof cockroachDefaults): number {
    const quorumStaysInRegion = params.partitionStrategy === 'geo-partitioned' || params.regions <= 1;

    return quorumStaysInRegion ? params.intraAzLatencyMs : params.crossRegionRttMs;
}

function cockroachWriteSec(params: typeof cockroachDefaults): number {
    return (
        ((params.writeServiceMs + cockroachQuorumRttMs(params)) *
            transactionScopeCost(params.transactionScope)) /
        1000
    );
}

function cockroachServiceSec(
    params: typeof cockroachDefaults,
    readShare: number,
    writeShare: number,
): number {
    return (readShare * params.readServiceMs) / 1000 + writeShare * cockroachWriteSec(params);
}

const cockroachModel = defineModel<typeof cockroachDefaults>({
    serviceSec: (ctx) => cockroachServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = cockroachServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const quorum = cockroachWriteQuorum(ctx.params);
        const clusterOps = ctx.params.nodes * ctx.params.maxOpsPerSecPerNode;
        const clusterIops = ctx.params.provisionedIops * ctx.params.nodes;

        return [
            weightedUnitBound(
                'raft-quorum',
                'nodes × maxOpsPerSecPerNode / (readShare + writeShare × quorum)',
                {
                    nodes: ctx.params.nodes,
                    maxOpsPerSecPerNode: ctx.params.maxOpsPerSecPerNode,
                    quorum,
                    replicationFactor: ctx.params.replicationFactor,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                1 / clusterOps,
                quorum / clusterOps,
                ctx.readShare,
                ctx.writeShare,
            ),
            littleLaw('cpu', ctx.params.nodes * ctx.params.cpuCores, serviceSec),
            connectionBound(
                'connections',
                ctx.params.maxConnections *
                    ctx.params.nodes *
                    poolerMultiplier(ctx.params.connectionPooler),
                ctx.params.connectionsPerQuery,
                serviceSec,
            ),
            weightedUnitBound(
                'iops',
                'provisionedIops × nodes / (readShare × iopsPerRead + writeShare × iopsPerWrite × RF)',
                {
                    provisionedIops: ctx.params.provisionedIops,
                    nodes: ctx.params.nodes,
                    iopsPerRead: ctx.params.iopsPerRead,
                    iopsPerWrite: ctx.params.iopsPerWrite,
                    RF: ctx.params.replicationFactor,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                ctx.params.iopsPerRead / clusterIops,
                (ctx.params.iopsPerWrite * ctx.params.replicationFactor) / clusterIops,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const factor = ctx.params.replicationFactor;
        const bytesPerRow = ctx.params.rowSizeBytes * (1 + ctx.params.indexOverhead);
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * bytesPerRow * factor) / 1e9;
        const baseGb = (ctx.params.rowCount * bytesPerRow * factor) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'rowCount × rowSize × (1 + indexOverhead) × RF / 10⁹',
                    {
                        rowCount: ctx.params.rowCount,
                        rowSize: ctx.params.rowSizeBytes,
                        indexOverhead: ctx.params.indexOverhead,
                        RF: factor,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × rowSize × (1 + indexOverhead) × RF / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        rowSize: ctx.params.rowSizeBytes,
                        indexOverhead: ctx.params.indexOverhead,
                        RF: factor,
                    },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.nodes *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const cockroach = defineComponent({
    id: 'cockroach',
    group: 'sql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-sql-distributed',
    ports: SQL_PORTS,
    defaultParams: cockroachDefaults,
    paramSchema: {
        nodes: num('topology', { min: 3, max: 1000, realistic: { min: 3, max: 100 } }),
        regions: num('topology', { min: 1, max: 20 }),
        replicationFactor: num('topology', { min: 1, max: 9, realistic: { min: 3, max: 5 } }),
        partitionStrategy: choice('topology', PARTITION_STRATEGY),
        partitionKey: text('topology'),
        partitionSizeMb: num('data', { unitKey: 'mb', min: 1, max: 8192, realistic: { min: 128, max: 1024 } }),
        maxConnections: num('capacity', { min: 10, max: 20000, realistic: { min: 100, max: 1000 } }),
        connectionPooler: choice('capacity', CONNECTION_POOLER),
        connectionsPerQuery: num('capacity', { min: 0.01, max: 10, step: 0.01 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        maxOpsPerSecPerNode: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 3000, max: 20000 } }),
        storageGbPerNode: num('capacity', { unitKey: 'gb', min: 10, max: 200000 }),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        iopsPerRead: num('capacity', { min: 0.1, max: 100, step: 0.1 }),
        iopsPerWrite: num('capacity', { min: 0.1, max: 100, step: 0.1, realistic: { min: 2, max: 6 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
        rowCount: num('data', { min: 0, max: 1000000000000 }),
        indexOverhead: num('data', { min: 0, max: 3, step: 0.1, realistic: { min: 0.2, max: 1 } }),
        queryProfile: choice('performance', QUERY_PROFILE),
        intraAzLatencyMs: num('performance', { unitKey: 'ms', min: 0.05, max: 50, step: 0.05, realistic: { min: 0.2, max: 2 } }),
        crossRegionRttMs: num('performance', { unitKey: 'ms', min: 1, max: 500, realistic: { min: 30, max: 150 } }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 10, max: 500 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        readFromReplica: num('consistency', { min: 0, max: 1, step: 0.05 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        isolationLevel: choice('consistency', ISOLATION_LEVEL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        transactionScope: choice('consistency', TRANSACTION_SCOPE),
        multiAz: bool('reliability'),
        failoverSec: num('reliability', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 5, max: 30 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: cockroachModel,
    helpId: 'cockroach',
});

export const sqlComponents: ComponentDefinition[] = [
    postgres,
    mysql,
    aurora,
    vitess,
    cockroach,
] as unknown as ComponentDefinition[];
