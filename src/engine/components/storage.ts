import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explain,
    explicitRps,
    iopsBound,
    littleLaw,
    resourceLimit,
    totalCost,
    weightedUnitBound,
} from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const STORAGE_PORTS: PortSpec = {
    in: [{ id: 'object', protocols: ['s3'], role: 'serve' }],
    out: [
        { id: 'replication', protocols: ['s3'], role: 'replicate' },
        { id: 'event', protocols: ['kafka', 'sqs'], role: 'emit' },
    ],
};

const FILE_PORTS: PortSpec = {
    in: [{ id: 'mount', protocols: ['internal'], role: 'serve' }],
    out: [],
};

const BLOCK_PORTS: PortSpec = {
    in: [{ id: 'attach', protocols: ['internal'], role: 'attach' }],
    out: [],
};

const VERSIONING_STORAGE_FACTOR = 2;

const CROSS_REGION_COPIES = 2;

const SECONDS_PER_HOUR = 3600;

const RETRIEVAL_TIER_HOURS_FACTOR: Record<string, number> = {
    expedited: 0.05,
    standard: 1,
    bulk: 4,
};

const RETRIEVAL_TIER_COST_FACTOR: Record<string, number> = {
    expedited: 10,
    standard: 1,
    bulk: 0.4,
};

const NFS_BURST_THROUGHPUT_MULTIPLIER = 3;

const VOLUME_TYPE_MAX_IOPS: Record<string, number> = {
    gp3: 16000,
    io2: 256000,
    nvme: 1000000,
};

const VOLUME_TYPE_MAX_THROUGHPUT_MBS: Record<string, number> = {
    gp3: 1000,
    io2: 4000,
    nvme: 8000,
};

function payloadBytes(
    readShare: number,
    writeShare: number,
    responseBytes: number,
    requestBytes: number,
): number {
    return readShare * responseBytes + writeShare * requestBytes;
}

const s3Defaults = {
    objectCount: 50000000,
    avgObjectSizeMb: 2,
    storageClass: 'standard',
    prefixCount: 10,
    maxGetRpsPerPrefix: 5500,
    maxPutRpsPerPrefix: 3500,
    throughputPerPrefixMbs: 400,
    firstByteLatencyMs: 30,
    multipartThresholdMb: 100,
    versioning: false,
    lifecycleDays: 90,
    crossRegionReplication: false,
    durabilityNines: 11,
    availability: 0.9999,
    costPerGbMonth: 0.023,
    costPerMillionPut: 5,
    costPerMillionGet: 0.4,
    costPerGbEgress: 0.09,
};

function s3ObjectBytes(params: typeof s3Defaults): number {
    return params.avgObjectSizeMb * 1e6;
}

function s3StorageFactor(params: typeof s3Defaults): number {
    return (
        (params.versioning ? VERSIONING_STORAGE_FACTOR : 1) *
        (params.crossRegionReplication ? CROSS_REGION_COPIES : 1)
    );
}

