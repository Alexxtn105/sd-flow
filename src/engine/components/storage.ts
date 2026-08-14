import type { ComponentDefinition, PortSpec } from '../types/component';
import { SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explain,
    explicitRps,
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

const VERSIONING_STORAGE_FACTOR = 2;

const CROSS_REGION_COPIES = 2;

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

export const storageComponents: ComponentDefinition[] = [s3, minio] as unknown as ComponentDefinition[];
