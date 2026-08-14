import type { ComponentDefinition, ComponentParams, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    connectionBound,
    defineModel,
    explain,
    iopsBound,
    littleLaw,
    partitionBound,
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

export const nosqlComponents: ComponentDefinition[] = [
    mongodb,
    cassandra,
    dynamodb,
] as unknown as ComponentDefinition[];
