import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY } from '../sim/constants';
import { bandwidthBound, defineModel, explain, littleLaw, totalCost } from '../sim/resources';
import { choice, defineComponent, num } from './_shared/params';

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

export const searchComponents: ComponentDefinition[] = [elasticsearch] as unknown as ComponentDefinition[];
