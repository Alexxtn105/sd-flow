import type { ComponentDefinition, PortSpec } from '../types/component';
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

const redis = defineComponent({
    id: 'redis',
    group: 'cache',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-cache',
    ports: CACHE_PORTS,
    defaultParams: {
        mode: 'cluster',
        shards: 3,
        replicasPerShard: 1,
        memoryGb: 26,
        evictionPolicy: 'lru',
        ttlSec: 300,
        keySizeBytes: 40,
        valueSizeBytes: 1024,
        overheadPerKeyBytes: 64,
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
        concurrencyControl: 'none',
        conflictResolution: 'lww',
        availability: 0.999,
        costPerInstanceHour: 0.25,
    },
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
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    helpId: 'redis',
});

const localCache = defineComponent({
    id: 'local-cache',
    group: 'cache',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-local-cache',
    ports: CACHE_PORTS,
    defaultParams: {
        sizeMb: 256,
        maxEntries: 100000,
        ttlSec: 60,
        perInstance: true,
        coherenceRisk: 0.2,
        evictionPolicy: 'lru',
        keySizeBytes: 40,
        valueSizeBytes: 512,
        serviceTimeMs: 0.01,
        refreshAhead: false,
        stampedeProtection: true,
        consistencyModel: 'eventual',
        replicationMode: 'async',
        replicaLagMs: 1000,
        concurrencyControl: 'none',
        conflictResolution: 'lww',
    },
    paramSchema: {
        sizeMb: num('capacity', { unitKey: 'mb', min: 1, max: 65536 }),
        maxEntries: num('capacity', { min: 1, max: 100000000 }),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        perInstance: bool('topology'),
        coherenceRisk: num('consistency', { min: 0, max: 1, step: 0.01 }),
        evictionPolicy: choice('behaviour', ['lru', 'lfu', 'ttl', 'random']),
        keySizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 65536 }),
        valueSizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 10485760 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.001, max: 100, step: 0.001 }),
        refreshAhead: bool('behaviour'),
        stampedeProtection: bool('behaviour'),
        consistencyModel: choice('consistency', CONSISTENCY_MODEL),
        replicationMode: choice('consistency', REPLICATION_MODE),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000 }),
        concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
        conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
    },
    helpId: 'local-cache',
});

export const cacheComponents: ComponentDefinition[] = [redis, localCache] as unknown as ComponentDefinition[];
