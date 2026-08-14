import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY } from '../sim/constants';
import { bandwidthBound, defineModel, explain, littleLaw, totalCost } from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const OLAP_PORTS: PortSpec = {
    in: [{ id: 'query', protocols: ['olap'], role: 'serve' }],
    out: [{ id: 'replication', protocols: ['olap'], role: 'replicate' }],
};

const QUERY_SCAN_WINDOW_SEC = 3600;

const DISK_READ_MBS_PER_NODE = 2000;

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

export const olapComponents: ComponentDefinition[] = [clickhouse] as unknown as ComponentDefinition[];
