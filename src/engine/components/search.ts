import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explain,
    littleLaw,
    resourceLimit,
    totalCost,
    weightedUnitBound,
} from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const SEARCH_PORTS: PortSpec = {
    in: [{ id: 'query', protocols: ['search'], role: 'serve' }],
    out: [{ id: 'replication', protocols: ['search'], role: 'replicate' }],
};

const QUERY_TYPE_COST: Record<string, number> = {
    term: 0.4,
    match: 1,
    aggregation: 3,
};

const INDEXING_MBS_PER_NODE = 30;

const SECONDS_PER_MINUTE = 60;

const MIN_INDEX_GB = 0.001;

function residentIndexShare(ramGb: number, indexGb: number): number {
    return Math.min(1, ramGb / Math.max(indexGb, MIN_INDEX_GB));
}

const elasticsearchDefaults = {
    nodes: 6,
    shardsPerIndex: 6,
    replicas: 1,
    docCount: 200000000,
    docSizeKb: 2,
    indexExpansionRatio: 1.4,
    indexedFields: 20,
    refreshIntervalSec: 1,
    queryType: 'match',
    heapGb: 31,
    fieldDataCacheGb: 4,
    cpuCores: 16,
    storageGbPerNode: 2000,
    queryConcurrencyPerNode: 24,
    queryServiceMs: 25,
    indexServiceMs: 3,
    consistencyModel: 'eventual',
    replicationMode: 'sync',
    replicaLagMs: 1000,
    replicaLagSigma: 0.8,
    concurrencyControl: 'optimistic',
    conflictResolution: 'lww',
    availability: 0.999,
    costPerInstanceHour: 0.6,
    costPerGbMonth: 0.1,
};

function elasticsearchServiceSec(
    params: typeof elasticsearchDefaults,
    readShare: number,
    writeShare: number,
): number {
    const queryMs = params.queryServiceMs * (QUERY_TYPE_COST[params.queryType] ?? 1);
    return (readShare * queryMs + writeShare * params.indexServiceMs) / 1000;
}

function elasticsearchDocumentBytes(params: typeof elasticsearchDefaults): number {
    return params.docSizeKb * 1024 * params.indexExpansionRatio * (1 + params.replicas);
}