const s3Model = defineModel<typeof s3Defaults>({
    serviceSec: (ctx) => ctx.params.firstByteLatencyMs / 1000,
    resources: (ctx) => [
        weightedUnitBound(
            'prefix-requests',
            'prefixCount / (readShare / maxGetRpsPerPrefix + writeShare / maxPutRpsPerPrefix)',
            {
                prefixCount: ctx.params.prefixCount,
                maxGetRpsPerPrefix: ctx.params.maxGetRpsPerPrefix,
                maxPutRpsPerPrefix: ctx.params.maxPutRpsPerPrefix,
                readShare: ctx.readShare,
                writeShare: ctx.writeShare,
            },
            1 / (ctx.params.maxGetRpsPerPrefix * ctx.params.prefixCount),
            1 / (ctx.params.maxPutRpsPerPrefix * ctx.params.prefixCount),
            ctx.readShare,
            ctx.writeShare,
        ),
        bandwidthBound(
            'prefix-throughput',
            ctx.params.prefixCount * ctx.params.throughputPerPrefixMbs * 8,
            s3ObjectBytes(ctx.params),
        ),
    ],
    storage: (ctx) => {
        const objectBytes = s3ObjectBytes(ctx.params);
        const factor = s3StorageFactor(ctx.params);
        const baseGb = (ctx.params.objectCount * objectBytes * factor) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * objectBytes * factor) / 1e9;
        const retainedDays =
            ctx.params.lifecycleDays > 0 ? Math.min(ctx.params.lifecycleDays, ctx.horizonDays) : ctx.horizonDays;

        return {
            totalGb: baseGb + growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'objectCount × avgObjectSizeMb × 10⁶ × copies / 10⁹',
                    {
                        objectCount: ctx.params.objectCount,
                        avgObjectSizeMb: ctx.params.avgObjectSizeMb,
                        copies: factor,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × avgObjectSizeMb × 10⁶ × copies / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        avgObjectSizeMb: ctx.params.avgObjectSizeMb,
                        copies: factor,
                    },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const requestsMillions = (ctx.lambda * SECONDS_PER_MONTH) / 1e6;
        return totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: ctx.egressGbMonth * ctx.params.costPerGbEgress,
            requests:
                requestsMillions *
                (ctx.readShare * ctx.params.costPerMillionGet + ctx.writeShare * ctx.params.costPerMillionPut),
        });
    },
    availability: (params) => params.availability,
});

const s3 = defineComponent({
    id: 's3',
    group: 'storage',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-bucket',
    ports: STORAGE_PORTS,
    defaultParams: s3Defaults,
    paramSchema: {
        objectCount: num('data', { min: 0, max: 1000000000000 }),
        avgObjectSizeMb: num('data', { unitKey: 'mb', min: 0.001, max: 5242880, step: 0.001 }),
        storageClass: choice('data', ['standard', 'infrequent-access', 'glacier']),
        prefixCount: num('topology', { min: 1, max: 1000000 }),
        maxGetRpsPerPrefix: num('capacity', { unitKey: 'rps', min: 100, max: 100000, realistic: { min: 3000, max: 5500 } }),
        maxPutRpsPerPrefix: num('capacity', { unitKey: 'rps', min: 100, max: 100000, realistic: { min: 1000, max: 3500 } }),
        throughputPerPrefixMbs: num('capacity', { min: 1, max: 100000 }),
        firstByteLatencyMs: num('performance', { unitKey: 'ms', min: 1, max: 5000, realistic: { min: 20, max: 60 } }),
        multipartThresholdMb: num('behaviour', { unitKey: 'mb', min: 5, max: 5120 }),
        versioning: bool('data'),
        lifecycleDays: num('data', { min: 0, max: 36500 }),
        crossRegionReplication: bool('topology'),
        durabilityNines: num('reliability', { min: 6, max: 15 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
        costPerMillionPut: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
        costPerMillionGet: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
        costPerGbEgress: num('cost', { unitKey: 'usd', min: 0, max: 5, step: 0.001 }),
    },
    model: s3Model,
    helpId: 's3',
    managed: true,
});

const minioDefaults = {
    nodes: 8,
    disksPerNode: 8,
    diskSizeTb: 8,
    erasureCoding: 'ec-8-4',
    storageOverhead: 1.5,
    usableTb: 300,
    throughputGbps: 25,
    maxOpsPerSecPerNode: 5000,
    objectCount: 20000000,
    avgObjectSizeMb: 4,
    firstByteLatencyMs: 8,
    versioning: false,
    availability: 0.999,
    costPerTbMonth: 12,
};

function minioObjectBytes(params: typeof minioDefaults): number {
    return params.avgObjectSizeMb * 1e6;
}

function minioStorageFactor(params: typeof minioDefaults): number {
    return params.storageOverhead * (params.versioning ? VERSIONING_STORAGE_FACTOR : 1);
}

const minioModel = defineModel<typeof minioDefaults>({
    serviceSec: (ctx) => ctx.params.firstByteLatencyMs / 1000,
    resources: (ctx) => [
        explicitRps('node-ops', ctx.params.nodes, ctx.params.maxOpsPerSecPerNode),
        bandwidthBound('throughput', ctx.params.throughputGbps * 1000, minioObjectBytes(ctx.params)),
    ],
    storage: (ctx) => {
        const objectBytes = minioObjectBytes(ctx.params);
        const factor = minioStorageFactor(ctx.params);
        const baseGb = (ctx.params.objectCount * objectBytes * factor) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * objectBytes * factor) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'objectCount × avgObjectSizeMb × 10⁶ × storageOverhead / 10⁹',
                    {
                        objectCount: ctx.params.objectCount,
                        avgObjectSizeMb: ctx.params.avgObjectSizeMb,
                        storageOverhead: factor,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × avgObjectSizeMb × 10⁶ × storageOverhead / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        avgObjectSizeMb: ctx.params.avgObjectSizeMb,
                        storageOverhead: factor,
                    },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: (ctx.storageGb / 1000) * ctx.params.costPerTbMonth * ctx.regionCostMultiplier,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const minio = defineComponent({
    id: 'minio',
    group: 'storage',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-bucket-self',
    ports: STORAGE_PORTS,
    defaultParams: minioDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 500, realistic: { min: 4, max: 32 } }),
        disksPerNode: num('topology', { min: 1, max: 100 }),
        diskSizeTb: num('capacity', { min: 0.1, max: 100, step: 0.1 }),
        erasureCoding: choice('reliability', ['none', 'ec-4-2', 'ec-8-4', 'ec-10-6']),
        storageOverhead: num('capacity', { min: 1, max: 4, step: 0.05 }),
        usableTb: num('capacity', { min: 0.1, max: 100000, step: 0.1 }),
        throughputGbps: num('capacity', { min: 0.1, max: 400, step: 0.1 }),
        maxOpsPerSecPerNode: num('capacity', { unitKey: 'rps', min: 100, max: 1000000 }),
        objectCount: num('data', { min: 0, max: 1000000000000 }),
        avgObjectSizeMb: num('data', { unitKey: 'mb', min: 0.001, max: 5242880, step: 0.001 }),
        firstByteLatencyMs: num('performance', { unitKey: 'ms', min: 0.5, max: 5000, step: 0.5 }),
        versioning: bool('data'),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerTbMonth: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.1 }),
    },
    model: minioModel,
    helpId: 'minio',
});

