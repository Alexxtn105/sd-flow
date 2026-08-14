import type { ComponentDefinition, PortSpec } from '../types/component';
import { DAYS_PER_MONTH, HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explain,
    littleLaw,
    resourceLimit,
    totalCost,
} from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const OLAP_PORTS: PortSpec = {
    in: [{ id: 'query', protocols: ['olap'], role: 'serve' }],
    out: [{ id: 'replication', protocols: ['olap'], role: 'replicate' }],
};

const QUERY_SCAN_WINDOW_SEC = 3600;

const DISK_READ_MBS_PER_NODE = 2000;

const SECONDS_PER_MINUTE = 60;

const clickhouseDefaults = {
    nodes: 6,
    shards: 3,
    replicas: 2,
    rowsIngestedPerSec: 500000,
    rowSizeBytes: 300,
    insertBatchRows: 100000,
    asyncInserts: false,
    compressionRatio: 8,
    columnsTotal: 40,
    columnsScannedPerQuery: 6,
    partsPerPartition: 100,
    mergeThroughputMbs: 200,
    scanThroughputMbsPerCore: 150,
    cpuCores: 32,
    storageGbPerNode: 4000,
    queryConcurrency: 20,
    materializedViews: 3,
    ttlDays: 90,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 500,
    replicaLagSigma: 0.8,
    concurrencyControl: 'none',
    conflictResolution: 'lww',
    availability: 0.999,
    costPerInstanceHour: 0.75,
    costPerGbMonth: 0.08,
};

function clickhouseRowBytes(params: typeof clickhouseDefaults): number {
    return params.rowSizeBytes / params.compressionRatio;
}

function clickhouseScannedBytes(params: typeof clickhouseDefaults): number {
    const columnShare = Math.min(1, params.columnsScannedPerQuery / params.columnsTotal);
    return params.rowsIngestedPerSec * QUERY_SCAN_WINDOW_SEC * clickhouseRowBytes(params) * columnShare;
}

function clickhouseServiceSec(
    params: typeof clickhouseDefaults,
    readShare: number,
    writeShare: number,
): number {
    const shardScanBytesPerSec = params.shards * params.cpuCores * params.scanThroughputMbsPerCore * 1e6;
    const scanSec = clickhouseScannedBytes(params) / shardScanBytesPerSec;
    const insertSec =
        (params.insertBatchRows * clickhouseRowBytes(params)) / (params.mergeThroughputMbs * 1e6);

    return readShare * scanSec + writeShare * insertSec;
}