const elasticsearchModel = defineModel<typeof elasticsearchDefaults>({
    serviceSec: (ctx) => elasticsearchServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = elasticsearchServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const shardFanout =
            ctx.readShare * ctx.params.shardsPerIndex + ctx.writeShare * (1 + ctx.params.replicas);

        return [
            littleLaw('cpu', ctx.params.nodes * ctx.params.cpuCores, serviceSec * shardFanout),
            littleLaw(
                'search-threads',
                ctx.params.nodes * ctx.params.queryConcurrencyPerNode,
                serviceSec * shardFanout,
            ),
            bandwidthBound(
                'indexing',
                ctx.params.nodes * INDEXING_MBS_PER_NODE * 8,
                ctx.writeShare * elasticsearchDocumentBytes(ctx.params),
            ),
        ];
    },
    storage: (ctx) => {
        const documentBytes = elasticsearchDocumentBytes(ctx.params);
        const baseGb = (ctx.params.docCount * documentBytes) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * documentBytes) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: ctx.params.nodes * ctx.params.heapGb,
            explain: [
                explain(
                    'docCount × docSize × indexExpansionRatio × (1 + replicas) / 10⁹',
                    {
                        docCount: ctx.params.docCount,
                        docSizeKb: ctx.params.docSizeKb,
                        indexExpansionRatio: ctx.params.indexExpansionRatio,
                        replicas: ctx.params.replicas,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × docSize × indexExpansionRatio × (1 + replicas) / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        docSizeKb: ctx.params.docSizeKb,
                        indexExpansionRatio: ctx.params.indexExpansionRatio,
                        replicas: ctx.params.replicas,
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

const elasticsearch = defineComponent({
    id: 'elasticsearch',
    group: 'search',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-search',
    ports: SEARCH_PORTS,
    defaultParams: elasticsearchDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 500, realistic: { min: 3, max: 60 } }),
        shardsPerIndex: num('topology', { min: 1, max: 1024, realistic: { min: 1, max: 30 } }),
        replicas: num('topology', { min: 0, max: 10 }),
        docCount: num('data', { min: 0, max: 1000000000000 }),
        docSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        indexExpansionRatio: num('data', { min: 0.5, max: 5, step: 0.1, realistic: { min: 1.1, max: 2 } }),
        indexedFields: num('data', { min: 1, max: 1000 }),
        refreshIntervalSec: num('behaviour', { unitKey: 'sec', min: 0.1, max: 300, step: 0.1 }),
        queryType: choice('performance', ['term', 'match', 'aggregation']),
        heapGb: num('capacity', { unitKey: 'gb', min: 1, max: 64, realistic: { min: 8, max: 31 } }),
        fieldDataCacheGb: num('capacity', { unitKey: 'gb', min: 0, max: 64, step: 0.5 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        storageGbPerNode: num('capacity', { unitKey: 'gb', min: 10, max: 200000 }),
        queryConcurrencyPerNode: num('capacity', { min: 1, max: 5000 }),
        queryServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        indexServiceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        consistencyModel: choice('consistency', [
            'linearizable',
            'sequential',
            'bounded-staleness',
            'read-your-writes',
            'monotonic',
            'eventual',
        ]),
        replicationMode: choice('consistency', ['sync', 'semi-sync', 'async']),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 200, max: 30000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', ['none', 'optimistic', 'pessimistic', 'crdt']),
        conflictResolution: choice('consistency', ['lww', 'vector-clock', 'crdt', 'single-writer-per-key', 'manual']),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: elasticsearchModel,
    helpId: 'elasticsearch',
});

const MEILISEARCH_TYPO_QUERY_FACTOR = 1.4;

const meilisearchDefaults = {
    nodes: 2,
    docCount: 50000000,
    docSizeKb: 2,
    indexExpansionRatio: 1.6,
    indexRamGb: 32,
    typoTolerance: true,
    queryConcurrency: 32,
    cpuCores: 8,
    queryServiceMs: 12,
    indexServiceMs: 6,
    availability: 0.99,
    costPerInstanceHour: 0.35,
    costPerGbMonth: 0.1,
};

function meilisearchDocumentBytes(params: typeof meilisearchDefaults): number {
    return params.docSizeKb * 1024 * params.indexExpansionRatio;
}

function meilisearchIndexGb(params: typeof meilisearchDefaults): number {
    return (params.docCount * meilisearchDocumentBytes(params)) / 1e9;
}

function meilisearchServiceSec(
    params: typeof meilisearchDefaults,
    readShare: number,
    writeShare: number,
): number {
    const queryMs = params.queryServiceMs * (params.typoTolerance ? MEILISEARCH_TYPO_QUERY_FACTOR : 1);
    return (readShare * queryMs + writeShare * params.indexServiceMs) / 1000;
}

const meilisearchModel = defineModel<typeof meilisearchDefaults>({
    serviceSec: (ctx) => meilisearchServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = meilisearchServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const indexGb = meilisearchIndexGb(ctx.params);
        const residentShare = residentIndexShare(ctx.params.indexRamGb, indexGb);

        return [
            resourceLimit(
                'memory',
                (ctx.params.nodes * ctx.params.queryConcurrency * residentShare) / serviceSec,
                'nodes × queryConcurrency × min(1, indexRamGb / indexGb) / S',
                {
                    nodes: ctx.params.nodes,
                    queryConcurrency: ctx.params.queryConcurrency,
                    indexRamGb: ctx.params.indexRamGb,
                    indexGb,
                    S: serviceSec,
                },
            ),
            littleLaw('cpu', ctx.params.nodes * ctx.params.cpuCores, serviceSec),
            bandwidthBound(
                'indexing',
                ctx.params.nodes * INDEXING_MBS_PER_NODE * 8,
                ctx.writeShare * meilisearchDocumentBytes(ctx.params),
            ),
        ];
    },
    storage: (ctx) => {
        const documentBytes = meilisearchDocumentBytes(ctx.params);
        const baseGb = meilisearchIndexGb(ctx.params);
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * documentBytes) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: ctx.params.nodes * Math.min(ctx.params.indexRamGb, baseGb),
            explain: [
                explain(
                    'docCount × docSize × indexExpansionRatio / 10⁹',
                    {
                        docCount: ctx.params.docCount,
                        docSizeKb: ctx.params.docSizeKb,
                        indexExpansionRatio: ctx.params.indexExpansionRatio,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × docSize × indexExpansionRatio / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        docSizeKb: ctx.params.docSizeKb,
                        indexExpansionRatio: ctx.params.indexExpansionRatio,
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

const meilisearch = defineComponent({
    id: 'meilisearch',
    group: 'search',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-search',
    ports: SEARCH_PORTS,
    defaultParams: meilisearchDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 100, realistic: { min: 1, max: 8 } }),
        docCount: num('data', { min: 0, max: 100000000000 }),
        docSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        indexExpansionRatio: num('data', { min: 0.5, max: 5, step: 0.1, realistic: { min: 1.2, max: 2.5 } }),
        indexRamGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 4096, step: 0.5 }),
        typoTolerance: bool('behaviour'),
        queryConcurrency: num('capacity', { min: 1, max: 5000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        queryServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        indexServiceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: meilisearchModel,
    helpId: 'meilisearch',
});

const VECTOR_BYTES_PER_DIMENSION = 4;

const VECTOR_INDEX_OVERHEAD = 1.5;

const VECTOR_RAM_USABLE_SHARE = 0.85;

const VECTOR_INGEST_MBS_PER_NODE = 20;

const VECTOR_PROBE_FACTOR: Record<string, number> = {
    hnsw: 1,
    ivf: 2.2,
};

const VECTOR_RECALL_BASELINE = 0.9;

const VECTOR_TOPK_BASELINE = 10;

const VECTOR_RECALL_CEILING = 0.999;

const vectorDbDefaults = {
    nodes: 3,
    replicas: 1,
    vectorCount: 100000000,
    dimensions: 768,
    indexType: 'hnsw',
    recallTarget: 0.95,
    topK: 10,
    memoryGb: 64,
    cpuCores: 16,
    queryConcurrency: 32,
    queryServiceMs: 6,
    indexServiceMs: 3,
    availability: 0.999,
    costPerInstanceHour: 0.9,
    costPerGbMonth: 0.1,
};

function vectorMemoryPerVectorBytes(params: typeof vectorDbDefaults): number {
    return params.dimensions * VECTOR_BYTES_PER_DIMENSION * VECTOR_INDEX_OVERHEAD;
}

function vectorIndexGb(params: typeof vectorDbDefaults): number {
    return (params.vectorCount * vectorMemoryPerVectorBytes(params) * (1 + params.replicas)) / 1e9;
}

function vectorClusterRamGb(params: typeof vectorDbDefaults): number {
    return params.nodes * params.memoryGb * VECTOR_RAM_USABLE_SHARE;
}

function vectorSearchEffort(params: typeof vectorDbDefaults): number {
    const recall = Math.min(params.recallTarget, VECTOR_RECALL_CEILING);
    const recallEffort = Math.log2(1 / (1 - recall)) / Math.log2(1 / (1 - VECTOR_RECALL_BASELINE));
    const topKEffort = Math.log2(params.topK + 1) / Math.log2(VECTOR_TOPK_BASELINE + 1);

    return (VECTOR_PROBE_FACTOR[params.indexType] ?? 1) * recallEffort * topKEffort;
}

function vectorDbServiceSec(
    params: typeof vectorDbDefaults,
    readShare: number,
    writeShare: number,
): number {
    const queryMs = params.queryServiceMs * vectorSearchEffort(params);
    return (readShare * queryMs + writeShare * params.indexServiceMs) / 1000;
}

const vectorDbModel = defineModel<typeof vectorDbDefaults>({
    serviceSec: (ctx) => vectorDbServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = vectorDbServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const indexGb = vectorIndexGb(ctx.params);
        const ramGb = vectorClusterRamGb(ctx.params);
        const residentShare = residentIndexShare(ramGb, indexGb);

        return [
            resourceLimit(
                'memory',
                (ctx.params.nodes * ctx.params.queryConcurrency * residentShare) / serviceSec,
                'nodes × queryConcurrency × min(1, ramGb / indexGb) / S',
                {
                    nodes: ctx.params.nodes,
                    queryConcurrency: ctx.params.queryConcurrency,
                    ramGb,
                    indexGb,
                    memoryPerVectorBytes: vectorMemoryPerVectorBytes(ctx.params),
                    S: serviceSec,
                },
            ),
            littleLaw('cpu', ctx.params.nodes * ctx.params.cpuCores, serviceSec),
            bandwidthBound(
                'indexing',
                ctx.params.nodes * VECTOR_INGEST_MBS_PER_NODE * 8,
                ctx.writeShare * vectorMemoryPerVectorBytes(ctx.params) * (1 + ctx.params.replicas),
            ),
        ];
    },
    storage: (ctx) => {
        const vectorBytes = vectorMemoryPerVectorBytes(ctx.params) * (1 + ctx.params.replicas);
        const baseGb = vectorIndexGb(ctx.params);
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * vectorBytes) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: Math.min(baseGb, vectorClusterRamGb(ctx.params)),
            explain: [
                explain(
                    'vectorCount × dimensions × 4 × 1.5 × (1 + replicas) / 10⁹',
                    {
                        vectorCount: ctx.params.vectorCount,
                        dimensions: ctx.params.dimensions,
                        memoryPerVectorBytes: vectorMemoryPerVectorBytes(ctx.params),
                        replicas: ctx.params.replicas,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × memoryPerVectorBytes × (1 + replicas) / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        memoryPerVectorBytes: vectorMemoryPerVectorBytes(ctx.params),
                        replicas: ctx.params.replicas,
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

const vectorDb = defineComponent({
    id: 'vector-db',
    group: 'search',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-vector',
    ports: SEARCH_PORTS,
    defaultParams: vectorDbDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 500, realistic: { min: 2, max: 40 } }),
        replicas: num('topology', { min: 0, max: 10 }),
        vectorCount: num('data', { min: 0, max: 100000000000 }),
        dimensions: num('data', { min: 2, max: 16384, realistic: { min: 128, max: 1536 } }),
        indexType: choice('performance', ['hnsw', 'ivf']),
        recallTarget: num('performance', { min: 0.5, max: 0.999, step: 0.001, realistic: { min: 0.9, max: 0.99 } }),
        topK: num('performance', { min: 1, max: 1000, realistic: { min: 5, max: 100 } }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 1, max: 4096 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        queryConcurrency: num('capacity', { min: 1, max: 5000 }),
        queryServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        indexServiceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: vectorDbModel,
    helpId: 'vector-db',
});

const FST_COMPRESSION_RATIO = 4;

const AUTOCOMPLETE_REBUILD_CHURN_SHARE = 0.1;

const autocompleteDefaults = {
    nodes: 3,
    prefixCount: 400000000,
    keySizeBytes: 24,
    valueSizeBytes: 200,
    memoryGb: 8,
    cpuCores: 16,
    queryConcurrency: 32,
    queryServiceMs: 2,
    indexServiceMs: 1,
    updateLagMin: 15,
    availability: 0.999,
    costPerInstanceHour: 0.2,
};

function autocompletePrefixBytes(params: typeof autocompleteDefaults): number {
    return (params.keySizeBytes + params.valueSizeBytes) / FST_COMPRESSION_RATIO;
}

function autocompleteIndexGb(params: typeof autocompleteDefaults): number {
    return (params.prefixCount * autocompletePrefixBytes(params)) / 1e9;
}

function autocompleteRebuildRps(params: typeof autocompleteDefaults): number {
    return (
        (params.prefixCount * AUTOCOMPLETE_REBUILD_CHURN_SHARE) /
        Math.max(params.updateLagMin * SECONDS_PER_MINUTE, 1)
    );
}

function autocompleteServiceSec(
    params: typeof autocompleteDefaults,
    readShare: number,
    writeShare: number,
): number {
    return (readShare * params.queryServiceMs + writeShare * params.indexServiceMs) / 1000;
}

const autocompleteModel = defineModel<typeof autocompleteDefaults>({
    serviceSec: (ctx) => autocompleteServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = autocompleteServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const indexGb = autocompleteIndexGb(ctx.params);
        const residentShare = residentIndexShare(ctx.params.memoryGb, indexGb);
        const rebuildRps = autocompleteRebuildRps(ctx.params);

        return [
            resourceLimit(
                'memory',
                (ctx.params.nodes * ctx.params.queryConcurrency * residentShare) / serviceSec,
                'nodes × queryConcurrency × min(1, memoryGb / prefixIndexGb) / S',
                {
                    nodes: ctx.params.nodes,
                    queryConcurrency: ctx.params.queryConcurrency,
                    memoryGb: ctx.params.memoryGb,
                    prefixIndexGb: indexGb,
                    S: serviceSec,
                },
            ),
            littleLaw('cpu', ctx.params.nodes * ctx.params.cpuCores, serviceSec),
            weightedUnitBound(
                'indexing',
                'prefixCount × churnShare / (updateLagMin × 60) / writeShare',
                {
                    prefixCount: ctx.params.prefixCount,
                    churnShare: AUTOCOMPLETE_REBUILD_CHURN_SHARE,
                    updateLagMin: ctx.params.updateLagMin,
                    writeShare: ctx.writeShare,
                },
                0,
                1 / rebuildRps,
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const prefixBytes = autocompletePrefixBytes(ctx.params);
        const baseGb = autocompleteIndexGb(ctx.params);
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * prefixBytes) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: ctx.params.nodes * Math.min(ctx.params.memoryGb, baseGb),
            explain: [
                explain(
                    'prefixCount × (keySizeBytes + valueSizeBytes) / fstCompression / 10⁹',
                    {
                        prefixCount: ctx.params.prefixCount,
                        keySizeBytes: ctx.params.keySizeBytes,
                        valueSizeBytes: ctx.params.valueSizeBytes,
                        fstCompression: FST_COMPRESSION_RATIO,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × prefixBytes / 10⁹',
                    { writeRps: ctx.writeRps, prefixBytes },
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
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const autocomplete = defineComponent({
    id: 'autocomplete',
    group: 'search',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-autocomplete',
    ports: SEARCH_PORTS,
    defaultParams: autocompleteDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 500, realistic: { min: 2, max: 30 } }),
        prefixCount: num('data', { min: 0, max: 100000000000 }),
        keySizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 65536 }),
        valueSizeBytes: num('data', { unitKey: 'bytes', min: 1, max: 1048576 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.1, max: 4096, step: 0.1 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        queryConcurrency: num('capacity', { min: 1, max: 5000 }),
        queryServiceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        indexServiceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        updateLagMin: num('behaviour', { min: 0, max: 1440, realistic: { min: 1, max: 60 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: autocompleteModel,
    helpId: 'autocomplete',
});

const SOLR_CACHE_WARMUP_MS = 200;

const solrDefaults = {
    nodes: 6,
    shards: 6,
    replicas: 1,
    docCount: 150000000,
    docSizeKb: 2,
    indexExpansionRatio: 1.4,
    softCommitMs: 1000,
    queryType: 'match',
    heapGb: 24,
    cpuCores: 16,
    queryConcurrencyPerNode: 24,
    queryServiceMs: 20,
    indexServiceMs: 3,
    consistencyModel: 'eventual',
    replicationMode: 'async',
    replicaLagMs: 1000,
    replicaLagSigma: 0.8,
    concurrencyControl: 'optimistic',
    conflictResolution: 'lww',
    availability: 0.999,
    costPerInstanceHour: 0.5,
    costPerGbMonth: 0.1,
};

function solrSoftCommitPenalty(params: typeof solrDefaults): number {
    return 1 + SOLR_CACHE_WARMUP_MS / Math.max(params.softCommitMs, 1);
}

function solrDocumentBytes(params: typeof solrDefaults): number {
    return params.docSizeKb * 1024 * params.indexExpansionRatio * (1 + params.replicas);
}

function solrServiceSec(params: typeof solrDefaults, readShare: number, writeShare: number): number {
    const queryMs =
        params.queryServiceMs * (QUERY_TYPE_COST[params.queryType] ?? 1) * solrSoftCommitPenalty(params);

    return (readShare * queryMs + writeShare * params.indexServiceMs) / 1000;
}

const solrModel = defineModel<typeof solrDefaults>({
    serviceSec: (ctx) => solrServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => {
        const serviceSec = solrServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
        const shardFanout = ctx.readShare * ctx.params.shards + ctx.writeShare * (1 + ctx.params.replicas);

        return [
            littleLaw('cpu', ctx.params.nodes * ctx.params.cpuCores, serviceSec * shardFanout),
            littleLaw(
                'search-threads',
                ctx.params.nodes * ctx.params.queryConcurrencyPerNode,
                serviceSec * shardFanout,
            ),
            bandwidthBound(
                'indexing',
                ctx.params.nodes * INDEXING_MBS_PER_NODE * 8,
                ctx.writeShare * solrDocumentBytes(ctx.params),
            ),
        ];
    },
    storage: (ctx) => {
        const documentBytes = solrDocumentBytes(ctx.params);
        const baseGb = (ctx.params.docCount * documentBytes) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * documentBytes) / 1e9;

        return {
            totalGb: baseGb + growthGbDay * ctx.horizonDays,
            growthGbDay,
            memoryGb: ctx.params.nodes * ctx.params.heapGb,
            explain: [
                explain(
                    'docCount × docSize × indexExpansionRatio × (1 + replicas) / 10⁹',
                    {
                        docCount: ctx.params.docCount,
                        docSizeKb: ctx.params.docSizeKb,
                        indexExpansionRatio: ctx.params.indexExpansionRatio,
                        replicas: ctx.params.replicas,
                    },
                    baseGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × docSize × indexExpansionRatio × (1 + replicas) / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        docSizeKb: ctx.params.docSizeKb,
                        indexExpansionRatio: ctx.params.indexExpansionRatio,
                        replicas: ctx.params.replicas,
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

const solr = defineComponent({
    id: 'solr',
    group: 'search',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-search',
    ports: SEARCH_PORTS,
    defaultParams: solrDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 500, realistic: { min: 3, max: 40 } }),
        shards: num('topology', { min: 1, max: 1024, realistic: { min: 1, max: 30 } }),
        replicas: num('topology', { min: 0, max: 10 }),
        docCount: num('data', { min: 0, max: 1000000000000 }),
        docSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        indexExpansionRatio: num('data', { min: 0.5, max: 5, step: 0.1, realistic: { min: 1.1, max: 2 } }),
        softCommitMs: num('behaviour', { unitKey: 'ms', min: 50, max: 600000, realistic: { min: 500, max: 15000 } }),
        queryType: choice('performance', ['term', 'match', 'aggregation']),
        heapGb: num('capacity', { unitKey: 'gb', min: 1, max: 64, realistic: { min: 8, max: 31 } }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        queryConcurrencyPerNode: num('capacity', { min: 1, max: 5000 }),
        queryServiceMs: num('performance', { unitKey: 'ms', min: 0.5, max: 60000, step: 0.5 }),
        indexServiceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        consistencyModel: choice('consistency', [
            'linearizable',
            'sequential',
            'bounded-staleness',
            'read-your-writes',
            'monotonic',
            'eventual',
        ]),
        replicationMode: choice('consistency', ['sync', 'semi-sync', 'async']),
        replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 200, max: 30000 } }),
        replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
        concurrencyControl: choice('consistency', ['none', 'optimistic', 'pessimistic', 'crdt']),
        conflictResolution: choice('consistency', ['lww', 'vector-clock', 'crdt', 'single-writer-per-key', 'manual']),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: solrModel,
    helpId: 'solr',
});

export const searchComponents: ComponentDefinition[] = [
    elasticsearch,
    meilisearch,
    vectorDb,
    autocomplete,
    solr,
] as unknown as ComponentDefinition[];