const glacierDefaults = {
    objectCount: 200000000,
    avgObjectSizeMb: 16,
    retrievalTier: 'standard',
    retrievalHours: 4,
    concurrency: 200,
    throughputMbs: 500,
    minStorageDays: 90,
    availability: 0.9999,
    costPerGbMonth: 0.004,
    costPerGbRetrieval: 0.01,
};

function glacierObjectBytes(params: typeof glacierDefaults): number {
    return params.avgObjectSizeMb * 1e6;
}

function glacierRetrievalSec(params: typeof glacierDefaults): number {
    const tierFactor = RETRIEVAL_TIER_HOURS_FACTOR[params.retrievalTier] ?? 1;
    return params.retrievalHours * tierFactor * SECONDS_PER_HOUR;
}

function glacierRetrievalPricePerGb(params: typeof glacierDefaults): number {
    return params.costPerGbRetrieval * (RETRIEVAL_TIER_COST_FACTOR[params.retrievalTier] ?? 1);
}

const glacierModel = defineModel<typeof glacierDefaults>({
    serviceSec: (ctx) => glacierRetrievalSec(ctx.params),
    resources: (ctx) => [
        littleLaw('retrieval', ctx.params.concurrency, glacierRetrievalSec(ctx.params)),
        bandwidthBound('throughput', ctx.params.throughputMbs * 8, glacierObjectBytes(ctx.params)),
    ],
    storage: (ctx) => {
        const objectBytes = glacierObjectBytes(ctx.params);
        const baseGb = (ctx.params.objectCount * objectBytes) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * objectBytes) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'objectCount × avgObjectSizeMb × 10⁶ / 10⁹',
                    {
                        objectCount: ctx.params.objectCount,
                        avgObjectSizeMb: ctx.params.avgObjectSizeMb,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × avgObjectSizeMb × 10⁶ / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        avgObjectSizeMb: ctx.params.avgObjectSizeMb,
                    },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const objectBytes = glacierObjectBytes(ctx.params);
        const archivedGbDay = (ctx.lambda * ctx.writeShare * SECONDS_PER_DAY * objectBytes) / 1e9;
        const minimumDurationGb = archivedGbDay * ctx.params.minStorageDays;
        const retrievedGbMonth = (ctx.lambda * ctx.readShare * SECONDS_PER_MONTH * objectBytes) / 1e9;

        return totalCost({
            compute: 0,
            storage: Math.max(ctx.storageGb, minimumDurationGb) * ctx.params.costPerGbMonth,
            network: 0,
            requests: retrievedGbMonth * glacierRetrievalPricePerGb(ctx.params),
        });
    },
    availability: (params) => params.availability,
});