const clickhouseModel = defineModel<typeof clickhouseDefaults>({
    serviceSec: (ctx) => clickhouseServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const scannedBytes = ctx.readShare * clickhouseScannedBytes(ctx.params);

        return [
            bandwidthBound('disk-scan', ctx.params.nodes * DISK_READ_MBS_PER_NODE * 8, scannedBytes),
            bandwidthBound(
                'cpu',
                ctx.params.nodes * ctx.params.cpuCores * ctx.params.scanThroughputMbsPerCore * 8,
                scannedBytes,
            ),
            littleLaw(
                'query-slots',
                ctx.params.nodes * ctx.params.queryConcurrency,
                clickhouseServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
            ),
        ];
    },
    storage: (ctx) => {
        const rowBytes = clickhouseRowBytes(ctx.params);
        const rowsPerSec = Math.max(ctx.params.rowsIngestedPerSec, ctx.writeRps);
        const growthGbDay = (rowsPerSec * SECONDS_PER_DAY * rowBytes * ctx.params.replicas) / 1e9;
        const retainedDays = Math.min(ctx.horizonDays, ctx.params.ttlDays);

        return {
            totalGb: growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'rowsPerSec × 86400 × rowSize / compressionRatio × replicas / 10⁹',
                    {
                        rowsIngestedPerSec: ctx.params.rowsIngestedPerSec,
                        writeRps: ctx.writeRps,
                        rowSize: ctx.params.rowSizeBytes,
                        compressionRatio: ctx.params.compressionRatio,
                        replicas: ctx.params.replicas,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × min(horizonDays, ttlDays)',
                    {
                        growthGbDay,
                        horizonDays: ctx.horizonDays,
                        ttlDays: ctx.params.ttlDays,
                    },
                    growthGbDay * retainedDays,
                    'gb',
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

const clickhouse = defineComponent({
    id: 'clickhouse',
    group: 'olap',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-olap',
    ports: OLAP_PORTS,
    defaultParams: clickhouseDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 500, realistic: { min: 2, max: 60 } }),
        shards: num('topology', { min: 1, max: 256 }),
        replicas: num('topology', { min: 1, max: 10 }),
        rowsIngestedPerSec: num('capacity', { min: 0, max: 100000000, realistic: { min: 10000, max: 5000000 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
        insertBatchRows: num('behaviour', { min: 1, max: 10000000, realistic: { min: 10000, max: 1000000 } }),
        asyncInserts: bool('behaviour'),
        compressionRatio: num('data', { min: 1, max: 50, step: 0.5, realistic: { min: 5, max: 15 } }),
        columnsTotal: num('data', { min: 1, max: 10000 }),
        columnsScannedPerQuery: num('performance', { min: 1, max: 10000 }),
        partsPerPartition: num('behaviour', { min: 1, max: 10000, realistic: { min: 10, max: 300 } }),
        mergeThroughputMbs: num('capacity', { min: 1, max: 10000 }),
        scanThroughputMbsPerCore: num('performance', { min: 1, max: 10000, realistic: { min: 50, max: 500 } }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        storageGbPerNode: num('capacity', { unitKey: 'gb', min: 10, max: 500000 }),
        queryConcurrency: num('capacity', { min: 1, max: 1000 }),
        materializedViews: num('data', { min: 0, max: 100 }),
        ttlDays: num('data', { min: 1, max: 3650 }),
        consistencyModel: choice('consistency', [
            'linearizable',
            'sequential',
            'bounded-staleness',
            'read-your-writes',
            'monotonic',
            'eventual',
        ]),
        replicationMode: choice('consistency', ['sync', 'semi-sync', 'async']),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 100, max: 10000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', ['none', 'optimistic', 'pessimistic', 'crdt']),
        conflictResolution: choice('consistency', ['lww', 'vector-clock', 'crdt', 'single-writer-per-key', 'manual']),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: clickhouseModel,
    helpId: 'clickhouse',
});

const BIGQUERY_SLOT_SCAN_MBS = 80;

const BIGQUERY_SLOTS_PER_QUERY = 200;

const BIGQUERY_STORAGE_COMPRESSION = 4;

const PARTITION_PRUNE_SHARE: Record<string, number> = {
    none: 1,
    month: 0.5,
    day: 0.12,
    hour: 0.02,
};

const CLUSTERING_PRUNE_SHARE = 0.55;

const bigqueryDefaults = {
    bytesScannedPerQuery: 200000000000,
    queriesPerDay: 20000,
    slotCount: 2000,
    partitioning: 'day',
    clustering: true,
    maxConcurrency: 100,
    maxIngestMbs: 1000,
    writeServiceMs: 30,
    storageGb: 400000,
    availability: 0.9999,
    costPerTbScanned: 6.25,
    costPerGbMonth: 0.02,
};

function bigqueryScannedBytes(params: typeof bigqueryDefaults): number {
    const partitionShare = PARTITION_PRUNE_SHARE[params.partitioning] ?? 1;
    const clusteringShare = params.clustering ? CLUSTERING_PRUNE_SHARE : 1;

    return params.bytesScannedPerQuery * partitionShare * clusteringShare;
}

function bigqueryServiceSec(
    params: typeof bigqueryDefaults,
    readShare: number,
    writeShare: number,
): number {
    const slotScanBytesPerSec = BIGQUERY_SLOTS_PER_QUERY * BIGQUERY_SLOT_SCAN_MBS * 1e6;
    const scanSec = bigqueryScannedBytes(params) / slotScanBytesPerSec;

    return readShare * scanSec + (writeShare * params.writeServiceMs) / 1000;
}

const bigqueryModel = defineModel<typeof bigqueryDefaults>({
    serviceSec: (ctx) => bigqueryServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = bigqueryServiceSec(ctx.params, ctx.readShare, ctx.writeShare);

        return [
            littleLaw('query-slots', ctx.params.slotCount / BIGQUERY_SLOTS_PER_QUERY, serviceSec),
            littleLaw('concurrency', ctx.params.maxConcurrency, serviceSec),
            bandwidthBound(
                'ingest-bandwidth',
                ctx.params.maxIngestMbs * 8,
                ctx.writeShare * ctx.requestBytes,
            ),
        ];
    },
    storage: (ctx) => {
        const storedBytes = ctx.recordBytes / BIGQUERY_STORAGE_COMPRESSION;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * storedBytes) / 1e9;
        const totalGb = ctx.params.storageGb + growthGbDay * ctx.horizonDays;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'writeRps × 86400 × recordBytes / compression / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        recordBytes: ctx.recordBytes,
                        compression: BIGQUERY_STORAGE_COMPRESSION,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'storageGb + growthGbDay × horizonDays',
                    {
                        storageGb: ctx.params.storageGb,
                        growthGbDay,
                        horizonDays: ctx.horizonDays,
                    },
                    totalGb,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const queriesPerDay = Math.max(
            ctx.params.queriesPerDay,
            ctx.lambda * ctx.readShare * SECONDS_PER_DAY,
        );
        const scannedTbMonth =
            (bigqueryScannedBytes(ctx.params) * queriesPerDay * DAYS_PER_MONTH) / 1e12;

        return totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: scannedTbMonth * ctx.params.costPerTbScanned * ctx.regionCostMultiplier,
        });
    },
    availability: (params) => params.availability,
});

const bigquery = defineComponent({
    id: 'bigquery',
    group: 'olap',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-olap-managed',
    ports: OLAP_PORTS,
    defaultParams: bigqueryDefaults,
    paramSchema: {
        bytesScannedPerQuery: num('data', { unitKey: 'bytes', min: 1000000, max: 1000000000000000 }),
        queriesPerDay: num('capacity', { min: 0, max: 100000000, realistic: { min: 100, max: 500000 } }),
        slotCount: num('capacity', { min: 100, max: 1000000, realistic: { min: 500, max: 20000 } }),
        partitioning: choice('data', ['none', 'hour', 'day', 'month']),
        clustering: bool('data'),
        maxConcurrency: num('capacity', { min: 1, max: 10000 }),
        maxIngestMbs: num('capacity', { min: 1, max: 1000000 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        storageGb: num('capacity', { unitKey: 'gb', min: 0, max: 1000000000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerTbScanned: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: bigqueryModel,
    helpId: 'bigquery',
    managed: true,
});

const SNOWFLAKE_WAREHOUSE_CREDITS: Record<string, number> = {
    'x-small': 1,
    small: 2,
    medium: 4,
    large: 8,
    'x-large': 16,
};

const SNOWFLAKE_RESUME_SEC = 2;

const snowflakeDefaults = {
    warehouseSize: 'medium',
    creditsPerHour: 4,
    autoSuspendMin: 5,
    queryConcurrency: 8,
    queryServiceMs: 4000,
    writeServiceMs: 200,
    maxIngestMbs: 500,
    compressionRatio: 4,
    storageGb: 200000,
    availability: 0.9999,
    costPerCredit: 3,
    costPerTbMonth: 23,
};

function snowflakeWarehouseCredits(params: typeof snowflakeDefaults): number {
    return SNOWFLAKE_WAREHOUSE_CREDITS[params.warehouseSize] ?? 1;
}

function snowflakeClusters(params: typeof snowflakeDefaults): number {
    return Math.max(1, params.creditsPerHour / snowflakeWarehouseCredits(params));
}

function snowflakeSuspendedShare(params: typeof snowflakeDefaults, lambda: number): number {
    return Math.exp(-lambda * params.autoSuspendMin * SECONDS_PER_MINUTE);
}

function snowflakeServiceSec(
    params: typeof snowflakeDefaults,
    lambda: number,
    readShare: number,
    writeShare: number,
): number {
    const queryMs = params.queryServiceMs / snowflakeWarehouseCredits(params);
    const resumeSec = snowflakeSuspendedShare(params, lambda) * SNOWFLAKE_RESUME_SEC;

    return (readShare * queryMs + writeShare * params.writeServiceMs) / 1000 + resumeSec;
}

const snowflakeModel = defineModel<typeof snowflakeDefaults>({
    serviceSec: (ctx) => snowflakeServiceSec(ctx.params, ctx.lambda, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = snowflakeServiceSec(ctx.params, ctx.lambda, ctx.readShare, ctx.writeShare);
        const clusters = snowflakeClusters(ctx.params);

        return [
            resourceLimit(
                'credits',
                (clusters * ctx.params.queryConcurrency) / serviceSec,
                'creditsPerHour / warehouseCredits × queryConcurrency / S',
                {
                    creditsPerHour: ctx.params.creditsPerHour,
                    warehouseCredits: snowflakeWarehouseCredits(ctx.params),
                    queryConcurrency: ctx.params.queryConcurrency,
                    S: serviceSec,
                },
            ),
            bandwidthBound(
                'ingest-bandwidth',
                ctx.params.maxIngestMbs * 8,
                ctx.writeShare * ctx.requestBytes,
            ),
        ];
    },
    storage: (ctx) => {
        const storedBytes = ctx.recordBytes / ctx.params.compressionRatio;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * storedBytes) / 1e9;
        const totalGb = ctx.params.storageGb + growthGbDay * ctx.horizonDays;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'writeRps × 86400 × recordBytes / compressionRatio / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        recordBytes: ctx.recordBytes,
                        compressionRatio: ctx.params.compressionRatio,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'storageGb + growthGbDay × horizonDays',
                    {
                        storageGb: ctx.params.storageGb,
                        growthGbDay,
                        horizonDays: ctx.horizonDays,
                    },
                    totalGb,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const runningShare = 1 - snowflakeSuspendedShare(ctx.params, ctx.lambda);

        return totalCost({
            compute:
                ctx.params.creditsPerHour *
                ctx.params.costPerCredit *
                HOURS_PER_MONTH *
                runningShare *
                ctx.regionCostMultiplier,
            storage: (ctx.storageGb / 1000) * ctx.params.costPerTbMonth,
            network: 0,
            requests: 0,
        });
    },
    availability: (params) => params.availability,
});

const snowflake = defineComponent({
    id: 'snowflake',
    group: 'olap',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-olap',
    ports: OLAP_PORTS,
    defaultParams: snowflakeDefaults,
    paramSchema: {
        warehouseSize: choice('capacity', ['x-small', 'small', 'medium', 'large', 'x-large']),
        creditsPerHour: num('capacity', { min: 1, max: 1024, realistic: { min: 1, max: 64 } }),
        autoSuspendMin: num('behaviour', { min: 0, max: 1440, realistic: { min: 1, max: 60 } }),
        queryConcurrency: num('capacity', { min: 1, max: 1000, realistic: { min: 4, max: 20 } }),
        queryServiceMs: num('performance', { unitKey: 'ms', min: 1, max: 600000 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        maxIngestMbs: num('capacity', { min: 1, max: 1000000 }),
        compressionRatio: num('data', { min: 1, max: 50, step: 0.5, realistic: { min: 2, max: 10 } }),
        storageGb: num('capacity', { unitKey: 'gb', min: 0, max: 1000000000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerCredit: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
        costPerTbMonth: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.5 }),
    },
    model: snowflakeModel,
    helpId: 'snowflake',
    managed: true,
});

const PUSHDOWN_SCAN_SHARE = 0.25;

const TRINO_SHUFFLE_SHARE = 0.3;

const trinoDefaults = {
    workers: 10,
    cpuCores: 16,
    scanThroughputMbsPerCore: 150,
    bytesScanned: 50000000000,
    pushdown: true,
    queryConcurrency: 20,
    networkMbps: 10000,
    writeServiceMs: 100,
    availability: 0.99,
    costPerInstanceHour: 0.5,
};

function trinoScannedBytes(params: typeof trinoDefaults): number {
    return params.bytesScanned * (params.pushdown ? PUSHDOWN_SCAN_SHARE : 1);
}

function trinoScanMbs(params: typeof trinoDefaults): number {
    return params.workers * params.cpuCores * params.scanThroughputMbsPerCore;
}

function trinoServiceSec(
    params: typeof trinoDefaults,
    readShare: number,
    writeShare: number,
): number {
    const scanSec = trinoScannedBytes(params) / (trinoScanMbs(params) * 1e6);

    return readShare * scanSec + (writeShare * params.writeServiceMs) / 1000;
}

const trinoModel = defineModel<typeof trinoDefaults>({
    serviceSec: (ctx) => trinoServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const scannedBytes = ctx.readShare * trinoScannedBytes(ctx.params);
        const serviceSec = trinoServiceSec(ctx.params, ctx.readShare, ctx.writeShare);

        return [
            bandwidthBound('disk-scan', trinoScanMbs(ctx.params) * 8, scannedBytes),
            bandwidthBound(
                'network',
                ctx.params.workers * ctx.params.networkMbps,
                scannedBytes * TRINO_SHUFFLE_SHARE,
            ),
            littleLaw('query-slots', ctx.params.queryConcurrency, serviceSec),
        ];
    },
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.workers *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const trino = defineComponent({
    id: 'trino',
    group: 'olap',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-query-engine',
    ports: OLAP_PORTS,
    defaultParams: trinoDefaults,
    paramSchema: {
        workers: num('topology', { min: 1, max: 1000, realistic: { min: 2, max: 200 } }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        scanThroughputMbsPerCore: num('performance', { min: 1, max: 10000, realistic: { min: 50, max: 500 } }),
        bytesScanned: num('data', { unitKey: 'bytes', min: 1000000, max: 1000000000000000 }),
        pushdown: bool('performance'),
        queryConcurrency: num('capacity', { min: 1, max: 10000 }),
        networkMbps: num('capacity', { unitKey: 'mbps', min: 10, max: 400000 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: trinoModel,
    helpId: 'trino',
});

const COLUMNAR_FORMAT_SHARE: Record<string, number> = {
    parquet: 0.35,
    orc: 0.32,
};

const LAKE_COMPRESSION_RATIO: Record<string, number> = {
    none: 1,
    gzip: 3.5,
    snappy: 2.2,
    zstd: 4,
};

const PARTITION_SCAN_DAYS: Record<string, number> = {
    hour: 1 / 24,
    day: 1,
    month: DAYS_PER_MONTH,
};

const lakehouseDefaults = {
    rawGbPerDay: 1000,
    format: 'parquet',
    compression: 'zstd',
    partitionScheme: 'hour',
    lifecycleDays: 365,
    bandwidthGbps: 40,
    maxIngestMbs: 2000,
    queryConcurrency: 30,
    writeServiceMs: 50,
    availability: 0.9999,
    costPerGbMonth: 0.023,
    costPerMillionRequests: 0.4,
};

function lakehouseStoredGbPerDay(params: typeof lakehouseDefaults): number {
    const formatShare = COLUMNAR_FORMAT_SHARE[params.format] ?? 1;
    const compressionRatio = LAKE_COMPRESSION_RATIO[params.compression] ?? 1;

    return (params.rawGbPerDay * formatShare) / compressionRatio;
}

function lakehouseScanBytes(params: typeof lakehouseDefaults): number {
    const scanDays = PARTITION_SCAN_DAYS[params.partitionScheme] ?? Math.max(params.lifecycleDays, 1);

    return lakehouseStoredGbPerDay(params) * scanDays * 1e9;
}

function lakehouseServiceSec(
    params: typeof lakehouseDefaults,
    readShare: number,
    writeShare: number,
): number {
    const readSec = lakehouseScanBytes(params) / ((params.bandwidthGbps * 1e9) / 8);

    return readShare * readSec + (writeShare * params.writeServiceMs) / 1000;
}

const lakehouseModel = defineModel<typeof lakehouseDefaults>({
    serviceSec: (ctx) => lakehouseServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = lakehouseServiceSec(ctx.params, ctx.readShare, ctx.writeShare);

        return [
            bandwidthBound(
                'throughput',
                ctx.params.bandwidthGbps * 1000,
                ctx.readShare * lakehouseScanBytes(ctx.params),
            ),
            bandwidthBound(
                'ingest-bandwidth',
                ctx.params.maxIngestMbs * 8,
                ctx.writeShare * ctx.requestBytes,
            ),
            littleLaw('concurrency', ctx.params.queryConcurrency, serviceSec),
        ];
    },
    storage: (ctx) => {
        const formatShare = COLUMNAR_FORMAT_SHARE[ctx.params.format] ?? 1;
        const compressionRatio = LAKE_COMPRESSION_RATIO[ctx.params.compression] ?? 1;
        const writtenGbDay =
            (ctx.writeRps * SECONDS_PER_DAY * ctx.recordBytes * formatShare) / compressionRatio / 1e9;
        const growthGbDay = Math.max(lakehouseStoredGbPerDay(ctx.params), writtenGbDay);
        const retainedDays =
            ctx.params.lifecycleDays > 0
                ? Math.min(ctx.params.lifecycleDays, ctx.horizonDays)
                : ctx.horizonDays;

        return {
            totalGb: growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'max(rawGbPerDay, writeRps × 86400 × recordBytes / 10⁹) × formatShare / compressionRatio',
                    {
                        rawGbPerDay: ctx.params.rawGbPerDay,
                        writeRps: ctx.writeRps,
                        recordBytes: ctx.recordBytes,
                        formatShare,
                        compressionRatio,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × min(lifecycleDays, horizonDays)',
                    {
                        growthGbDay,
                        lifecycleDays: ctx.params.lifecycleDays,
                        horizonDays: ctx.horizonDays,
                    },
                    growthGbDay * retainedDays,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth * ctx.regionCostMultiplier,
            network: 0,
            requests: ((ctx.lambda * SECONDS_PER_MONTH) / 1e6) * ctx.params.costPerMillionRequests,
        }),
    availability: (params) => params.availability,
});

const lakehouse = defineComponent({
    id: 'lakehouse',
    group: 'olap',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-lakehouse',
    ports: OLAP_PORTS,
    defaultParams: lakehouseDefaults,
    paramSchema: {
        rawGbPerDay: num('data', { unitKey: 'gb', min: 0, max: 10000000 }),
        format: choice('data', ['parquet', 'orc']),
        compression: choice('data', ['none', 'gzip', 'snappy', 'zstd']),
        partitionScheme: choice('data', ['none', 'hour', 'day', 'month']),
        lifecycleDays: num('data', { min: 0, max: 36500, realistic: { min: 30, max: 3650 } }),
        bandwidthGbps: num('capacity', { min: 1, max: 4000 }),
        maxIngestMbs: num('capacity', { min: 1, max: 1000000 }),
        queryConcurrency: num('capacity', { min: 1, max: 10000 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: lakehouseModel,
    helpId: 'lakehouse',
    managed: true,
});

export const olapComponents: ComponentDefinition[] = [
    clickhouse,
    bigquery,
    snowflake,
    trino,
    lakehouse,
] as unknown as ComponentDefinition[];
