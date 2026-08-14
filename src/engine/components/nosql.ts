import type { ComponentDefinition, ComponentParams, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    connectionBound,
    defineModel,
    explain,
    explicitRps,
    iopsBound,
    littleLaw,
    memoryResidencyBound,
    partitionBound,
    resourceLimit,
    totalCost,
    vendorUnitBound,
    weightedUnitBound,
} from '../sim/resources';
import { bool, choice, defineComponent, num, text } from './_shared/params';

const NOSQL_PORTS: PortSpec = {
    in: [{ id: 'query', protocols: ['nosql'], role: 'serve' }],
    out: [
        { id: 'replication', protocols: ['nosql'], role: 'replicate' },
        { id: 'cdc', protocols: ['kafka'], role: 'emit' },
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

const NVME_IOPS_PER_NODE = 30000;

const IOPS_PER_CACHE_MISS = 2;

const INDEX_OVERHEAD_PER_INDEX = 0.1;

const SECONDARY_READ_SHARE: Record<string, number> = {
    primary: 0,
    'primary-preferred': 0.1,
    secondary: 1,
    nearest: 0.5,
};

const SSTABLES_PER_READ: Record<string, number> = {
    stcs: 4,
    lcs: 1.5,
    twcs: 2,
};

const RCU_READ_KB = 4;

const WCU_WRITE_KB = 1;

const EVENTUAL_READ_UNIT_SHARE = 0.5;

const GB_PER_PARTITION = 10;

const HOURS_PER_DAY = 24;

const REDIS_STORE_DATA_MEMORY_SHARE = 0.75;

const REDIS_STORE_PIPELINING_GAIN = 2;

const MEMORY_FILL_HORIZON_SEC = 3600;

const MIN_MEMORY_HEADROOM_SHARE = 0.05;

const AOF_FILE_SIZE_FACTOR = 1.5;

const PERSISTENCE_IOPS_PER_WRITE: Record<string, number> = {
    none: 0,
    rdb: 0.05,
    aof: 0.5,
    'rdb-aof': 0.55,
};

const GRAPH_NODE_BYTES = 64;

const GRAPH_EDGE_BYTES = 128;

const GRAPH_TRAVERSAL_MS_PER_RECORD = 0.01;

const GRAPH_PAGE_READS_PER_RECORD = 0.1;

const GRAPH_IOPS_PER_WRITE = 4;

const QUERY_COMPLEXITY_FACTOR: Record<string, number> = {
    'point-read': 0.05,
    neighbourhood: 1,
    'variable-length': 4,
    'shortest-path': 12,
};

const CHUNK_SCAN_IOPS = 8;

const IOPS_PER_INSERTED_ROW = 0.01;

const WAL_IOPS_PER_WRITE = 2;

const COMPRESSION_ROWS_PER_CORE_SEC = 200000;

const COMPRESSION_CPU_SHARE = 0.25;

const SERIES_SCAN_MS = 0.05;

const POINT_WRITE_MS = 0.02;

const SAMPLE_WRITE_MS = 0.005;

const IOPS_PER_SCANNED_SERIES = 0.02;

const IOPS_PER_WRITTEN_POINT = 0.002;

const TSM_COMPACTION_IOPS_PER_WRITE = 2;

const INFLUX_CACHE_MEMORY_SHARE = 0.25;

const INFLUX_CACHE_SNAPSHOT_SEC = 60;

const RETENTION_POLICY_DAYS: Record<string, number> = {
    none: 3650,
    day: 1,
    month: 30,
    year: 365,
};

const HEAD_BLOCK_SEC = 7200;

const RAFT_BASELINE_FOLLOWERS = 2;

const LEASE_KEEPALIVE_SEC = 10;

const MAX_KEEPALIVE_BUDGET_SHARE = 0.9;

const WATCHER_MEMORY_BYTES = 4096;

const LEASE_MEMORY_BYTES = 512;

const MVCC_COMPACTION_SEC = 300;

const MVCC_REVISION_OVERHEAD = 1.5;

interface ReadWriteServiceParams extends ComponentParams {
    readServiceMs: number;
    writeServiceMs: number;
}

function readWriteServiceSec(
    params: ReadWriteServiceParams,
    readShare: number,
    writeShare: number,
): number {
    return (readShare * params.readServiceMs + writeShare * params.writeServiceMs) / 1000;
}

const mongodbDefaults = {
    replicaSetSize: 3,
    shardCount: 1,
    shardKey: 'userId',
    writeConcern: 'majority',
    readPreference: 'primary',
    documentSizeKb: 4,
    documentCount: 500000000,
    indexCount: 5,
    workingSetGb: 40,
    wiredTigerCacheGb: 32,
    storageGb: 3000,
    cpuCores: 16,
    maxConnections: 1000,
    readServiceMs: 0.5,
    writeServiceMs: 1.5,
    consistencyModel: 'read-your-writes',
    replicationMode: 'semi-sync',
    replicaLagMs: 100,
    replicaLagSigma: 0.8,
    quorumN: 3,
    quorumR: 1,
    quorumW: 2,
    concurrencyControl: 'optimistic',
    conflictResolution: 'single-writer-per-key',
    availability: 0.9995,
    costPerInstanceHour: 0.55,
    costPerGbMonth: 0.115,
};

function mongodbDocumentBytes(params: typeof mongodbDefaults): number {
    return params.documentSizeKb * 1024 * (1 + params.indexCount * INDEX_OVERHEAD_PER_INDEX);
}

function mongodbCacheMissShare(params: typeof mongodbDefaults): number {
    return Math.max(0, 1 - params.wiredTigerCacheGb / params.workingSetGb);
}

const mongodbModel = defineModel<typeof mongodbDefaults>({
    serviceSec: (ctx) => readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const secondaryShare = SECONDARY_READ_SHARE[ctx.params.readPreference] ?? 0;
        const servingNodes = 1 + (ctx.params.replicaSetSize - 1) * secondaryShare;

        return [
            littleLaw('cpu', ctx.params.cpuCores * ctx.params.shardCount * servingNodes, serviceSec),
            connectionBound(
                'connections',
                ctx.params.maxConnections * ctx.params.shardCount,
                1,
                serviceSec,
            ),
            iopsBound(
                'iops',
                NVME_IOPS_PER_NODE * ctx.params.shardCount,
                mongodbCacheMissShare(ctx.params) * IOPS_PER_CACHE_MISS,
                1 + ctx.params.indexCount,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const documentBytes = mongodbDocumentBytes(ctx.params);
        const baseGb = (ctx.params.documentCount * documentBytes * ctx.params.replicaSetSize) / 1e9;
        const growthGbDay =
            (ctx.writeRps * SECONDS_PER_DAY * documentBytes * ctx.params.replicaSetSize) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: ctx.params.workingSetGb,
            explain: [
                explain(
                    'documentCount × documentBytes × replicaSetSize / 10⁹',
                    {
                        documentCount: ctx.params.documentCount,
                        documentBytes,
                        replicaSetSize: ctx.params.replicaSetSize,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × documentBytes × replicaSetSize / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        documentBytes,
                        replicaSetSize: ctx.params.replicaSetSize,
                    },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const nodes = ctx.params.replicaSetSize * ctx.params.shardCount;
        return totalCost({
            compute: nodes * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        });
    },
    availability: (params) => params.availability,
});

const mongodb = defineComponent({
    id: 'mongodb',
    group: 'nosql',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-document',
    ports: NOSQL_PORTS,
    defaultParams: mongodbDefaults,
    paramSchema: {
        replicaSetSize: num('topology', { min: 1, max: 50, realistic: { min: 3, max: 7 } }),
        shardCount: num('topology', { min: 1, max: 4096 }),
        shardKey: text('topology'),
        writeConcern: choice('consistency', ['w1', 'majority', 'all']),
        readPreference: choice('consistency', ['primary', 'primary-preferred', 'secondary', 'nearest']),
        documentSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 16384, step: 0.05 }),
        documentCount: num('data', { min: 0, max: 1000000000000 }),
        indexCount: num('data', { min: 0, max: 64 }),
        workingSetGb: num('data', { unitKey: 'gb', min: 0.1, max: 100000, step: 0.1 }),
        wiredTigerCacheGb: num('capacity', { unitKey: 'gb', min: 0.25, max: 4096, step: 0.25 }),
        storageGb: num('capacity', { unitKey: 'gb', min: 1, max: 10000000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        maxConnections: num('capacity', { min: 10, max: 200000 }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 20, max: 2000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        quorumN: num('consistency', { min: 1, max: 50 }),
        quorumR: num('consistency', { min: 1, max: 50 }),
        quorumW: num('consistency', { min: 1, max: 50 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: mongodbModel,
    helpId: 'mongodb',
});

const cassandraDefaults = {
    nodes: 6,
    replicationFactor: 3,
    partitionKey: 'userId',
    partitionSizeMb: 64,
    rowSizeBytes: 200,
    rowCount: 5000000000,
    compactionStrategy: 'stcs',
    compressionRatio: 3,
    tombstoneRatio: 0.05,
    writeAmplification: 4,
    storageGbPerNode: 2000,
    cpuCores: 16,
    maxOpsPerSecPerNode: 20000,
    readServiceMs: 1.5,
    writeServiceMs: 0.3,
    hintedHandoff: true,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 30,
    replicaLagSigma: 0.8,
    quorumN: 3,
    quorumR: 2,
    quorumW: 2,
    concurrencyControl: 'none',
    conflictResolution: 'lww',
    availability: 0.9995,
    costPerInstanceHour: 0.5,
    costPerGbMonth: 0.08,
};

function cassandraRowBytes(params: typeof cassandraDefaults): number {
    return params.rowSizeBytes / params.compressionRatio;
}

const cassandraModel = defineModel<typeof cassandraDefaults>({
    serviceSec: (ctx) => readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const nodeOpsBudget = ctx.params.nodes * ctx.params.maxOpsPerSecPerNode;
        const replicaFanout =
            ctx.readShare * ctx.params.quorumR + ctx.writeShare * ctx.params.replicationFactor;
        const sstablesPerRead = SSTABLES_PER_READ[ctx.params.compactionStrategy] ?? 1;

        return [
            weightedUnitBound(
                'node-ops',
                'nodes × maxOpsPerSecPerNode / (readShare × quorumR + writeShare × RF)',
                {
                    nodes: ctx.params.nodes,
                    maxOpsPerSecPerNode: ctx.params.maxOpsPerSecPerNode,
                    quorumR: ctx.params.quorumR,
                    RF: ctx.params.replicationFactor,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                ctx.params.quorumR / nodeOpsBudget,
                ctx.params.replicationFactor / nodeOpsBudget,
                ctx.readShare,
                ctx.writeShare,
            ),
            littleLaw('cpu', ctx.params.nodes * ctx.params.cpuCores, serviceSec * replicaFanout),
            iopsBound(
                'iops',
                NVME_IOPS_PER_NODE * ctx.params.nodes,
                ctx.params.quorumR * sstablesPerRead * (1 + ctx.params.tombstoneRatio),
                ctx.params.replicationFactor * ctx.params.writeAmplification,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const rowBytes = cassandraRowBytes(ctx.params);
        const baseGb = (ctx.params.rowCount * rowBytes * ctx.params.replicationFactor) / 1e9;
        const growthGbDay =
            (ctx.writeRps * SECONDS_PER_DAY * rowBytes * ctx.params.replicationFactor) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'rowCount × rowSize / compressionRatio × RF / 10⁹',
                    {
                        rowCount: ctx.params.rowCount,
                        rowSize: ctx.params.rowSizeBytes,
                        compressionRatio: ctx.params.compressionRatio,
                        RF: ctx.params.replicationFactor,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × rowSize / compressionRatio × RF / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        rowSize: ctx.params.rowSizeBytes,
                        compressionRatio: ctx.params.compressionRatio,
                        RF: ctx.params.replicationFactor,
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
                ctx.params.nodes * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const cassandra = defineComponent({
    id: 'cassandra',
    group: 'nosql',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-wide-column',
    ports: NOSQL_PORTS,
    defaultParams: cassandraDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 1000, realistic: { min: 3, max: 100 } }),
        replicationFactor: num('topology', { min: 1, max: 9, realistic: { min: 2, max: 3 } }),
        partitionKey: text('topology'),
        partitionSizeMb: num('data', { unitKey: 'mb', min: 0.1, max: 10000, step: 0.1, realistic: { min: 1, max: 100 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
        rowCount: num('data', { min: 0, max: 1000000000000 }),
        compactionStrategy: choice('data', ['stcs', 'lcs', 'twcs']),
        compressionRatio: num('data', { min: 1, max: 30, step: 0.1 }),
        tombstoneRatio: num('data', { min: 0, max: 1, step: 0.01 }),
        writeAmplification: num('capacity', { min: 1, max: 50, step: 0.5 }),
        storageGbPerNode: num('capacity', { unitKey: 'gb', min: 10, max: 200000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        maxOpsPerSecPerNode: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 5000, max: 50000 } }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        hintedHandoff: bool('reliability'),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 5, max: 500 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        quorumN: num('consistency', { min: 1, max: 50 }),
        quorumR: num('consistency', { min: 1, max: 50 }),
        quorumW: num('consistency', { min: 1, max: 50 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: cassandraModel,
    helpId: 'cassandra',
});

const dynamodbDefaults = {
    capacityMode: 'on-demand',
    rcu: 20000,
    wcu: 5000,
    maxRcuPerPartition: 3000,
    maxWcuPerPartition: 1000,
    partitionKey: 'userId',
    hotPartitionShare: 0.1,
    itemSizeKb: 2,
    itemCount: 1000000000,
    gsiCount: 2,
    ttlEnabled: true,
    streams: true,
    readServiceMs: 4,
    writeServiceMs: 8,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 20,
    replicaLagSigma: 0.8,
    concurrencyControl: 'optimistic',
    conflictResolution: 'lww',
    availability: 0.9999,
    costPerMillionReads: 0.125,
    costPerMillionWrites: 0.625,
    costPerGbMonth: 0.25,
};

function dynamodbUnitsPerRead(params: typeof dynamodbDefaults): number {
    const units = Math.ceil(params.itemSizeKb / RCU_READ_KB);
    return params.consistencyModel === 'linearizable' ? units : units * EVENTUAL_READ_UNIT_SHARE;
}

function dynamodbUnitsPerWrite(params: typeof dynamodbDefaults): number {
    return Math.ceil(params.itemSizeKb / WCU_WRITE_KB) * (1 + params.gsiCount);
}

function dynamodbItemBytes(params: typeof dynamodbDefaults): number {
    return params.itemSizeKb * 1024 * (1 + params.gsiCount);
}

function dynamodbPartitions(params: typeof dynamodbDefaults): number {
    const dataGb = (params.itemCount * params.itemSizeKb * 1024) / 1e9;
    return Math.max(
        1,
        Math.ceil(params.rcu / params.maxRcuPerPartition),
        Math.ceil(params.wcu / params.maxWcuPerPartition),
        Math.ceil(dataGb / GB_PER_PARTITION),
    );
}

const dynamodbModel = defineModel<typeof dynamodbDefaults>({
    serviceSec: (ctx) => readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const unitsPerRead = dynamodbUnitsPerRead(ctx.params);
        const unitsPerWrite = dynamodbUnitsPerWrite(ctx.params);
        const partitionUnitCost =
            (ctx.readShare * unitsPerRead) / ctx.params.maxRcuPerPartition +
            (ctx.writeShare * unitsPerWrite) / ctx.params.maxWcuPerPartition;

        return [
            vendorUnitBound(
                'vendor-units',
                ctx.params.rcu,
                ctx.params.wcu,
                unitsPerRead,
                unitsPerWrite,
                ctx.readShare,
                ctx.writeShare,
            ),
            partitionBound('partitions', dynamodbPartitions(ctx.params), 1 / partitionUnitCost),
            weightedUnitBound(
                'hot-partition',
                '1 / (hotPartitionShare × (readShare × unitsPerRead / maxRcuPerPartition + writeShare × unitsPerWrite / maxWcuPerPartition))',
                {
                    hotPartitionShare: ctx.params.hotPartitionShare,
                    maxRcuPerPartition: ctx.params.maxRcuPerPartition,
                    maxWcuPerPartition: ctx.params.maxWcuPerPartition,
                    unitsPerRead,
                    unitsPerWrite,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                (ctx.params.hotPartitionShare * unitsPerRead) / ctx.params.maxRcuPerPartition,
                (ctx.params.hotPartitionShare * unitsPerWrite) / ctx.params.maxWcuPerPartition,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const itemBytes = dynamodbItemBytes(ctx.params);
        const baseGb = (ctx.params.itemCount * itemBytes) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * itemBytes) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'itemCount × itemSize × (1 + gsiCount) / 10⁹',
                    {
                        itemCount: ctx.params.itemCount,
                        itemSizeKb: ctx.params.itemSizeKb,
                        gsiCount: ctx.params.gsiCount,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × itemSize × (1 + gsiCount) / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        itemSizeKb: ctx.params.itemSizeKb,
                        gsiCount: ctx.params.gsiCount,
                    },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const readsMillions = (ctx.lambda * ctx.readShare * SECONDS_PER_MONTH) / 1e6;
        const writesMillions = (ctx.lambda * ctx.writeShare * SECONDS_PER_MONTH) / 1e6;

        return totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests:
                readsMillions * ctx.params.costPerMillionReads +
                writesMillions * ctx.params.costPerMillionWrites,
        });
    },
    availability: (params) => params.availability,
});

const dynamodb = defineComponent({
    id: 'dynamodb',
    group: 'nosql',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-keyvalue',
    ports: NOSQL_PORTS,
    defaultParams: dynamodbDefaults,
    paramSchema: {
        capacityMode: choice('capacity', ['provisioned', 'on-demand']),
        rcu: num('capacity', { min: 0, max: 40000000 }),
        wcu: num('capacity', { min: 0, max: 40000000 }),
        maxRcuPerPartition: num('capacity', { min: 100, max: 100000 }),
        maxWcuPerPartition: num('capacity', { min: 100, max: 100000 }),
        partitionKey: text('topology'),
        hotPartitionShare: num('behaviour', { min: 0, max: 1, step: 0.01 }),
        itemSizeKb: num('data', { unitKey: 'kb', min: 0.1, max: 400, step: 0.1 }),
        itemCount: num('data', { min: 0, max: 1000000000000 }),
        gsiCount: num('data', { min: 0, max: 20 }),
        ttlEnabled: bool('data'),
        streams: bool('data'),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 5, max: 500 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerMillionReads: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
        costPerMillionWrites: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: dynamodbModel,
    helpId: 'dynamodb',
    managed: true,
});

const scyllaDefaults = {
    nodes: 6,
    replicationFactor: 3,
    shardsPerCore: 1,
    throughputMultiplier: 4,
    partitionKey: 'userId',
    partitionSizeMb: 64,
    rowSizeBytes: 200,
    rowCount: 5000000000,
    compactionStrategy: 'stcs',
    compressionRatio: 3,
    tombstoneRatio: 0.05,
    writeAmplification: 4,
    storageGbPerNode: 4000,
    cpuCores: 16,
    maxOpsPerSecPerNode: 20000,
    provisionedIops: 300000,
    readServiceMs: 1.5,
    writeServiceMs: 0.3,
    hintedHandoff: true,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 30,
    replicaLagSigma: 0.8,
    quorumN: 3,
    quorumR: 2,
    quorumW: 2,
    concurrencyControl: 'none',
    conflictResolution: 'lww',
    availability: 0.9995,
    costPerInstanceHour: 0.9,
    costPerGbMonth: 0.08,
};

function scyllaShardCount(params: typeof scyllaDefaults): number {
    return params.nodes * params.cpuCores * params.shardsPerCore;
}

function scyllaRowBytes(params: typeof scyllaDefaults): number {
    return params.rowSizeBytes / params.compressionRatio;
}

const scyllaModel = defineModel<typeof scyllaDefaults>({
    serviceSec: (ctx) => readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const replicaFanout =
            ctx.readShare * ctx.params.quorumR + ctx.writeShare * ctx.params.replicationFactor;
        const shards = scyllaShardCount(ctx.params);
        const nodeOpsBudget =
            ctx.params.nodes * ctx.params.maxOpsPerSecPerNode * ctx.params.throughputMultiplier;
        const sstablesPerRead = SSTABLES_PER_READ[ctx.params.compactionStrategy] ?? 1;

        return [
            resourceLimit(
                'shard-cpu',
                (shards * ctx.params.throughputMultiplier) / (serviceSec * replicaFanout),
                'nodes × cpuCores × shardsPerCore × throughputMultiplier / (S × replicaFanout)',
                {
                    nodes: ctx.params.nodes,
                    cpuCores: ctx.params.cpuCores,
                    shardsPerCore: ctx.params.shardsPerCore,
                    throughputMultiplier: ctx.params.throughputMultiplier,
                    S: serviceSec,
                    replicaFanout,
                },
            ),
            weightedUnitBound(
                'node-ops',
                'nodes × maxOpsPerSecPerNode × throughputMultiplier / (readShare × quorumR + writeShare × RF)',
                {
                    nodes: ctx.params.nodes,
                    maxOpsPerSecPerNode: ctx.params.maxOpsPerSecPerNode,
                    throughputMultiplier: ctx.params.throughputMultiplier,
                    quorumR: ctx.params.quorumR,
                    RF: ctx.params.replicationFactor,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                ctx.params.quorumR / nodeOpsBudget,
                ctx.params.replicationFactor / nodeOpsBudget,
                ctx.readShare,
                ctx.writeShare,
            ),
            iopsBound(
                'iops',
                ctx.params.provisionedIops * ctx.params.nodes,
                ctx.params.quorumR * sstablesPerRead * (1 + ctx.params.tombstoneRatio),
                ctx.params.replicationFactor * ctx.params.writeAmplification,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const rowBytes = scyllaRowBytes(ctx.params);
        const baseGb = (ctx.params.rowCount * rowBytes * ctx.params.replicationFactor) / 1e9;
        const growthGbDay =
            (ctx.writeRps * SECONDS_PER_DAY * rowBytes * ctx.params.replicationFactor) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'rowCount × rowSize / compressionRatio × RF / 10⁹',
                    {
                        rowCount: ctx.params.rowCount,
                        rowSize: ctx.params.rowSizeBytes,
                        compressionRatio: ctx.params.compressionRatio,
                        RF: ctx.params.replicationFactor,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × rowSize / compressionRatio × RF / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        rowSize: ctx.params.rowSizeBytes,
                        compressionRatio: ctx.params.compressionRatio,
                        RF: ctx.params.replicationFactor,
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
                ctx.params.nodes * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const scylla = defineComponent({
    id: 'scylla',
    group: 'nosql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-wide-column',
    ports: NOSQL_PORTS,
    defaultParams: scyllaDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 1000, realistic: { min: 3, max: 100 } }),
        replicationFactor: num('topology', { min: 1, max: 9, realistic: { min: 2, max: 3 } }),
        shardsPerCore: num('topology', { min: 1, max: 4 }),
        throughputMultiplier: num('capacity', { min: 1, max: 10, step: 0.5, realistic: { min: 3, max: 5 } }),
        partitionKey: text('topology'),
        partitionSizeMb: num('data', { unitKey: 'mb', min: 0.1, max: 10000, step: 0.1, realistic: { min: 1, max: 100 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
        rowCount: num('data', { min: 0, max: 1000000000000 }),
        compactionStrategy: choice('data', ['stcs', 'lcs', 'twcs']),
        compressionRatio: num('data', { min: 1, max: 30, step: 0.1 }),
        tombstoneRatio: num('data', { min: 0, max: 1, step: 0.01 }),
        writeAmplification: num('capacity', { min: 1, max: 50, step: 0.5 }),
        storageGbPerNode: num('capacity', { unitKey: 'gb', min: 10, max: 200000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        maxOpsPerSecPerNode: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 5000, max: 50000 } }),
        provisionedIops: num('capacity', { min: 100, max: 2000000 }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        hintedHandoff: bool('reliability'),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 5, max: 500 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        quorumN: num('consistency', { min: 1, max: 50 }),
        quorumR: num('consistency', { min: 1, max: 50 }),
        quorumW: num('consistency', { min: 1, max: 50 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: scyllaModel,
    helpId: 'scylla',
});

const redisStoreDefaults = {
    shards: 6,
    replicasPerShard: 1,
    memoryGb: 26,
    evictionPolicy: 'noeviction',
    persistence: 'aof',
    durabilityRisk: 0.02,
    keySizeBytes: 64,
    valueSizeBytes: 1024,
    overheadPerKeyBytes: 64,
    uniqueKeys: 50000000,
    maxOpsPerSec: 120000,
    maxConnections: 10000,
    pipelining: true,
    hotKeyShare: 0.05,
    provisionedIops: 20000,
    serviceTimeMs: 0.25,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 5,
    replicaLagSigma: 0.8,
    concurrencyControl: 'optimistic',
    conflictResolution: 'lww',
    availability: 0.999,
    costPerInstanceHour: 0.35,
    costPerGbMonth: 0.1,
};

function redisStoreEntryBytes(params: typeof redisStoreDefaults): number {
    return params.keySizeBytes + params.valueSizeBytes + params.overheadPerKeyBytes;
}

function redisStoreCapacityBytes(params: typeof redisStoreDefaults): number {
    return params.shards * params.memoryGb * 1e9 * REDIS_STORE_DATA_MEMORY_SHARE;
}

function redisStoreDatasetBytes(params: typeof redisStoreDefaults): number {
    return params.uniqueKeys * redisStoreEntryBytes(params);
}

function redisStoreFreeBytes(params: typeof redisStoreDefaults): number {
    const capacityBytes = redisStoreCapacityBytes(params);

    return Math.max(
        capacityBytes - redisStoreDatasetBytes(params),
        capacityBytes * MIN_MEMORY_HEADROOM_SHARE,
    );
}

function redisStoreOpsPerShard(params: typeof redisStoreDefaults): number {
    return params.maxOpsPerSec * (params.pipelining ? REDIS_STORE_PIPELINING_GAIN : 1);
}

const redisStoreModel = defineModel<typeof redisStoreDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => {
        const entryBytes = redisStoreEntryBytes(ctx.params);
        const freeBytes = redisStoreFreeBytes(ctx.params);
        const opsPerShard = redisStoreOpsPerShard(ctx.params);
        const iopsPerWrite = PERSISTENCE_IOPS_PER_WRITE[ctx.params.persistence] ?? 0;

        return [
            explicitRps('ops', ctx.params.shards, opsPerShard),
            ctx.params.evictionPolicy === 'noeviction'
                ? resourceLimit(
                      'memory',
                      freeBytes / (entryBytes * MEMORY_FILL_HORIZON_SEC * ctx.writeShare),
                      'freeBytes / (entryBytes × fillHorizonSec × writeShare)',
                      {
                          freeBytes,
                          entryBytes,
                          fillHorizonSec: MEMORY_FILL_HORIZON_SEC,
                          writeShare: ctx.writeShare,
                      },
                  )
                : null,
            connectionBound(
                'connections',
                ctx.params.maxConnections * ctx.params.shards,
                1,
                ctx.params.serviceTimeMs / 1000,
            ),
            resourceLimit('hot-key', opsPerShard / ctx.params.hotKeyShare, 'opsPerShard / hotKeyShare', {
                opsPerShard,
                hotKeyShare: ctx.params.hotKeyShare,
            }),
            iopsPerWrite > 0
                ? iopsBound(
                      'iops',
                      ctx.params.provisionedIops * ctx.params.shards,
                      0,
                      iopsPerWrite,
                      ctx.readShare,
                      ctx.writeShare,
                  )
                : null,
        ];
    },
    storage: (ctx) => {
        const entryBytes = redisStoreEntryBytes(ctx.params);
        const copies = 1 + ctx.params.replicasPerShard;
        const residentGb =
            (Math.min(redisStoreDatasetBytes(ctx.params), redisStoreCapacityBytes(ctx.params)) * copies) /
            1e9;
        const appendOnly = ctx.params.persistence === 'aof' || ctx.params.persistence === 'rdb-aof';
        const fileFactor = appendOnly ? AOF_FILE_SIZE_FACTOR : 1;
        const growthGbDay = appendOnly ? (ctx.writeRps * SECONDS_PER_DAY * entryBytes) / 1e9 : 0;

        return {
            totalGb: ctx.params.persistence === 'none' ? 0 : residentGb * fileFactor,
            growthGbDay,
            memoryGb: residentGb,
            explain: [
                explain(
                    'min(uniqueKeys × entryBytes, shards × memoryGb × dataShare) × copies × fileFactor / 10⁹',
                    {
                        uniqueKeys: ctx.params.uniqueKeys,
                        entryBytes,
                        shards: ctx.params.shards,
                        memoryGb: ctx.params.memoryGb,
                        dataShare: REDIS_STORE_DATA_MEMORY_SHARE,
                        copies,
                        fileFactor,
                        persistence: ctx.params.persistence,
                    },
                    residentGb * fileFactor,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × entryBytes / 10⁹',
                    { writeRps: ctx.writeRps, entryBytes, persistence: ctx.params.persistence },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.shards *
                (1 + ctx.params.replicasPerShard) *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const redisStore = defineComponent({
    id: 'redis-store',
    group: 'nosql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-keyvalue',
    ports: NOSQL_PORTS,
    defaultParams: redisStoreDefaults,
    paramSchema: {
        shards: num('topology', { min: 1, max: 500 }),
        replicasPerShard: num('topology', { min: 0, max: 5 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.1, max: 4096, step: 0.1 }),
        evictionPolicy: choice('behaviour', ['noeviction', 'lru', 'lfu', 'ttl', 'random']),
        persistence: choice('reliability', ['none', 'rdb', 'aof', 'rdb-aof']),
        durabilityRisk: num('reliability', { min: 0, max: 1, step: 0.01, realistic: { min: 0, max: 0.1 } }),
        keySizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 65536 }),
        valueSizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 10485760 }),
        overheadPerKeyBytes: num('data', { unitKey: 'bytes', min: 0, max: 1024, realistic: { min: 50, max: 100 } }),
        uniqueKeys: num('data', { min: 1, max: 1e12 }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 1000, max: 10000000, realistic: { min: 80000, max: 150000 } }),
        maxConnections: num('capacity', { min: 100, max: 1000000 }),
        pipelining: bool('behaviour'),
        hotKeyShare: num('behaviour', { min: 0, max: 1, step: 0.01 }),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 60000, realistic: { min: 1, max: 100 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: redisStoreModel,
    helpId: 'redis-store',
});

const neo4jDefaults = {
    nodes: 3,
    readReplicas: 2,
    nodeCount: 100000000,
    edgeCount: 500000000,
    traversalDepth: 3,
    queryComplexity: 'neighbourhood',
    cacheGb: 32,
    heapGb: 16,
    cpuCores: 16,
    provisionedIops: 30000,
    readServiceMs: 0.5,
    writeServiceMs: 2,
    readFromReplica: 0.5,
    stickyReadShare: 0,
    consistencyModel: 'read-your-writes',
    replicationMode: 'semi-sync',
    replicaLagMs: 100,
    replicaLagSigma: 0.8,
    concurrencyControl: 'pessimistic',
    conflictResolution: 'single-writer-per-key',
    availability: 0.999,
    costPerInstanceHour: 0.9,
    costPerGbMonth: 0.12,
};

function neo4jDegree(params: typeof neo4jDefaults): number {
    return params.edgeCount / Math.max(1, params.nodeCount);
}

function neo4jRecordsPerQuery(params: typeof neo4jDefaults): number {
    const complexity = QUERY_COMPLEXITY_FACTOR[params.queryComplexity] ?? 1;
    const traversed = complexity * Math.pow(neo4jDegree(params), params.traversalDepth);

    return Math.max(1, Math.min(params.nodeCount + params.edgeCount, traversed));
}

function neo4jGraphBytes(params: typeof neo4jDefaults): number {
    return params.nodeCount * GRAPH_NODE_BYTES + params.edgeCount * GRAPH_EDGE_BYTES;
}

function neo4jCacheMissShare(params: typeof neo4jDefaults): number {
    return Math.max(0, 1 - (params.cacheGb * 1e9) / Math.max(1, neo4jGraphBytes(params)));
}

function neo4jReadSec(params: typeof neo4jDefaults): number {
    return (
        (params.readServiceMs + neo4jRecordsPerQuery(params) * GRAPH_TRAVERSAL_MS_PER_RECORD) / 1000
    );
}

function neo4jServiceSec(
    params: typeof neo4jDefaults,
    readShare: number,
    writeShare: number,
): number {
    return readShare * neo4jReadSec(params) + (writeShare * params.writeServiceMs) / 1000;
}

const neo4jModel = defineModel<typeof neo4jDefaults>({
    serviceSec: (ctx) => neo4jServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const members = ctx.params.nodes + ctx.params.readReplicas;
        const readSec = neo4jReadSec(ctx.params);
        const writeSec = ctx.params.writeServiceMs / 1000;
        const serviceSec = neo4jServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const recordsPerQuery = neo4jRecordsPerQuery(ctx.params);
        const bytesPerQuery = recordsPerQuery * (GRAPH_NODE_BYTES + GRAPH_EDGE_BYTES);

        return [
            weightedUnitBound(
                'cpu',
                '1 / (readShare × readSec / ((nodes + readReplicas) × cpuCores) + writeShare × writeSec / cpuCores)',
                {
                    nodes: ctx.params.nodes,
                    readReplicas: ctx.params.readReplicas,
                    cpuCores: ctx.params.cpuCores,
                    readSec,
                    writeSec,
                    recordsPerQuery,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                readSec / (members * ctx.params.cpuCores),
                writeSec / ctx.params.cpuCores,
                ctx.readShare,
                ctx.writeShare,
            ),
            iopsBound(
                'iops',
                ctx.params.provisionedIops * members,
                recordsPerQuery * neo4jCacheMissShare(ctx.params) * GRAPH_PAGE_READS_PER_RECORD,
                GRAPH_IOPS_PER_WRITE * members,
                ctx.readShare,
                ctx.writeShare,
            ),
            resourceLimit(
                'memory',
                (ctx.params.heapGb * 1e9) / (serviceSec * bytesPerQuery),
                'heapGb × 10⁹ / (S × bytesPerQuery)',
                {
                    heapGb: ctx.params.heapGb,
                    S: serviceSec,
                    bytesPerQuery,
                    recordsPerQuery,
                    traversalDepth: ctx.params.traversalDepth,
                },
            ),
        ];
    },
    storage: (ctx) => {
        const copies = ctx.params.nodes + ctx.params.readReplicas;
        const graphGb = (neo4jGraphBytes(ctx.params) * copies) / 1e9;
        const writeBytes = GRAPH_NODE_BYTES + neo4jDegree(ctx.params) * GRAPH_EDGE_BYTES;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * writeBytes * copies) / 1e9;

        return {
            totalGb: graphGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: ctx.params.cacheGb + ctx.params.heapGb,
            explain: [
                explain(
                    '(nodeCount × nodeBytes + edgeCount × edgeBytes) × copies / 10⁹',
                    {
                        nodeCount: ctx.params.nodeCount,
                        nodeBytes: GRAPH_NODE_BYTES,
                        edgeCount: ctx.params.edgeCount,
                        edgeBytes: GRAPH_EDGE_BYTES,
                        copies,
                    },
                    graphGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × (nodeBytes + degree × edgeBytes) × copies / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        nodeBytes: GRAPH_NODE_BYTES,
                        degree: neo4jDegree(ctx.params),
                        edgeBytes: GRAPH_EDGE_BYTES,
                        copies,
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
                (ctx.params.nodes + ctx.params.readReplicas) *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const neo4j = defineComponent({
    id: 'neo4j',
    group: 'nosql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-graph',
    ports: NOSQL_PORTS,
    defaultParams: neo4jDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 50, realistic: { min: 3, max: 7 } }),
        readReplicas: num('topology', { min: 0, max: 30 }),
        nodeCount: num('data', { min: 1, max: 1000000000000 }),
        edgeCount: num('data', { min: 1, max: 1000000000000 }),
        traversalDepth: num('behaviour', { min: 1, max: 12, realistic: { min: 1, max: 4 } }),
        queryComplexity: choice('behaviour', ['point-read', 'neighbourhood', 'variable-length', 'shortest-path']),
        cacheGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 4096, step: 0.5 }),
        heapGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 1024, step: 0.5 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        readFromReplica: num('consistency', { min: 0, max: 1, step: 0.05 }),
        stickyReadShare: num('consistency', { min: 0, max: 1, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 20, max: 2000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: neo4jModel,
    helpId: 'neo4j',
});

const timescaleDefaults = {
    readReplicas: 1,
    metricsPerSec: 100000,
    insertBatchRows: 1000,
    chunkIntervalHours: 24,
    compressionAfterDays: 2,
    compressionRatio: 10,
    retentionDays: 90,
    queryRangeHours: 168,
    rowSizeBytes: 100,
    cpuCores: 16,
    maxConnections: 300,
    provisionedIops: 30000,
    readServiceMs: 5,
    writeServiceMs: 3,
    readFromReplica: 0.3,
    stickyReadShare: 0,
    consistencyModel: 'linearizable',
    replicationMode: 'async',
    replicaLagMs: 200,
    replicaLagSigma: 0.8,
    concurrencyControl: 'pessimistic',
    conflictResolution: 'single-writer-per-key',
    availability: 0.9995,
    costPerInstanceHour: 0.7,
    costPerGbMonth: 0.115,
};

function timescaleChunksScanned(params: typeof timescaleDefaults): number {
    return Math.max(1, Math.ceil(params.queryRangeHours / Math.max(1, params.chunkIntervalHours)));
}

function timescaleCompressedQueryShare(params: typeof timescaleDefaults): number {
    const uncompressedHours = params.compressionAfterDays * HOURS_PER_DAY;

    return Math.min(1, Math.max(0, 1 - uncompressedHours / Math.max(1, params.queryRangeHours)));
}

function timescaleScanFactor(params: typeof timescaleDefaults): number {
    const compressed = timescaleCompressedQueryShare(params);

    return 1 - compressed + compressed / params.compressionRatio;
}

function timescaleStorageFactor(params: typeof timescaleDefaults): number {
    const compressed =
        params.retentionDays > 0
            ? Math.max(0, (params.retentionDays - params.compressionAfterDays) / params.retentionDays)
            : 0;

    return 1 - compressed + compressed / params.compressionRatio;
}

function timescaleReadSec(params: typeof timescaleDefaults): number {
    return (params.readServiceMs * timescaleChunksScanned(params) * timescaleScanFactor(params)) / 1000;
}

function timescaleServiceSec(
    params: typeof timescaleDefaults,
    readShare: number,
    writeShare: number,
): number {
    return readShare * timescaleReadSec(params) + (writeShare * params.writeServiceMs) / 1000;
}

const timescaleModel = defineModel<typeof timescaleDefaults>({
    serviceSec: (ctx) => timescaleServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const members = 1 + ctx.params.readReplicas;
        const readSec = timescaleReadSec(ctx.params);
        const writeSec = ctx.params.writeServiceMs / 1000;
        const serviceSec = timescaleServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const chunksScanned = timescaleChunksScanned(ctx.params);
        const compressionRowsPerSec =
            ctx.params.cpuCores * COMPRESSION_ROWS_PER_CORE_SEC * COMPRESSION_CPU_SHARE;

        return [
            weightedUnitBound(
                'cpu',
                '1 / (readShare × readSec / (cpuCores × (1 + readReplicas)) + writeShare × writeSec / cpuCores)',
                {
                    cpuCores: ctx.params.cpuCores,
                    readReplicas: ctx.params.readReplicas,
                    readSec,
                    writeSec,
                    chunksScanned,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                readSec / (ctx.params.cpuCores * members),
                writeSec / ctx.params.cpuCores,
                ctx.readShare,
                ctx.writeShare,
            ),
            iopsBound(
                'iops',
                ctx.params.provisionedIops,
                chunksScanned * CHUNK_SCAN_IOPS * timescaleScanFactor(ctx.params),
                ctx.params.insertBatchRows * IOPS_PER_INSERTED_ROW + WAL_IOPS_PER_WRITE,
                ctx.readShare,
                ctx.writeShare,
            ),
            connectionBound('connections', ctx.params.maxConnections * members, 1, serviceSec),
            ctx.params.compressionAfterDays < ctx.params.retentionDays
                ? weightedUnitBound(
                      'throughput',
                      'cpuCores × compressionRowsPerCoreSec × compressionCpuShare / (writeShare × insertBatchRows)',
                      {
                          cpuCores: ctx.params.cpuCores,
                          compressionRowsPerCoreSec: COMPRESSION_ROWS_PER_CORE_SEC,
                          compressionCpuShare: COMPRESSION_CPU_SHARE,
                          insertBatchRows: ctx.params.insertBatchRows,
                          writeShare: ctx.writeShare,
                      },
                      0,
                      ctx.params.insertBatchRows / compressionRowsPerSec,
                      ctx.readShare,
                      ctx.writeShare,
                  )
                : null,
        ];
    },
    storage: (ctx) => {
        const storageFactor = timescaleStorageFactor(ctx.params);
        const rowBytes = ctx.params.rowSizeBytes * storageFactor;
        const baseGb =
            (ctx.params.metricsPerSec * SECONDS_PER_DAY * ctx.params.retentionDays * rowBytes) / 1e9;
        const growthGbDay =
            (ctx.writeRps * ctx.params.insertBatchRows * SECONDS_PER_DAY * rowBytes) / 1e9;
        const retainedDays = Math.min(ctx.horizonDays, ctx.params.retentionDays);

        return {
            totalGb: baseGb + growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'metricsPerSec × 86400 × retentionDays × rowSize × storageFactor / 10⁹',
                    {
                        metricsPerSec: ctx.params.metricsPerSec,
                        retentionDays: ctx.params.retentionDays,
                        rowSize: ctx.params.rowSizeBytes,
                        storageFactor,
                        compressionRatio: ctx.params.compressionRatio,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × insertBatchRows × 86400 × rowSize × storageFactor / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        insertBatchRows: ctx.params.insertBatchRows,
                        rowSize: ctx.params.rowSizeBytes,
                        storageFactor,
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
                (1 + ctx.params.readReplicas) *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const timescale = defineComponent({
    id: 'timescale',
    group: 'nosql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-timeseries',
    ports: NOSQL_PORTS,
    defaultParams: timescaleDefaults,
    paramSchema: {
        readReplicas: num('topology', { min: 0, max: 30 }),
        metricsPerSec: num('scale', { min: 0, max: 100000000 }),
        insertBatchRows: num('behaviour', { min: 1, max: 100000, realistic: { min: 100, max: 10000 } }),
        chunkIntervalHours: num('data', { min: 1, max: 8760, realistic: { min: 6, max: 168 } }),
        compressionAfterDays: num('data', { min: 0, max: 3650 }),
        compressionRatio: num('data', { min: 1, max: 50, step: 0.5, realistic: { min: 5, max: 20 } }),
        retentionDays: num('data', { min: 1, max: 3650 }),
        queryRangeHours: num('behaviour', { min: 1, max: 87600, realistic: { min: 1, max: 720 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 100000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        maxConnections: num('capacity', { min: 10, max: 20000, realistic: { min: 100, max: 1000 } }),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        readFromReplica: num('consistency', { min: 0, max: 1, step: 0.05 }),
        stickyReadShare: num('consistency', { min: 0, max: 1, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 50, max: 2000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: timescaleModel,
    helpId: 'timescale',
});

const influxDefaults = {
    seriesCardinality: 5000000,
    pointsPerSec: 200000,
    batchSize: 500,
    seriesPerQuery: 1000,
    retentionPolicy: 'month',
    bytesPerSample: 3,
    memoryGb: 64,
    memoryPerMillionSeriesGb: 4,
    cpuCores: 16,
    provisionedIops: 20000,
    queryServiceMs: 5,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 500,
    replicaLagSigma: 0.8,
    concurrencyControl: 'none',
    conflictResolution: 'lww',
    availability: 0.99,
    costPerInstanceHour: 0.8,
    costPerGbMonth: 0.1,
};

function influxMaxSeries(params: typeof influxDefaults): number {
    return (params.memoryGb / Math.max(0.1, params.memoryPerMillionSeriesGb)) * 1e6;
}

function influxIndexPressure(params: typeof influxDefaults): number {
    return Math.max(1, params.seriesCardinality / Math.max(1, influxMaxSeries(params)));
}

function influxReadSec(params: typeof influxDefaults): number {
    return (
        (params.queryServiceMs + params.seriesPerQuery * SERIES_SCAN_MS * influxIndexPressure(params)) /
        1000
    );
}

function influxWriteSec(params: typeof influxDefaults): number {
    return (params.batchSize * POINT_WRITE_MS * influxIndexPressure(params)) / 1000;
}

function influxRetentionDays(params: typeof influxDefaults): number {
    return RETENTION_POLICY_DAYS[params.retentionPolicy] ?? 30;
}

const influxModel = defineModel<typeof influxDefaults>({
    serviceSec: (ctx) =>
        ctx.readShare * influxReadSec(ctx.params) + ctx.writeShare * influxWriteSec(ctx.params),
    resources: (ctx) => {
        const readSec = influxReadSec(ctx.params);
        const writeSec = influxWriteSec(ctx.params);

        return [
            weightedUnitBound(
                'cardinality',
                'cpuCores / (readShare × readSec + writeShare × writeSec)',
                {
                    cpuCores: ctx.params.cpuCores,
                    readSec,
                    writeSec,
                    indexPressure: influxIndexPressure(ctx.params),
                    seriesCardinality: ctx.params.seriesCardinality,
                    maxSeries: influxMaxSeries(ctx.params),
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                readSec / ctx.params.cpuCores,
                writeSec / ctx.params.cpuCores,
                ctx.readShare,
                ctx.writeShare,
            ),
            memoryResidencyBound(
                'memory',
                ctx.params.memoryGb * INFLUX_CACHE_MEMORY_SHARE,
                (ctx.params.batchSize *
                    ctx.params.bytesPerSample *
                    INFLUX_CACHE_SNAPSHOT_SEC *
                    ctx.writeShare) /
                    1e9,
            ),
            iopsBound(
                'iops',
                ctx.params.provisionedIops,
                ctx.params.seriesPerQuery * IOPS_PER_SCANNED_SERIES,
                ctx.params.batchSize * IOPS_PER_WRITTEN_POINT + TSM_COMPACTION_IOPS_PER_WRITE,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const retentionDays = influxRetentionDays(ctx.params);
        const pointsPerSec = Math.max(ctx.params.pointsPerSec, ctx.writeRps * ctx.params.batchSize);
        const growthGbDay = (pointsPerSec * SECONDS_PER_DAY * ctx.params.bytesPerSample) / 1e9;
        const retainedDays = Math.min(ctx.horizonDays, retentionDays);

        return {
            totalGb: growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: (ctx.params.seriesCardinality / 1e6) * ctx.params.memoryPerMillionSeriesGb,
            explain: [
                explain(
                    'max(pointsPerSec, writeRps × batchSize) × 86400 × bytesPerSample / 10⁹',
                    {
                        pointsPerSec: ctx.params.pointsPerSec,
                        writeRps: ctx.writeRps,
                        batchSize: ctx.params.batchSize,
                        bytesPerSample: ctx.params.bytesPerSample,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × min(horizonDays, retentionDays)',
                    {
                        growthGbDay,
                        horizonDays: ctx.horizonDays,
                        retentionPolicy: ctx.params.retentionPolicy,
                        retentionDays,
                    },
                    growthGbDay * retainedDays,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const influx = defineComponent({
    id: 'influx',
    group: 'nosql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-timeseries',
    ports: NOSQL_PORTS,
    defaultParams: influxDefaults,
    paramSchema: {
        seriesCardinality: num('scale', { min: 1000, max: 1000000000, realistic: { min: 100000, max: 10000000 } }),
        pointsPerSec: num('scale', { min: 0, max: 100000000 }),
        batchSize: num('behaviour', { min: 1, max: 100000, realistic: { min: 100, max: 5000 } }),
        seriesPerQuery: num('behaviour', { min: 1, max: 10000000, realistic: { min: 10, max: 10000 } }),
        retentionPolicy: choice('data', ['none', 'day', 'month', 'year']),
        bytesPerSample: num('data', { unitKey: 'bytes', min: 0.5, max: 20, step: 0.1, realistic: { min: 2, max: 5 } }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 1, max: 4096 }),
        memoryPerMillionSeriesGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 64, step: 0.5 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        queryServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 100, max: 10000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: influxModel,
    helpId: 'influx',
});

const prometheusDefaults = {
    activeSeries: 10000000,
    scrapeIntervalSec: 15,
    samplesPerSec: 700000,
    bytesPerSample: 1.7,
    seriesPerQuery: 1000,
    batchSize: 500,
    retentionDays: 15,
    memoryGb: 64,
    memoryPerMillionSeriesGb: 4,
    queryConcurrency: 20,
    cpuCores: 16,
    queryServiceMs: 5,
    replicationFactor: 2,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 1000,
    replicaLagSigma: 0.8,
    concurrencyControl: 'none',
    conflictResolution: 'lww',
    availability: 0.99,
    costPerInstanceHour: 0.7,
    costPerGbMonth: 0.08,
};

function prometheusMaxSeries(params: typeof prometheusDefaults): number {
    return (params.memoryGb / Math.max(0.1, params.memoryPerMillionSeriesGb)) * 1e6;
}

function prometheusIndexPressure(params: typeof prometheusDefaults): number {
    return Math.max(1, params.activeSeries / Math.max(1, prometheusMaxSeries(params)));
}

function prometheusSeriesMemoryGb(params: typeof prometheusDefaults): number {
    return (params.activeSeries / 1e6) * params.memoryPerMillionSeriesGb;
}

function prometheusHeadroomGb(params: typeof prometheusDefaults): number {
    return Math.max(
        params.memoryGb - prometheusSeriesMemoryGb(params),
        params.memoryGb * MIN_MEMORY_HEADROOM_SHARE,
    );
}

function prometheusReadSec(params: typeof prometheusDefaults): number {
    return (
        (params.queryServiceMs +
            params.seriesPerQuery * SERIES_SCAN_MS * prometheusIndexPressure(params)) /
        1000
    );
}

function prometheusWriteSec(params: typeof prometheusDefaults): number {
    return (params.batchSize * SAMPLE_WRITE_MS * prometheusIndexPressure(params)) / 1000;
}

function prometheusServiceSec(
    params: typeof prometheusDefaults,
    readShare: number,
    writeShare: number,
): number {
    return readShare * prometheusReadSec(params) + writeShare * prometheusWriteSec(params);
}

function prometheusSamplesPerSec(params: typeof prometheusDefaults): number {
    return Math.max(params.samplesPerSec, params.activeSeries / Math.max(1, params.scrapeIntervalSec));
}

const prometheusModel = defineModel<typeof prometheusDefaults>({
    serviceSec: (ctx) => prometheusServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const readSec = prometheusReadSec(ctx.params);
        const writeSec = prometheusWriteSec(ctx.params);

        return [
            weightedUnitBound(
                'cardinality',
                'cpuCores / (readShare × readSec + writeShare × writeSec)',
                {
                    cpuCores: ctx.params.cpuCores,
                    readSec,
                    writeSec,
                    indexPressure: prometheusIndexPressure(ctx.params),
                    activeSeries: ctx.params.activeSeries,
                    maxSeries: prometheusMaxSeries(ctx.params),
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                readSec / ctx.params.cpuCores,
                writeSec / ctx.params.cpuCores,
                ctx.readShare,
                ctx.writeShare,
            ),
            memoryResidencyBound(
                'memory',
                prometheusHeadroomGb(ctx.params),
                (ctx.params.batchSize * ctx.params.bytesPerSample * HEAD_BLOCK_SEC * ctx.writeShare) / 1e9,
            ),
            littleLaw(
                'query-slots',
                ctx.params.queryConcurrency,
                prometheusServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
            ),
        ];
    },
    storage: (ctx) => {
        const samplesPerSec = prometheusSamplesPerSec(ctx.params);
        const growthGbDay =
            (samplesPerSec * SECONDS_PER_DAY * ctx.params.bytesPerSample * ctx.params.replicationFactor) /
            1e9;
        const retainedDays = Math.min(ctx.horizonDays, ctx.params.retentionDays);

        return {
            totalGb: growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: prometheusSeriesMemoryGb(ctx.params),
            explain: [
                explain(
                    'max(samplesPerSec, activeSeries / scrapeIntervalSec) × 86400 × bytesPerSample × RF / 10⁹',
                    {
                        samplesPerSec: ctx.params.samplesPerSec,
                        activeSeries: ctx.params.activeSeries,
                        scrapeIntervalSec: ctx.params.scrapeIntervalSec,
                        bytesPerSample: ctx.params.bytesPerSample,
                        RF: ctx.params.replicationFactor,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'activeSeries / 10⁶ × memoryPerMillionSeriesGb',
                    {
                        activeSeries: ctx.params.activeSeries,
                        memoryPerMillionSeriesGb: ctx.params.memoryPerMillionSeriesGb,
                    },
                    prometheusSeriesMemoryGb(ctx.params),
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.replicationFactor *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const prometheus = defineComponent({
    id: 'prometheus',
    group: 'nosql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-metrics',
    ports: NOSQL_PORTS,
    defaultParams: prometheusDefaults,
    paramSchema: {
        activeSeries: num('scale', { min: 1000, max: 1000000000, realistic: { min: 100000, max: 20000000 } }),
        scrapeIntervalSec: num('behaviour', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 10, max: 60 } }),
        samplesPerSec: num('scale', { min: 0, max: 100000000 }),
        bytesPerSample: num('data', { unitKey: 'bytes', min: 0.5, max: 20, step: 0.1, realistic: { min: 1.7, max: 2 } }),
        seriesPerQuery: num('behaviour', { min: 1, max: 10000000, realistic: { min: 10, max: 10000 } }),
        batchSize: num('behaviour', { min: 1, max: 100000, realistic: { min: 100, max: 5000 } }),
        retentionDays: num('data', { min: 1, max: 3650, realistic: { min: 7, max: 90 } }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 1, max: 4096 }),
        memoryPerMillionSeriesGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 64, step: 0.5 }),
        queryConcurrency: num('capacity', { min: 1, max: 1000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        queryServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        replicationFactor: num('reliability', { min: 1, max: 5 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 100, max: 30000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: prometheusModel,
    helpId: 'prometheus',
});

const etcdDefaults = {
    nodes: 3,
    writeQuorumMs: 10,
    batchSize: 64,
    maxDbSizeMb: 2048,
    watchers: 5000,
    leaseCount: 10000,
    uniqueKeys: 200000,
    keySizeBytes: 128,
    valueSizeBytes: 1024,
    cpuCores: 8,
    cpuShare: 0.3,
    readServiceMs: 0.5,
    writeServiceMs: 2,
    consistencyModel: 'linearizable',
    replicationMode: 'sync',
    replicaLagMs: 5,
    replicaLagSigma: 0.8,
    concurrencyControl: 'optimistic',
    conflictResolution: 'single-writer-per-key',
    availability: 0.9995,
    costPerInstanceHour: 0.3,
    costPerGbMonth: 0.1,
};

function etcdFollowerFanout(params: typeof etcdDefaults): number {
    return Math.max(1, params.nodes - 1) / RAFT_BASELINE_FOLLOWERS;
}

function etcdCommitSec(params: typeof etcdDefaults): number {
    return (
        ((params.writeQuorumMs / 1000) * etcdFollowerFanout(params)) / Math.max(1, params.batchSize)
    );
}

function etcdKeepaliveShare(params: typeof etcdDefaults): number {
    return Math.min(
        MAX_KEEPALIVE_BUDGET_SHARE,
        (params.leaseCount / LEASE_KEEPALIVE_SEC) * etcdCommitSec(params),
    );
}

function etcdWriteSec(params: typeof etcdDefaults): number {
    return etcdCommitSec(params) / (1 - etcdKeepaliveShare(params));
}

function etcdKeyValueBytes(params: typeof etcdDefaults): number {
    return params.keySizeBytes + params.valueSizeBytes;
}

function etcdHeadroomBytes(params: typeof etcdDefaults): number {
    const quotaBytes = params.maxDbSizeMb * 1e6;
    const overheadBytes =
        params.watchers * WATCHER_MEMORY_BYTES + params.leaseCount * LEASE_MEMORY_BYTES;

    return Math.max(quotaBytes - overheadBytes, quotaBytes * MIN_MEMORY_HEADROOM_SHARE);
}

function etcdReadServingNodes(params: typeof etcdDefaults): number {
    return params.consistencyModel === 'linearizable' ? 1 : params.nodes;
}

const etcdModel = defineModel<typeof etcdDefaults>({
    serviceSec: (ctx) =>
        (ctx.readShare * ctx.params.readServiceMs + ctx.writeShare * ctx.params.writeServiceMs) / 1000,
    resources: (ctx) => {
        const writeSec = etcdWriteSec(ctx.params);
        const readServingNodes = etcdReadServingNodes(ctx.params);
        const readCpuSec = (ctx.params.readServiceMs / 1000) * ctx.params.cpuShare;
        const writeCpuSec = (ctx.params.writeServiceMs / 1000) * ctx.params.cpuShare;
        const keyValueBytes = etcdKeyValueBytes(ctx.params);
        const headroomBytes = etcdHeadroomBytes(ctx.params);

        return [
            weightedUnitBound(
                'write-quorum',
                'batchSize × (1 − keepaliveShare) / (writeQuorumSec × followerFanout × writeShare)',
                {
                    nodes: ctx.params.nodes,
                    batchSize: ctx.params.batchSize,
                    writeQuorumSec: ctx.params.writeQuorumMs / 1000,
                    followerFanout: etcdFollowerFanout(ctx.params),
                    keepaliveShare: etcdKeepaliveShare(ctx.params),
                    leaseCount: ctx.params.leaseCount,
                    writeShare: ctx.writeShare,
                },
                0,
                writeSec,
                ctx.readShare,
                ctx.writeShare,
            ),
            weightedUnitBound(
                'cpu',
                '1 / (readShare × readCpuSec / (readServingNodes × cpuCores) + writeShare × writeCpuSec / cpuCores)',
                {
                    readServingNodes,
                    cpuCores: ctx.params.cpuCores,
                    cpuShare: ctx.params.cpuShare,
                    readCpuSec,
                    writeCpuSec,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                readCpuSec / (readServingNodes * ctx.params.cpuCores),
                writeCpuSec / ctx.params.cpuCores,
                ctx.readShare,
                ctx.writeShare,
            ),
            resourceLimit(
                'memory',
                headroomBytes / (keyValueBytes * MVCC_COMPACTION_SEC * ctx.writeShare),
                'headroomBytes / (keyValueBytes × compactionSec × writeShare)',
                {
                    headroomBytes,
                    keyValueBytes,
                    compactionSec: MVCC_COMPACTION_SEC,
                    watchers: ctx.params.watchers,
                    leaseCount: ctx.params.leaseCount,
                    writeShare: ctx.writeShare,
                },
            ),
        ];
    },
    storage: (ctx) => {
        const keyValueBytes = etcdKeyValueBytes(ctx.params);
        const quotaBytes = ctx.params.maxDbSizeMb * 1e6;
        const liveBytes = Math.min(
            ctx.params.uniqueKeys * keyValueBytes * MVCC_REVISION_OVERHEAD,
            quotaBytes,
        );
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * keyValueBytes * ctx.params.nodes) / 1e9;
        const projectedBytes = Math.min(
            liveBytes + ctx.writeRps * SECONDS_PER_DAY * ctx.horizonDays * keyValueBytes,
            quotaBytes,
        );
        const totalGb = (projectedBytes * ctx.params.nodes) / 1e9;

        return {
            totalGb,
            growthGbDay,
            memoryGb: liveBytes / 1e9,
            explain: [
                explain(
                    'min(uniqueKeys × (keySize + valueSize) × revisionOverhead, maxDbSizeMb × 10⁶) × nodes / 10⁹',
                    {
                        uniqueKeys: ctx.params.uniqueKeys,
                        keySize: ctx.params.keySizeBytes,
                        valueSize: ctx.params.valueSizeBytes,
                        revisionOverhead: MVCC_REVISION_OVERHEAD,
                        maxDbSizeMb: ctx.params.maxDbSizeMb,
                        nodes: ctx.params.nodes,
                    },
                    totalGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × (keySize + valueSize) × nodes / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        keySize: ctx.params.keySizeBytes,
                        valueSize: ctx.params.valueSizeBytes,
                        nodes: ctx.params.nodes,
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
                ctx.params.nodes * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const etcd = defineComponent({
    id: 'etcd',
    group: 'nosql',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-coordination',
    ports: NOSQL_PORTS,
    defaultParams: etcdDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 9, realistic: { min: 3, max: 5 } }),
        writeQuorumMs: num('performance', { unitKey: 'ms', min: 0.5, max: 5000, step: 0.5, realistic: { min: 5, max: 50 } }),
        batchSize: num('behaviour', { min: 1, max: 10000, realistic: { min: 16, max: 256 } }),
        maxDbSizeMb: num('capacity', { unitKey: 'mb', min: 64, max: 65536, realistic: { min: 2048, max: 8192 } }),
        watchers: num('scale', { min: 0, max: 10000000 }),
        leaseCount: num('scale', { min: 0, max: 10000000 }),
        uniqueKeys: num('data', { min: 1, max: 1e9 }),
        keySizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 65536 }),
        valueSizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 1572864 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        cpuShare: num('capacity', { min: 0.01, max: 1, step: 0.01 }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 1, max: 100 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: etcdModel,
    helpId: 'etcd',
});

const HFILES_PER_READ = 3;

const hbaseDefaults = {
    regionServers: 12,
    regionsPerServer: 100,
    hdfsReplication: 3,
    maxOpsPerSecPerRegion: 25,
    maxOpsPerSecPerNode: 8000,
    partitionKey: 'rowKey',
    rowSizeBytes: 200,
    rowCount: 20000000000,
    compressionRatio: 3,
    writeAmplification: 2,
    blockCacheGb: 16,
    workingSetGb: 400,
    cpuCores: 16,
    storageGbPerNode: 8000,
    readServiceMs: 2,
    writeServiceMs: 0.4,
    consistencyModel: 'linearizable',
    replicationMode: 'sync',
    replicaLagMs: 10,
    replicaLagSigma: 0.8,
    concurrencyControl: 'pessimistic',
    conflictResolution: 'single-writer-per-key',
    availability: 0.999,
    costPerInstanceHour: 0.5,
    costPerGbMonth: 0.06,
};

function hbaseRegions(params: typeof hbaseDefaults): number {
    return params.regionServers * params.regionsPerServer;
}

function hbaseBlockCacheMissShare(params: typeof hbaseDefaults): number {
    const cacheGb = params.blockCacheGb * params.regionServers;

    return Math.max(0, 1 - cacheGb / Math.max(1, params.workingSetGb));
}

function hbaseRowBytes(params: typeof hbaseDefaults): number {
    return params.rowSizeBytes / params.compressionRatio;
}

const hbaseModel = defineModel<typeof hbaseDefaults>({
    serviceSec: (ctx) => readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = readWriteServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const nodeOpsBudget = ctx.params.regionServers * ctx.params.maxOpsPerSecPerNode;

        return [
            partitionBound('regions', hbaseRegions(ctx.params), ctx.params.maxOpsPerSecPerRegion),
            weightedUnitBound(
                'node-ops',
                'regionServers × maxOpsPerSecPerNode / (readShare + writeShare × hdfsReplication)',
                {
                    regionServers: ctx.params.regionServers,
                    maxOpsPerSecPerNode: ctx.params.maxOpsPerSecPerNode,
                    hdfsReplication: ctx.params.hdfsReplication,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                1 / nodeOpsBudget,
                ctx.params.hdfsReplication / nodeOpsBudget,
                ctx.readShare,
                ctx.writeShare,
            ),
            littleLaw('cpu', ctx.params.regionServers * ctx.params.cpuCores, serviceSec),
            iopsBound(
                'iops',
                NVME_IOPS_PER_NODE * ctx.params.regionServers,
                hbaseBlockCacheMissShare(ctx.params) * HFILES_PER_READ,
                ctx.params.hdfsReplication * ctx.params.writeAmplification,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const rowBytes = hbaseRowBytes(ctx.params);
        const copies = ctx.params.hdfsReplication;
        const baseGb = (ctx.params.rowCount * rowBytes * copies) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * rowBytes * copies) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: ctx.params.blockCacheGb * ctx.params.regionServers,
            explain: [
                explain(
                    'rowCount × rowSize / compressionRatio × hdfsReplication / 10⁹',
                    {
                        rowCount: ctx.params.rowCount,
                        rowSize: ctx.params.rowSizeBytes,
                        compressionRatio: ctx.params.compressionRatio,
                        hdfsReplication: copies,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × rowSize / compressionRatio × hdfsReplication / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        rowSize: ctx.params.rowSizeBytes,
                        compressionRatio: ctx.params.compressionRatio,
                        hdfsReplication: copies,
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
                ctx.params.regionServers *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const hbase = defineComponent({
    id: 'hbase',
    group: 'nosql',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-wide-column',
    ports: NOSQL_PORTS,
    defaultParams: hbaseDefaults,
    paramSchema: {
        regionServers: num('topology', { min: 1, max: 2000, realistic: { min: 3, max: 200 } }),
        regionsPerServer: num('topology', { min: 1, max: 2000, realistic: { min: 20, max: 300 } }),
        hdfsReplication: num('topology', { min: 1, max: 9, realistic: { min: 2, max: 3 } }),
        maxOpsPerSecPerRegion: num('capacity', { unitKey: 'rps', min: 1, max: 100000, realistic: { min: 10, max: 200 } }),
        maxOpsPerSecPerNode: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 2000, max: 30000 } }),
        partitionKey: text('topology'),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
        rowCount: num('data', { min: 0, max: 1000000000000 }),
        compressionRatio: num('data', { min: 1, max: 30, step: 0.1 }),
        writeAmplification: num('capacity', { min: 1, max: 50, step: 0.5 }),
        blockCacheGb: num('capacity', { unitKey: 'gb', min: 0.25, max: 4096, step: 0.25 }),
        workingSetGb: num('data', { unitKey: 'gb', min: 0.1, max: 1000000, step: 0.1 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        storageGbPerNode: num('capacity', { unitKey: 'gb', min: 10, max: 200000 }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 1, max: 500 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: hbaseModel,
    helpId: 'hbase',
});

const COUCHBASE_METADATA_BYTES_PER_DOC = 56;

const COUCHBASE_FULL_EJECTION_METADATA_SHARE = 0.1;

const COUCHBASE_RESIDENCY_WINDOW_SEC = 600;

const couchbaseDefaults = {
    nodes: 6,
    bucketCount: 3,
    replicas: 1,
    memoryQuotaGb: 64,
    ejectionPolicy: 'value-only',
    documentSizeKb: 4,
    documentCount: 500000000,
    workingSetGb: 200,
    maxOpsPerSecPerNode: 25000,
    maxConnections: 10000,
    provisionedIops: 30000,
    writeAmplification: 2,
    readServiceMs: 0.4,
    writeServiceMs: 0.8,
    diskFetchMs: 3,
    consistencyModel: 'read-your-writes',
    replicationMode: 'semi-sync',
    replicaLagMs: 20,
    replicaLagSigma: 0.8,
    concurrencyControl: 'optimistic',
    conflictResolution: 'lww',
    availability: 0.9995,
    costPerInstanceHour: 0.6,
    costPerGbMonth: 0.1,
};

function couchbaseDocumentBytes(params: typeof couchbaseDefaults): number {
    return params.documentSizeKb * 1024;
}

function couchbaseMetadataBytes(params: typeof couchbaseDefaults): number {
    const share =
        params.ejectionPolicy === 'value-only' ? 1 : COUCHBASE_FULL_EJECTION_METADATA_SHARE;

    return params.documentCount * COUCHBASE_METADATA_BYTES_PER_DOC * share;
}

function couchbaseQuotaBytes(params: typeof couchbaseDefaults): number {
    return (params.bucketCount * params.memoryQuotaGb * 1e9) / (1 + params.replicas);
}

function couchbaseResidentBytes(params: typeof couchbaseDefaults): number {
    const quotaBytes = couchbaseQuotaBytes(params);

    return Math.max(
        quotaBytes - couchbaseMetadataBytes(params),
        quotaBytes * MIN_MEMORY_HEADROOM_SHARE,
    );
}

function couchbaseMissShare(params: typeof couchbaseDefaults): number {
    return Math.max(0, 1 - couchbaseResidentBytes(params) / (params.workingSetGb * 1e9));
}

function couchbaseReadSec(params: typeof couchbaseDefaults): number {
    return (params.readServiceMs + couchbaseMissShare(params) * params.diskFetchMs) / 1000;
}

function couchbaseServiceSec(
    params: typeof couchbaseDefaults,
    readShare: number,
    writeShare: number,
): number {
    return readShare * couchbaseReadSec(params) + (writeShare * params.writeServiceMs) / 1000;
}

const couchbaseModel = defineModel<typeof couchbaseDefaults>({
    serviceSec: (ctx) => couchbaseServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = couchbaseServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const documentBytes = couchbaseDocumentBytes(ctx.params);

        return [
            memoryResidencyBound(
                'memory',
                couchbaseResidentBytes(ctx.params) / 1e9,
                (documentBytes * COUCHBASE_RESIDENCY_WINDOW_SEC) / 1e9,
            ),
            explicitRps('ops', ctx.params.nodes, ctx.params.maxOpsPerSecPerNode),
            connectionBound(
                'connections',
                ctx.params.maxConnections * ctx.params.nodes,
                1,
                serviceSec,
            ),
            iopsBound(
                'iops',
                ctx.params.provisionedIops * ctx.params.nodes,
                couchbaseMissShare(ctx.params),
                (1 + ctx.params.replicas) * ctx.params.writeAmplification,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const documentBytes = couchbaseDocumentBytes(ctx.params);
        const copies = 1 + ctx.params.replicas;
        const baseGb = (ctx.params.documentCount * documentBytes * copies) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * documentBytes * copies) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: couchbaseResidentBytes(ctx.params) / 1e9,
            explain: [
                explain(
                    'documentCount × documentBytes × (1 + replicas) / 10⁹',
                    {
                        documentCount: ctx.params.documentCount,
                        documentBytes,
                        replicas: ctx.params.replicas,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'bucketCount × memoryQuotaGb / (1 + replicas) − documentCount × metadataBytes',
                    {
                        bucketCount: ctx.params.bucketCount,
                        memoryQuotaGb: ctx.params.memoryQuotaGb,
                        replicas: ctx.params.replicas,
                        metadataBytes: COUCHBASE_METADATA_BYTES_PER_DOC,
                        ejectionPolicy: ctx.params.ejectionPolicy,
                    },
                    couchbaseResidentBytes(ctx.params) / 1e9,
                    'gb',
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

const couchbase = defineComponent({
    id: 'couchbase',
    group: 'nosql',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-document',
    ports: NOSQL_PORTS,
    defaultParams: couchbaseDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 1000, realistic: { min: 3, max: 100 } }),
        bucketCount: num('topology', { min: 1, max: 100, realistic: { min: 1, max: 10 } }),
        replicas: num('topology', { min: 0, max: 3 }),
        memoryQuotaGb: num('capacity', { unitKey: 'gb', min: 0.1, max: 100000, step: 0.1 }),
        ejectionPolicy: choice('behaviour', ['value-only', 'full']),
        documentSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 20480, step: 0.05 }),
        documentCount: num('data', { min: 0, max: 1000000000000 }),
        workingSetGb: num('data', { unitKey: 'gb', min: 0.1, max: 1000000, step: 0.1 }),
        maxOpsPerSecPerNode: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 10000, max: 100000 } }),
        maxConnections: num('capacity', { min: 10, max: 1000000 }),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        writeAmplification: num('capacity', { min: 1, max: 50, step: 0.5 }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
        diskFetchMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05, realistic: { min: 1, max: 10 } }),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 1, max: 500 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: couchbaseModel,
    helpId: 'couchbase',
});

const TABLE_FORMAT_SHARE: Record<string, number> = {
    parquet: 0.35,
    orc: 0.32,
};

const TABLE_COMPRESSION_RATIO: Record<string, number> = {
    none: 1,
    gzip: 3.5,
    snappy: 2.2,
    zstd: 4,
};

const PARTITION_SPAN_DAYS: Record<string, number> = {
    hour: 1 / 24,
    day: 1,
    month: 30,
};

const COMPACTION_FILE_FACTOR: Record<string, number> = {
    none: 4,
    scheduled: 1.5,
    continuous: 1,
};

const COMPACTION_REWRITE_PASSES: Record<string, number> = {
    none: 0,
    scheduled: 1,
    continuous: 2,
};

const MANIFEST_ENTRIES_PER_FILE = 8000;

const OBJECT_GET_MS = 25;

const COMPACTION_MB_PER_SLOT_SEC = 50;

const s3TableDefaults = {
    rawGbPerDay: 2000,
    format: 'parquet',
    compression: 'zstd',
    partitioning: 'day',
    lifecycleDays: 365,
    fileSizeMb: 128,
    compaction: 'scheduled',
    compactionSlots: 8,
    manifestOverhead: 0.02,
    bytesScanned: 200000000,
    batchSize: 200,
    commitServiceMs: 200,
    writeServiceMs: 50,
    bandwidthGbps: 100,
    maxIngestMbs: 2000,
    availability: 0.9999,
    costPerGbMonth: 0.023,
    costPerMillionRequests: 0.4,
};

function s3TableStoredBytesPerRawByte(params: typeof s3TableDefaults): number {
    const formatShare = TABLE_FORMAT_SHARE[params.format] ?? 1;
    const compressionRatio = TABLE_COMPRESSION_RATIO[params.compression] ?? 1;

    return formatShare / compressionRatio;
}

function s3TableStoredGbPerDay(params: typeof s3TableDefaults): number {
    return params.rawGbPerDay * s3TableStoredBytesPerRawByte(params);
}

function s3TablePartitionSpanDays(params: typeof s3TableDefaults): number {
    return PARTITION_SPAN_DAYS[params.partitioning] ?? Math.max(1, params.lifecycleDays);
}

function s3TableFileFactor(params: typeof s3TableDefaults): number {
    return COMPACTION_FILE_FACTOR[params.compaction] ?? 1;
}

function s3TableFiles(params: typeof s3TableDefaults): number {
    const spanDays = s3TablePartitionSpanDays(params);
    const partitionBytes = s3TableStoredGbPerDay(params) * 1e9 * spanDays;
    const fileBytes = params.fileSizeMb * 1e6;
    const partitions = Math.max(1, Math.ceil(Math.max(1, params.lifecycleDays) / spanDays));
    const filesPerPartition = Math.max(1, Math.ceil(partitionBytes / fileBytes)) * s3TableFileFactor(params);

    return partitions * filesPerPartition;
}

function s3TableFilesScanned(params: typeof s3TableDefaults): number {
    const fileBytes = params.fileSizeMb * 1e6;
    const scanned = Math.max(1, Math.ceil(params.bytesScanned / fileBytes)) * s3TableFileFactor(params);

    return Math.min(s3TableFiles(params), scanned);
}

function s3TableManifestReads(params: typeof s3TableDefaults): number {
    const entries =
        s3TableFilesScanned(params) + s3TableFiles(params) * params.manifestOverhead;

    return 1 + Math.ceil(entries / MANIFEST_ENTRIES_PER_FILE);
}

function s3TablePlanningSec(params: typeof s3TableDefaults): number {
    return (s3TableManifestReads(params) * OBJECT_GET_MS) / 1000;
}

function s3TableScanSec(params: typeof s3TableDefaults): number {
    return params.bytesScanned / ((params.bandwidthGbps * 1e9) / 8);
}

function s3TableCommitSec(params: typeof s3TableDefaults): number {
    return params.commitServiceMs / 1000 / Math.max(1, params.batchSize);
}

function s3TableWriteSec(params: typeof s3TableDefaults): number {
    return params.writeServiceMs / 1000 + s3TableCommitSec(params);
}

function s3TableServiceSec(
    params: typeof s3TableDefaults,
    readShare: number,
    writeShare: number,
): number {
    return (
        readShare * (s3TablePlanningSec(params) + s3TableScanSec(params)) +
        writeShare * s3TableWriteSec(params)
    );
}

const s3TableModel = defineModel<typeof s3TableDefaults>({
    serviceSec: (ctx) => s3TableServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const rewritePasses = COMPACTION_REWRITE_PASSES[ctx.params.compaction] ?? 0;
        const compactionBytesPerSec =
            ctx.params.compactionSlots * COMPACTION_MB_PER_SLOT_SEC * 1e6;
        const storedBytesPerWrite = ctx.requestBytes * s3TableStoredBytesPerRawByte(ctx.params);

        return [
            weightedUnitBound(
                'manifest',
                '1 / (readShare × manifestReads × objectGetMs / 1000 + writeShare × commitServiceMs / 1000 / batchSize)',
                {
                    manifestReads: s3TableManifestReads(ctx.params),
                    objectGetMs: OBJECT_GET_MS,
                    tableFiles: s3TableFiles(ctx.params),
                    filesScanned: s3TableFilesScanned(ctx.params),
                    manifestOverhead: ctx.params.manifestOverhead,
                    commitServiceMs: ctx.params.commitServiceMs,
                    batchSize: ctx.params.batchSize,
                    readShare: ctx.readShare,
                    writeShare: ctx.writeShare,
                },
                s3TablePlanningSec(ctx.params),
                s3TableCommitSec(ctx.params),
                ctx.readShare,
                ctx.writeShare,
            ),
            rewritePasses > 0
                ? weightedUnitBound(
                      'compaction',
                      'compactionSlots × mbPerSlotSec × 10⁶ / (writeShare × storedBytesPerWrite × rewritePasses)',
                      {
                          compactionSlots: ctx.params.compactionSlots,
                          mbPerSlotSec: COMPACTION_MB_PER_SLOT_SEC,
                          storedBytesPerWrite,
                          rewritePasses,
                          compaction: ctx.params.compaction,
                          writeShare: ctx.writeShare,
                      },
                      0,
                      (storedBytesPerWrite * rewritePasses) / compactionBytesPerSec,
                      ctx.readShare,
                      ctx.writeShare,
                  )
                : null,
            bandwidthBound(
                'throughput',
                ctx.params.bandwidthGbps * 1000,
                ctx.readShare * ctx.params.bytesScanned,
            ),
            bandwidthBound(
                'ingest-bandwidth',
                ctx.params.maxIngestMbs * 8,
                ctx.writeShare * ctx.requestBytes,
            ),
        ];
    },
    storage: (ctx) => {
        const storedShare = s3TableStoredBytesPerRawByte(ctx.params);
        const writtenGbDay = (ctx.writeRps * SECONDS_PER_DAY * ctx.recordBytes * storedShare) / 1e9;
        const growthGbDay = Math.max(s3TableStoredGbPerDay(ctx.params), writtenGbDay);
        const retainedDays =
            ctx.params.lifecycleDays > 0
                ? Math.min(ctx.params.lifecycleDays, ctx.horizonDays)
                : ctx.horizonDays;
        const totalGb = growthGbDay * retainedDays * (1 + ctx.params.manifestOverhead);

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'max(rawGbPerDay, writeRps × 86400 × recordBytes / 10⁹) × formatShare / compressionRatio',
                    {
                        rawGbPerDay: ctx.params.rawGbPerDay,
                        writeRps: ctx.writeRps,
                        recordBytes: ctx.recordBytes,
                        format: ctx.params.format,
                        compression: ctx.params.compression,
                        storedShare,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × min(lifecycleDays, horizonDays) × (1 + manifestOverhead)',
                    {
                        growthGbDay,
                        lifecycleDays: ctx.params.lifecycleDays,
                        horizonDays: ctx.horizonDays,
                        manifestOverhead: ctx.params.manifestOverhead,
                        tableFiles: s3TableFiles(ctx.params),
                    },
                    totalGb,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const objectOpsPerRequest =
            ctx.readShare * (s3TableFilesScanned(ctx.params) + s3TableManifestReads(ctx.params)) +
            (ctx.writeShare * 2) / Math.max(1, ctx.params.batchSize);

        return totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth * ctx.regionCostMultiplier,
            network: 0,
            requests:
                ((ctx.lambda * objectOpsPerRequest * SECONDS_PER_MONTH) / 1e6) *
                ctx.params.costPerMillionRequests,
        });
    },
    availability: (params) => params.availability,
});

const s3Table = defineComponent({
    id: 's3-table',
    group: 'nosql',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-lakehouse',
    ports: NOSQL_PORTS,
    managed: true,
    defaultParams: s3TableDefaults,
    paramSchema: {
        rawGbPerDay: num('data', { unitKey: 'gb', min: 0, max: 10000000 }),
        format: choice('data', ['parquet', 'orc']),
        compression: choice('data', ['none', 'gzip', 'snappy', 'zstd']),
        partitioning: choice('data', ['none', 'hour', 'day', 'month']),
        lifecycleDays: num('data', { min: 0, max: 36500, realistic: { min: 30, max: 3650 } }),
        fileSizeMb: num('data', { unitKey: 'mb', min: 1, max: 8192, realistic: { min: 64, max: 512 } }),
        compaction: choice('behaviour', ['none', 'scheduled', 'continuous']),
        compactionSlots: num('capacity', { min: 0, max: 10000, realistic: { min: 2, max: 64 } }),
        manifestOverhead: num('data', { min: 0, max: 1, step: 0.01, realistic: { min: 0.01, max: 0.2 } }),
        bytesScanned: num('data', { unitKey: 'bytes', min: 1000, max: 1000000000000000 }),
        batchSize: num('behaviour', { min: 1, max: 1000000, realistic: { min: 100, max: 10000 } }),
        commitServiceMs: num('performance', { unitKey: 'ms', min: 1, max: 60000, realistic: { min: 50, max: 1000 } }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        bandwidthGbps: num('capacity', { min: 1, max: 4000 }),
        maxIngestMbs: num('capacity', { min: 1, max: 1000000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: s3TableModel,
    helpId: 's3-table',
});

export const nosqlComponents: ComponentDefinition[] = [
    mongodb,
    cassandra,
    scylla,
    dynamodb,
    redisStore,
    neo4j,
    timescale,
    influx,
    prometheus,
    etcd,
    hbase,
    couchbase,
    s3Table,
] as unknown as ComponentDefinition[];