const glacier = defineComponent({
    id: 'glacier',
    group: 'storage',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-archive',
    ports: STORAGE_PORTS,
    defaultParams: glacierDefaults,
    paramSchema: {
        objectCount: num('data', { min: 0, max: 1000000000000 }),
        avgObjectSizeMb: num('data', { unitKey: 'mb', min: 0.001, max: 5242880, step: 0.001 }),
        retrievalTier: choice('behaviour', ['expedited', 'standard', 'bulk']),
        retrievalHours: num('performance', { min: 0.05, max: 48, step: 0.05, realistic: { min: 1, max: 12 } }),
        concurrency: num('capacity', { min: 1, max: 100000 }),
        throughputMbs: num('capacity', { min: 1, max: 100000 }),
        minStorageDays: num('data', { min: 0, max: 3650, realistic: { min: 90, max: 180 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
        costPerGbRetrieval: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: glacierModel,
    helpId: 'glacier',
    managed: true,
});

const nfsDefaults = {
    storageGb: 20000,
    throughputMbs: 300,
    burstCredits: 2100000,
    provisionedIops: 35000,
    iopsPerRead: 1,
    iopsPerWrite: 2,
    latencyMs: 2.5,
    availability: 0.9999,
    costPerGbMonth: 0.3,
};

function nfsSustainedMbs(params: typeof nfsDefaults): number {
    return Math.min(
        params.throughputMbs * NFS_BURST_THROUGHPUT_MULTIPLIER,
        params.throughputMbs + params.burstCredits / SECONDS_PER_DAY,
    );
}

const nfsModel = defineModel<typeof nfsDefaults>({
    serviceSec: (ctx) => ctx.params.latencyMs / 1000,
    resources: (ctx) => [
        iopsBound(
            'iops',
            ctx.params.provisionedIops,
            ctx.params.iopsPerRead,
            ctx.params.iopsPerWrite,
            ctx.readShare,
            ctx.writeShare,
        ),
        bandwidthBound(
            'throughput',
            nfsSustainedMbs(ctx.params) * 8,
            payloadBytes(ctx.readShare, ctx.writeShare, ctx.responseBytes, ctx.requestBytes),
        ),
    ],
    storage: (ctx) => {
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * ctx.requestBytes) / 1e9;
        const totalGb = ctx.params.storageGb + growthGbDay * ctx.horizonDays;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'writeRps × 86400 × requestBytes / 10⁹',
                    { writeRps: ctx.writeRps, requestBytes: ctx.requestBytes },
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
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth * ctx.regionCostMultiplier,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const nfs = defineComponent({
    id: 'nfs',
    group: 'storage',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-file-share',
    ports: FILE_PORTS,
    defaultParams: nfsDefaults,
    paramSchema: {
        storageGb: num('capacity', { unitKey: 'gb', min: 1, max: 100000000 }),
        throughputMbs: num('capacity', { min: 1, max: 100000, realistic: { min: 50, max: 3000 } }),
        burstCredits: num('capacity', { min: 0, max: 1000000000 }),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        iopsPerRead: num('capacity', { min: 0.1, max: 100, step: 0.1 }),
        iopsPerWrite: num('capacity', { min: 0.1, max: 100, step: 0.1, realistic: { min: 1, max: 4 } }),
        latencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 500, step: 0.1, realistic: { min: 1, max: 5 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: nfsModel,
    helpId: 'nfs',
    managed: true,
});

const blockDefaults = {
    diskGb: 2000,
    volumeType: 'gp3',
    provisionedIops: 12000,
    throughputMbs: 500,
    iopsPerRead: 1,
    iopsPerWrite: 2,
    latencyUs: 200,
    availability: 0.999,
    costPerGbMonth: 0.08,
};

function blockIops(params: typeof blockDefaults): number {
    return Math.min(params.provisionedIops, VOLUME_TYPE_MAX_IOPS[params.volumeType] ?? params.provisionedIops);
}

function blockThroughputMbs(params: typeof blockDefaults): number {
    return Math.min(
        params.throughputMbs,
        VOLUME_TYPE_MAX_THROUGHPUT_MBS[params.volumeType] ?? params.throughputMbs,
    );
}

const blockModel = defineModel<typeof blockDefaults>({
    serviceSec: (ctx) => ctx.params.latencyUs / 1e6,
    resources: (ctx) => [
        iopsBound(
            'iops',
            blockIops(ctx.params),
            ctx.params.iopsPerRead,
            ctx.params.iopsPerWrite,
            ctx.readShare,
            ctx.writeShare,
        ),
        bandwidthBound(
            'throughput',
            blockThroughputMbs(ctx.params) * 8,
            payloadBytes(ctx.readShare, ctx.writeShare, ctx.responseBytes, ctx.requestBytes),
        ),
    ],
    storage: (ctx) => {
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * ctx.requestBytes) / 1e9;

        return {
            totalGb: ctx.params.diskGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain('diskGb', { diskGb: ctx.params.diskGb }, ctx.params.diskGb, 'gb'),
                explain(
                    'writeRps × 86400 × requestBytes / 10⁹',
                    { writeRps: ctx.writeRps, requestBytes: ctx.requestBytes },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth * ctx.regionCostMultiplier,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const block = defineComponent({
    id: 'block',
    group: 'storage',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-block-device',
    ports: BLOCK_PORTS,
    defaultParams: blockDefaults,
    paramSchema: {
        diskGb: num('capacity', { unitKey: 'gb', min: 1, max: 100000 }),
        volumeType: choice('capacity', ['gp3', 'io2', 'nvme']),
        provisionedIops: num('capacity', { min: 100, max: 1000000 }),
        throughputMbs: num('capacity', { min: 1, max: 100000, realistic: { min: 125, max: 4000 } }),
        iopsPerRead: num('capacity', { min: 0.1, max: 100, step: 0.1 }),
        iopsPerWrite: num('capacity', { min: 0.1, max: 100, step: 0.1, realistic: { min: 1, max: 4 } }),
        latencyUs: num('performance', { min: 10, max: 20000, realistic: { min: 100, max: 500 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: blockModel,
    helpId: 'block',
});

const NAMENODE_BYTES_PER_INODE = 150;

const NAMENODE_BYTES_PER_BLOCK = 150;

const NAMENODE_BYTES_PER_REPLICA = 16;

const MIN_HEAP_GB = 1e-6;

const hdfsDefaults = {
    nodes: 20,
    blockSizeMb: 128,
    replication: 3,
    fileCount: 80000000,
    avgFileSizeMb: 256,
    namenodeMemoryGb: 64,
    namenodeHandlers: 64,
    namenodeServiceMs: 1,
    metadataOpsPerRead: 1,
    metadataOpsPerWrite: 3,
    throughputMbsPerNode: 500,
    storageGbPerNode: 8000,
    latencyMs: 8,
    availability: 0.999,
    costPerInstanceHour: 0.4,
};

function hdfsBlocksPerFile(params: typeof hdfsDefaults): number {
    return Math.max(1, Math.ceil(params.avgFileSizeMb / params.blockSizeMb));
}

function hdfsNamenodeBytesPerFile(params: typeof hdfsDefaults): number {
    return (
        NAMENODE_BYTES_PER_INODE +
        hdfsBlocksPerFile(params) *
            (NAMENODE_BYTES_PER_BLOCK + params.replication * NAMENODE_BYTES_PER_REPLICA)
    );
}

function hdfsNamenodeHeapGb(params: typeof hdfsDefaults): number {
    return (params.fileCount * hdfsNamenodeBytesPerFile(params)) / 1e9;
}

function hdfsNamenodeResidentShare(params: typeof hdfsDefaults): number {
    return Math.min(1, params.namenodeMemoryGb / Math.max(hdfsNamenodeHeapGb(params), MIN_HEAP_GB));
}

function hdfsMetadataOpsPerRequest(
    params: typeof hdfsDefaults,
    readShare: number,
    writeShare: number,
): number {
    return readShare * params.metadataOpsPerRead + writeShare * params.metadataOpsPerWrite;
}

function hdfsServiceSec(params: typeof hdfsDefaults, readShare: number, writeShare: number): number {
    const metadataMs =
        params.namenodeServiceMs * hdfsMetadataOpsPerRequest(params, readShare, writeShare);

    return (params.latencyMs + metadataMs) / 1000;
}

const hdfsModel = defineModel<typeof hdfsDefaults>({
    serviceSec: (ctx) => hdfsServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const metadataOps = hdfsMetadataOpsPerRequest(ctx.params, ctx.readShare, ctx.writeShare);
        const residentShare = hdfsNamenodeResidentShare(ctx.params);
        const namenodeServiceSec = (ctx.params.namenodeServiceMs * metadataOps) / 1000;

        return [
            resourceLimit(
                'namenode-metadata',
                (ctx.params.namenodeHandlers * residentShare) / namenodeServiceSec,
                'namenodeHandlers × min(1, namenodeMemoryGb / namenodeHeapGb) / (namenodeServiceSec × metadataOps)',
                {
                    namenodeHandlers: ctx.params.namenodeHandlers,
                    namenodeMemoryGb: ctx.params.namenodeMemoryGb,
                    namenodeHeapGb: hdfsNamenodeHeapGb(ctx.params),
                    namenodeServiceMs: ctx.params.namenodeServiceMs,
                    metadataOps,
                },
            ),
            bandwidthBound(
                'throughput',
                ctx.params.nodes * ctx.params.throughputMbsPerNode * 8,
                ctx.readShare * ctx.responseBytes + ctx.writeShare * ctx.requestBytes * ctx.params.replication,
            ),
        ];
    },
    storage: (ctx) => {
        const fileBytes = ctx.params.avgFileSizeMb * 1e6;
        const baseGb = (ctx.params.fileCount * fileBytes * ctx.params.replication) / 1e9;
        const growthGbDay =
            (ctx.writeRps * SECONDS_PER_DAY * ctx.requestBytes * ctx.params.replication) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: Math.min(hdfsNamenodeHeapGb(ctx.params), ctx.params.namenodeMemoryGb),
            explain: [
                explain(
                    'fileCount × avgFileSizeMb × 10⁶ × replication / 10⁹',
                    {
                        fileCount: ctx.params.fileCount,
                        avgFileSizeMb: ctx.params.avgFileSizeMb,
                        replication: ctx.params.replication,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × requestBytes × replication / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        requestBytes: ctx.requestBytes,
                        replication: ctx.params.replication,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'fileCount × (inodeBytes + blocksPerFile × (blockBytes + replication × replicaBytes)) / 10⁹',
                    {
                        fileCount: ctx.params.fileCount,
                        inodeBytes: NAMENODE_BYTES_PER_INODE,
                        blocksPerFile: hdfsBlocksPerFile(ctx.params),
                        blockBytes: NAMENODE_BYTES_PER_BLOCK,
                        replicaBytes: NAMENODE_BYTES_PER_REPLICA,
                        replication: ctx.params.replication,
                    },
                    hdfsNamenodeHeapGb(ctx.params),
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.nodes * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const hdfs = defineComponent({
    id: 'hdfs',
    group: 'storage',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-bucket-self',
    ports: FILE_PORTS,
    defaultParams: hdfsDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 10000, realistic: { min: 3, max: 500 } }),
        blockSizeMb: num('data', { unitKey: 'mb', min: 1, max: 4096, realistic: { min: 64, max: 512 } }),
        replication: num('reliability', { min: 1, max: 10, realistic: { min: 2, max: 3 } }),
        fileCount: num('data', { min: 0, max: 10000000000 }),
        avgFileSizeMb: num('data', { unitKey: 'mb', min: 0.001, max: 1048576, step: 0.001 }),
        namenodeMemoryGb: num('capacity', { unitKey: 'gb', min: 1, max: 4096, realistic: { min: 16, max: 256 } }),
        namenodeHandlers: num('capacity', { min: 1, max: 5000, realistic: { min: 32, max: 512 } }),
        namenodeServiceMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        metadataOpsPerRead: num('performance', { min: 0.1, max: 100, step: 0.1 }),
        metadataOpsPerWrite: num('performance', { min: 0.1, max: 100, step: 0.1, realistic: { min: 2, max: 6 } }),
        throughputMbsPerNode: num('capacity', { min: 1, max: 100000, realistic: { min: 100, max: 2000 } }),
        storageGbPerNode: num('capacity', { unitKey: 'gb', min: 10, max: 500000 }),
        latencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 5000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: hdfsModel,
    helpId: 'hdfs',
});

const ftpLegacyDefaults = {
    throughputMbs: 100,
    perSessionMbs: 10,
    concurrency: 50,
    avgFileSizeMb: 8,
    storageGb: 4000,
    latencyMs: 40,
    availability: 0.99,
    costPerInstanceHour: 0.1,
    costPerGbMonth: 0.1,
};

function ftpLegacyFileBytes(params: typeof ftpLegacyDefaults): number {
    return params.avgFileSizeMb * 1e6;
}

function ftpLegacyServiceSec(params: typeof ftpLegacyDefaults): number {
    const transferSec = ftpLegacyFileBytes(params) / ((params.perSessionMbs * 1e6) / 8);

    return params.latencyMs / 1000 + transferSec;
}

const ftpLegacyModel = defineModel<typeof ftpLegacyDefaults>({
    serviceSec: (ctx) => ftpLegacyServiceSec(ctx.params),
    resources: (ctx) => [
        littleLaw('concurrency', ctx.params.concurrency, ftpLegacyServiceSec(ctx.params)),
        bandwidthBound('throughput', ctx.params.throughputMbs * 8, ftpLegacyFileBytes(ctx.params)),
    ],
    storage: (ctx) => {
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * ftpLegacyFileBytes(ctx.params)) / 1e9;
        const totalGb = ctx.params.storageGb + growthGbDay * ctx.horizonDays;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'writeRps × 86400 × avgFileSizeMb × 10⁶ / 10⁹',
                    { writeRps: ctx.writeRps, avgFileSizeMb: ctx.params.avgFileSizeMb },
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
    cost: (ctx) =>
        totalCost({
            compute: ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const ftpLegacy = defineComponent({
    id: 'ftp-legacy',
    group: 'storage',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-file-share',
    ports: FILE_PORTS,
    defaultParams: ftpLegacyDefaults,
    paramSchema: {
        throughputMbs: num('capacity', { min: 1, max: 100000, realistic: { min: 10, max: 1000 } }),
        perSessionMbs: num('capacity', { min: 0.1, max: 10000, step: 0.1, realistic: { min: 1, max: 100 } }),
        concurrency: num('capacity', { min: 1, max: 100000, realistic: { min: 10, max: 500 } }),
        avgFileSizeMb: num('data', { unitKey: 'mb', min: 0.001, max: 1048576, step: 0.001 }),
        storageGb: num('capacity', { unitKey: 'gb', min: 1, max: 10000000 }),
        latencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 5000, step: 0.1, realistic: { min: 5, max: 200 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: ftpLegacyModel,
    helpId: 'ftp-legacy',
});

export const storageComponents: ComponentDefinition[] = [
    s3,
    minio,
    glacier,
    nfs,
    block,
    hdfs,
    ftpLegacy,
] as unknown as ComponentDefinition[];
