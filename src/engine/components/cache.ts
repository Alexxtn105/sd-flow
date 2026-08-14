import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY } from '../sim/constants';
import {
    connectionBound,
    defineModel,
    explain,
    explicitRps,
    memoryResidencyBound,
    resourceLimit,
    totalCost,
} from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const CACHE_PORTS: PortSpec = {
    in: [{ id: 'ops', protocols: ['redis'], role: 'serve' }],
    out: [{ id: 'replication', protocols: ['redis'], role: 'replicate' }],
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

const REDIS_DATA_MEMORY_SHARE = 0.75;

const PIPELINING_THROUGHPUT_GAIN = 2;

const LOCAL_CACHE_ENTRY_OVERHEAD_BYTES = 64;

const redisDefaults = {
    mode: 'cluster',
    shards: 3,
    replicasPerShard: 1,
    memoryGb: 26,
    evictionPolicy: 'lru',
    ttlSec: 300,
    keySizeBytes: 40,
    valueSizeBytes: 1024,
    overheadPerKeyBytes: 64,
    uniqueKeys: 10000000,
    zipfAlpha: 1,
    maxOpsPerSec: 120000,
    maxConnections: 10000,
    pipelining: true,
    clusterHashSlots: 16384,
    hotKeyShare: 0.05,
    serviceTimeMs: 0.2,
    persistence: 'rdb',
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 5,
    replicaLagSigma: 0.8,
    concurrencyControl: 'none',
    conflictResolution: 'lww',
    availability: 0.999,
    costPerInstanceHour: 0.25,
};

function redisEntryBytes(params: typeof redisDefaults): number {
    return params.keySizeBytes + params.valueSizeBytes + params.overheadPerKeyBytes;
}

function redisCapacityBytes(params: typeof redisDefaults): number {
    return params.shards * params.memoryGb * 1e9 * REDIS_DATA_MEMORY_SHARE;
}

function redisOpsPerShard(params: typeof redisDefaults): number {
    return params.maxOpsPerSec * (params.pipelining ? PIPELINING_THROUGHPUT_GAIN : 1);
}

function redisNodes(params: typeof redisDefaults): number {
    return params.shards * (1 + params.replicasPerShard);
}

const redisModel = defineModel<typeof redisDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => [
        explicitRps('ops', ctx.params.shards, redisOpsPerShard(ctx.params)),
        memoryResidencyBound(
            'memory',
            redisCapacityBytes(ctx.params) / 1e9,
            (redisEntryBytes(ctx.params) * ctx.params.ttlSec * ctx.writeShare) / 1e9,
        ),
        connectionBound(
            'connections',
            ctx.params.maxConnections * ctx.params.shards,
            1,
            ctx.params.serviceTimeMs / 1000,
        ),
        resourceLimit(
            'hot-key',
            redisOpsPerShard(ctx.params) / ctx.params.hotKeyShare,
            'opsPerShard / hotKeyShare',
            { opsPerShard: redisOpsPerShard(ctx.params), hotKeyShare: ctx.params.hotKeyShare },
        ),
    ],
    storage: (ctx) => {
        const entryBytes = redisEntryBytes(ctx.params);
        const copies = 1 + ctx.params.replicasPerShard;
        const residentGb =
            (Math.min(ctx.params.uniqueKeys * entryBytes, redisCapacityBytes(ctx.params)) * copies) / 1e9;
        const appendOnly = ctx.params.persistence === 'aof' || ctx.params.persistence === 'rdb-aof';
        const growthGbDay = appendOnly ? (ctx.writeRps * SECONDS_PER_DAY * entryBytes) / 1e9 : 0;

        return {
            totalGb: ctx.params.persistence === 'none' ? 0 : residentGb,
            growthGbDay,
            memoryGb: residentGb,
            explain: [
                explain(
                    'min(uniqueKeys × entryBytes, shards × memoryGb × dataShare) × copies / 10⁹',
                    {
                        uniqueKeys: ctx.params.uniqueKeys,
                        entryBytes,
                        shards: ctx.params.shards,
                        memoryGb: ctx.params.memoryGb,
                        dataShare: REDIS_DATA_MEMORY_SHARE,
                        copies,
                    },
                    residentGb,
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
                redisNodes(ctx.params) *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
    cache: (ctx) => ({
        uniqueKeys: ctx.params.uniqueKeys,
        zipfAlpha: ctx.params.zipfAlpha,
        entryBytes: redisEntryBytes(ctx.params),
        capacityBytes: redisCapacityBytes(ctx.params),
        ttlSec: ctx.params.ttlSec,
    }),
});

const redis = defineComponent({
    id: 'redis',
    group: 'cache',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-cache',
    ports: CACHE_PORTS,
    defaultParams: redisDefaults,
    paramSchema: {
        mode: choice('topology', ['standalone', 'sentinel', 'cluster']),
        shards: num('topology', { min: 1, max: 500 }),
        replicasPerShard: num('topology', { min: 0, max: 5 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.1, max: 4096, step: 0.1 }),
        evictionPolicy: choice('behaviour', ['lru', 'lfu', 'ttl', 'random', 'noeviction']),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 2592000 }),
        keySizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 65536 }),
        valueSizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 10485760 }),
        overheadPerKeyBytes: num('data', { unitKey: 'bytes', min: 0, max: 1024, realistic: { min: 50, max: 100 } }),
        uniqueKeys: num('data', { min: 1, max: 1e12 }),
        zipfAlpha: num('behaviour', { min: 0.3, max: 2.5, step: 0.1, realistic: { min: 0.6, max: 1.4 } }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 1000, max: 10000000, realistic: { min: 80000, max: 150000 } }),
        maxConnections: num('capacity', { min: 100, max: 1000000 }),
        pipelining: bool('behaviour'),
        clusterHashSlots: num('topology', { min: 1, max: 16384 }),
        hotKeyShare: num('behaviour', { min: 0, max: 1, step: 0.01 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        persistence: choice('reliability', ['none', 'rdb', 'aof', 'rdb-aof']),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 60000, realistic: { min: 1, max: 100 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: redisModel,
    helpId: 'redis',
});

const localCacheDefaults = {
    sizeMb: 256,
    maxEntries: 100000,
    ttlSec: 60,
    perInstance: true,
    coherenceRisk: 0.2,
    evictionPolicy: 'lru',
    keySizeBytes: 40,
    valueSizeBytes: 512,
    uniqueKeys: 1000000,
    zipfAlpha: 1,
    serviceTimeMs: 0.01,
    refreshAhead: false,
    stampedeProtection: true,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 1000,
    replicaLagSigma: 0.8,
    concurrencyControl: 'none',
    conflictResolution: 'lww',
};

function localCacheEntryBytes(params: typeof localCacheDefaults): number {
    return params.keySizeBytes + params.valueSizeBytes + LOCAL_CACHE_ENTRY_OVERHEAD_BYTES;
}

function localCacheCapacityBytes(params: typeof localCacheDefaults): number {
    return Math.min(params.sizeMb * 1e6, params.maxEntries * localCacheEntryBytes(params));
}

const localCacheModel = defineModel<typeof localCacheDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => [
        memoryResidencyBound(
            'memory',
            (ctx.instances * localCacheCapacityBytes(ctx.params)) / 1e9,
            (localCacheEntryBytes(ctx.params) * ctx.params.ttlSec * ctx.writeShare) / 1e9,
        ),
    ],
    storage: (ctx) => {
        const memoryGb = (ctx.instances * localCacheCapacityBytes(ctx.params)) / 1e9;

        return {
            totalGb: 0,
            growthGbDay: 0,
            memoryGb,
            explain: [
                explain(
                    'instances × min(sizeMb × 10⁶, maxEntries × entryBytes) / 10⁹',
                    {
                        instances: ctx.instances,
                        sizeMb: ctx.params.sizeMb,
                        maxEntries: ctx.params.maxEntries,
                        entryBytes: localCacheEntryBytes(ctx.params),
                    },
                    memoryGb,
                    'gb',
                ),
            ],
        };
    },
    cache: (ctx) => ({
        uniqueKeys: ctx.params.uniqueKeys,
        zipfAlpha: ctx.params.zipfAlpha,
        entryBytes: localCacheEntryBytes(ctx.params),
        capacityBytes: localCacheCapacityBytes(ctx.params),
        ttlSec: ctx.params.ttlSec,
    }),
});

const localCache = defineComponent({
    id: 'local-cache',
    group: 'cache',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-local-cache',
    ports: CACHE_PORTS,
    defaultParams: localCacheDefaults,
    paramSchema: {
        sizeMb: num('capacity', { unitKey: 'mb', min: 1, max: 65536 }),
        maxEntries: num('capacity', { min: 1, max: 100000000 }),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        perInstance: bool('topology'),
        coherenceRisk: num('consistency', { min: 0, max: 1, step: 0.01 }),
        evictionPolicy: choice('behaviour', ['lru', 'lfu', 'ttl', 'random']),
        keySizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 65536 }),
        valueSizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 10485760 }),
        uniqueKeys: num('data', { min: 1, max: 1e12 }),
        zipfAlpha: num('behaviour', { min: 0.3, max: 2.5, step: 0.1, realistic: { min: 0.6, max: 1.4 } }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.001, max: 100, step: 0.001 }),
        refreshAhead: bool('behaviour'),
        stampedeProtection: bool('behaviour'),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000 }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
    },
    model: localCacheModel,
    helpId: 'local-cache',
});

export const cacheComponents: ComponentDefinition[] = [redis, localCache] as unknown as ComponentDefinition[];
