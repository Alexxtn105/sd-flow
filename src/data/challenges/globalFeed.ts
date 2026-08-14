import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { NodeSpec, LinkSpec } from '../../services/schemeBuilder';
import type { SchemeV1 } from '../../engine/types/scheme';

const READERS = 'readers';
const AUTHORS = 'authors';

const readerParams = {
    dau: 300000000,
    sessionsPerUserDay: 5,
    requestsPerSession: 10,
    avgRequestKb: 1,
    avgResponseKb: 24,
    readWriteMix: 0.97,
    cacheableShare: 0.8,
    peakFactor: 1.8,
    diurnalPattern: 'global',
    geoDistribution: 'global',
    networkRttMs: 55,
};

const authorParams = {
    dau: 20000000,
    sessionsPerUserDay: 2,
    requestsPerSession: 3,
    avgRequestKb: 6,
    avgResponseKb: 2,
    readWriteMix: 0.05,
    cacheableShare: 0,
    peakFactor: 1.8,
    diurnalPattern: 'global',
    geoDistribution: 'global',
    networkRttMs: 55,
};

const readCalls = { requestBytes: 1000, responseBytes: 24000 };
const writeCalls = { requestBytes: 6000, responseBytes: 2000 };

function regionNodes(suffix: string, regionId: string): NodeSpec[] {
    return [
        {
            id: `edge-${suffix}`,
            type: 'lb-l7',
            parentId: regionId,
            params: {
                instances: 26,
                azSpread: 3,
                maxRpsPerInstance: 25000,
                maxConnections: 800000,
                cpuCores: 16,
                tlsTerminate: true,
                latencyMs: 0.6,
            },
            position: { x: 40, y: 60 },
        },
        {
            id: `feed-${suffix}`,
            type: 'bff',
            parentId: regionId,
            params: {
                instances: 140,
                downstreamCalls: 3,
                callMode: 'parallel',
                aggregationMs: 4,
                partialFailureMode: 'degrade',
                serviceTimeMs: 8,
                serviceTimeSigma: 0.5,
                downstreamCallMs: 20,
                cpuShare: 0.06,
                cpuCores: 8,
                concurrencyPerInstance: 256,
                timeoutMs: 600,
            },
            position: { x: 320, y: 60 },
        },
        {
            id: `timeline-${suffix}`,
            type: 'redis',
            parentId: regionId,
            params: {
                shards: 48,
                replicasPerShard: 2,
                memoryGb: 64,
                uniqueKeys: 300000000,
                keySizeBytes: 32,
                valueSizeBytes: 24000,
                ttlSec: 900,
                zipfAlpha: 1.2,
                maxOpsPerSec: 140000,
                concurrencyControl: 'optimistic',
            },
            position: { x: 620, y: 20 },
        },
        {
            id: `posts-${suffix}`,
            type: 'scylla',
            parentId: regionId,
            params: {
                nodes: 30,
                replicationFactor: 3,
                partitionKey: 'authorId',
                rowCount: 900000000000,
                rowSizeBytes: 800,
                storageGbPerNode: 16000,
                maxOpsPerSecPerNode: 45000,
                replicaLagMs: 120,
                hintedHandoff: true,
                concurrencyControl: 'optimistic',
                conflictResolution: 'single-writer-per-key',
            },
            position: { x: 620, y: 180 },
        },
        {
            id: `ranker-${suffix}`,
            type: 'ml-inference',
            parentId: regionId,
            params: {
                instances: 8,
                gpuCount: 8,
                gpuType: 'l4',
                throughputPerGpu: 5000,
                batchSize: 32,
                inferenceMs: 12,
                modelSizeGb: 4,
                gpuMemoryGb: 24,
                quantized: true,
                timeoutMs: 250,
            },
            position: { x: 620, y: 330 },
        },
    ];
}

function regionLinks(suffix: string): LinkSpec[] {
    return [
        { from: 'router', to: `edge-${suffix}`, weight: 1, readShare: 0.9 },
        { from: `edge-${suffix}`, to: `feed-${suffix}`, readShare: 0.9, calls: readCalls },
        {
            from: `feed-${suffix}`,
            to: `timeline-${suffix}`,
            readShare: 0.97,
            policy: { timeoutMs: 200, retries: 1, circuitBreaker: true, idempotent: true },
        },
        {
            from: `feed-${suffix}`,
            to: `posts-${suffix}`,
            readShare: 0.9,
            calls: { fanout: 0.2 },
            policy: { timeoutMs: 400, retries: 1, circuitBreaker: true, idempotent: true },
        },
        {
            from: `feed-${suffix}`,
            to: `ranker-${suffix}`,
            readShare: 1,
            calls: { fanout: 0.02 },
            policy: { timeoutMs: 250, retries: 0, circuitBreaker: true, idempotent: true },
        },
        { from: `feed-${suffix}`, to: 'events', calls: { fanout: 0.02, requestBytes: 2000, responseBytes: 0 } },
        { from: 'fanout', to: `timeline-${suffix}`, readShare: 0, calls: { fanout: 0.4 } },
    ];
}

function globalNodes(): NodeSpec[] {
    return [
        {
            id: 'router',
            type: 'glb',
            params: { regions: 2, routingPolicy: 'geo', stickyRegion: true, failoverSec: 20, maxRps: 4000000 },
            position: { x: 300, y: 420 },
        },
        {
            id: 'policy',
            type: 'multi-region-policy',
            params: {
                mode: 'active-active',
                writeRegion: 'owner-of-key',
                replicationDirection: 'bidirectional',
                conflictResolution: 'single-writer-per-key',
                failoverMode: 'auto',
                failbackPolicy: 'manual',
                dataResidency: 'none',
                rpoTargetSec: 30,
                rtoTargetSec: 300,
            },
            position: { x: 300, y: 20 },
        },
        {
            id: 'events',
            type: 'kafka',
            params: {
                brokers: 24,
                partitions: 200,
                replicationFactor: 3,
                minInsync: 2,
                messageSizeKb: 2,
                batchMs: 20,
                compression: 'zstd',
                retentionHours: 72,
                diskGbPerBroker: 8000,
                throughputMbsPerBroker: 400,
            },
            position: { x: 1900, y: 300 },
        },
        {
            id: 'fanout',
            type: 'stream-processor',
            params: {
                parallelism: 200,
                partitions: 200,
                recordsPerSecPerTask: 20000,
                stateSizeGb: 1200,
                checkpointIntervalSec: 30,
                windowType: 'session',
                exactlyOnce: true,
                watermarkLagSec: 10,
                instances: 20,
                memoryGb: 128,
            },
            position: { x: 2200, y: 300 },
        },
        {
            id: 'graph',
            type: 'neo4j',
            params: {
                nodes: 6,
                readReplicas: 4,
                nodeCount: 1000000000,
                edgeCount: 200000000000,
                traversalDepth: 1,
                queryComplexity: 'neighbourhood',
                cacheGb: 256,
                heapGb: 64,
                cpuCores: 32,
                provisionedIops: 60000,
                readFromReplica: 0.9,
                replicaLagMs: 100,
            },
            position: { x: 2500, y: 160 },
        },
        {
            id: 'deadletter',
            type: 'dlq',
            params: {
                maxRetries: 5,
                reprocessMode: 'scheduled',
                redriveDelaySec: 300,
                alertThresholdMessages: 100,
                maxDepth: 200000000,
                retentionHours: 168,
                messageSizeKb: 2,
            },
            position: { x: 2500, y: 620 },
        },
        {
            id: 'indexer',
            type: 'search-indexer',
            params: {
                instances: 8,
                docsPerSec: 40000,
                docSizeKb: 2,
                indexExpansionRatio: 1.4,
                indexLagSec: 20,
                refreshIntervalSec: 5,
                indexServiceMs: 2,
                cpuShare: 0.3,
                cpuCores: 16,
                memoryGb: 32,
            },
            position: { x: 2200, y: 460 },
        },
        {
            id: 'vectors',
            type: 'vector-db',
            params: {
                nodes: 12,
                replicas: 2,
                vectorCount: 4000000000,
                dimensions: 256,
                indexType: 'hnsw',
                recallTarget: 0.9,
                topK: 100,
                memoryGb: 192,
                cpuCores: 32,
                queryConcurrency: 128,
                queryServiceMs: 4,
                indexServiceMs: 2,
            },
            position: { x: 2500, y: 460 },
        },
    ];
}

function globalLinks(): LinkSpec[] {
    return [
        { from: 'events', to: 'fanout', policy: { timeoutMs: 20000, retries: 2, circuitBreaker: true, idempotent: true } },
        {
            from: 'fanout',
            to: 'graph',
            readShare: 1,
            calls: { fanout: 0.5 },
            policy: { timeoutMs: 2000, retries: 1, circuitBreaker: true, idempotent: true },
        },
        { from: 'events', to: 'indexer', policy: { timeoutMs: 20000, retries: 2, circuitBreaker: true, idempotent: true } },
        { from: 'events', to: 'deadletter', calls: { fanout: 0.0002 } },
        {
            from: 'indexer',
            to: 'vectors',
            readShare: 0,
            calls: { fanout: 0.4 },
            policy: { timeoutMs: 3000, retries: 1, circuitBreaker: true, idempotent: true },
        },
        {
            from: 'ranker-eu',
            to: 'vectors',
            readShare: 1,
            policy: { timeoutMs: 200, retries: 0, circuitBreaker: true, idempotent: true },
        },
        {
            from: 'ranker-us',
            to: 'vectors',
            readShare: 1,
            policy: { timeoutMs: 200, retries: 0, circuitBreaker: true, idempotent: true },
        },
        { from: 'posts-eu', to: 'posts-us' },
        { from: 'posts-us', to: 'posts-eu' },
    ];
}

function starter(): SchemeV1 {
    return buildScheme({
        id: 'global-feed',
        name: 'Глобальная лента',
        nodes: [
            { id: READERS, type: 'client-mobile', params: readerParams, position: { x: 0, y: 200 } },
            { id: AUTHORS, type: 'client-mobile', params: authorParams, position: { x: 0, y: 600 } },
        ],
        links: [],
    });
}

function twoRegionFanout(): SchemeV1 {
    return buildScheme({
        id: 'global-feed-two-region',
        name: 'Два активных региона, готовые ленты и ранжирование на GPU',
        nodes: [
            { id: READERS, type: 'client-mobile', params: readerParams, position: { x: 0, y: 200 } },
            { id: AUTHORS, type: 'client-mobile', params: authorParams, position: { x: 0, y: 600 } },
            ...globalNodes(),
            {
                id: 'region-eu',
                type: 'region',
                position: { x: 700, y: 60 },
                size: { width: 900, height: 420 },
                params: { code: 'eu-west-1', geo: 'europe', isPrimary: true, dataResidency: 'none' },
            },
            {
                id: 'region-us',
                type: 'region',
                position: { x: 700, y: 540 },
                size: { width: 900, height: 420 },
                params: { code: 'us-east-1', geo: 'north-america', isPrimary: false, dataResidency: 'none' },
            },
            ...regionNodes('eu', 'region-eu'),
            ...regionNodes('us', 'region-us'),
        ],
        links: [
            { from: READERS, to: 'router', readShare: 0.97, calls: readCalls },
            { from: AUTHORS, to: 'router', readShare: 0.05, calls: writeCalls },
            ...regionLinks('eu'),
            ...regionLinks('us'),
            ...globalLinks(),
        ],
    });
}

function singleRegionPullFeed(): SchemeV1 {
    return buildScheme({
        id: 'global-feed-single',
        name: 'Один регион и лента, собираемая на чтении',
        nodes: [
            { id: READERS, type: 'client-mobile', params: readerParams, position: { x: 0, y: 200 } },
            { id: AUTHORS, type: 'client-mobile', params: authorParams, position: { x: 0, y: 600 } },
            {
                id: 'edge',
                type: 'lb-l7',
                params: {
                    instances: 24,
                    azSpread: 3,
                    maxRpsPerInstance: 25000,
                    maxConnections: 400000,
                    cpuCores: 16,
                    tlsTerminate: true,
                    latencyMs: 0.6,
                },
                position: { x: 340, y: 400 },
            },
            {
                id: 'feed',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 12,
                    serviceTimeSigma: 0.7,
                    cpuShare: 0.08,
                    instances: 160,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 256,
                    queueLimit: 8000,
                },
                position: { x: 700, y: 400 },
            },
            {
                id: 'posts',
                type: 'scylla',
                params: {
                    nodes: 60,
                    replicationFactor: 3,
                    partitionKey: 'authorId',
                    rowCount: 900000000000,
                    rowSizeBytes: 800,
                    storageGbPerNode: 16000,
                    maxOpsPerSecPerNode: 45000,
                    hintedHandoff: true,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 1060, y: 400 },
            },
        ],
        links: [
            { from: READERS, to: 'edge', readShare: 0.97, calls: readCalls },
            { from: AUTHORS, to: 'edge', readShare: 0.05, calls: writeCalls },
            { from: 'edge', to: 'feed', readShare: 0.9, calls: readCalls },
            { from: 'feed', to: 'posts', readShare: 0.9, calls: { fanout: 12 } },
        ],
    });
}

export const globalFeed: Challenge = {
    id: 'global-feed',
    level: 5,
    estimatedMinutes: 90,
    tags: ['feed', 'fanout', 'multi-region', 'ml-ranking', 'cost'],
    title: { ru: 'Глобальная лента на миллиард', en: 'A billion-user global feed' },
    brief: {
        ru: 'Триста миллионов человек в сутки открывают ленту — 173 000 запросов в секунду, распределённых по всей планете. Двадцать миллионов авторов пишут 12 постов в секунду, и у самых заметных из них по сто миллионов подписчиков: один пост превращается в сто миллионов обновлений чужих лент. Лента должна собираться за 250 мс в любой точке мира, каждый пост — ранжироваться моделью, а потеря региона не должна стоить больше тридцати секунд записей. И всё это надо уместить в бюджет, где главная статья расходов — не серверы, а память под готовые ленты.',
        en: 'Three hundred million people a day open the feed — 173,000 requests per second spread across the planet. Twenty million authors write 12 posts per second, and the loudest of them have a hundred million followers each: one post becomes a hundred million updates to other people’s timelines. The feed must assemble in 250 ms anywhere in the world, every post must be ranked by a model, and losing a region must not cost more than thirty seconds of writes. All of it inside a budget whose biggest line item is not servers but memory for prebuilt timelines.',
    },
    given: {
        dau: readerParams.dau,
        requestsPerUserDay: readerParams.sessionsPerUserDay * readerParams.requestsPerSession,
        avgRps: 173611,
        authorsDau: authorParams.dau,
        postsPerSec: 12,
        maxFollowers: 100000000,
        regions: 2,
        crossRegionRttMs: 80,
        rpoTargetSec: 30,
        rtoTargetSec: 300,
        peakFactor: readerParams.peakFactor,
        clientRttMs: readerParams.networkRttMs,
    },
    flows: [
        { id: READERS, name: { ru: 'Открытие ленты', en: 'Open the feed' }, weightInScore: 0.75 },
        { id: AUTHORS, name: { ru: 'Публикация поста', en: 'Publish a post' }, weightInScore: 0.25 },
    ],
    constraints: {
        maxNodes: 26,
        allowedGroups: [
            'clients',
            'edge',
            'compute',
            'sql',
            'nosql',
            'cache',
            'messaging',
            'search',
            'olap',
            'storage',
            'platform',
            'observability',
            'topology',
        ],
    },
    requiredConsistencyModel: 'anomalies',
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: {
                ru: 'Лента собирается из готовой структуры в памяти, а не запросом ко всем авторам',
                en: 'The feed is assembled from a prebuilt in-memory structure, not by querying every author',
            },
            flow: READERS,
            to: { group: 'cache' },
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Пост доезжает до долговечного хранилища и до разносчика по лентам через лог событий',
                en: 'A post reaches durable storage and the timeline fan-out through an event log',
            },
            flow: AUTHORS,
            to: { type: 'stream-processor' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'stream-processor' },
        },
        {
            id: 'R3',
            kind: 'geo',
            desc: {
                ru: 'Минимум два региона и не больше 60 мс до входной точки',
                en: 'At least two regions and no more than 60 ms to the entry point',
            },
            minRegions: 2,
            maxClientRttMs: 60,
        },
        {
            id: 'R4',
            kind: 'rpo-rto',
            desc: {
                ru: 'Потеря региона стоит не больше 30 секунд записей и 5 минут переключения',
                en: 'Losing a region costs at most 30 seconds of writes and 5 minutes of failover',
            },
            maxRpoSec: 30,
            maxRtoSec: 300,
        },
        {
            id: 'R5',
            kind: 'anomaly',
            desc: {
                ru: 'Одновременная запись в двух регионах не порождает конфликтов',
                en: 'Simultaneous writes in two regions never produce conflicts',
            },
            code: 'write-conflict',
            maxRatePerSec: 0,
            scenario: 'write-conflict',
        },
        {
            id: 'R6',
            kind: 'anomaly',
            desc: {
                ru: 'Повторная доставка события не удваивает пост в чужой ленте',
                en: 'A redelivered event never doubles a post in someone else’s timeline',
            },
            code: 'duplicate-processing',
            maxRatePerSec: 0,
        },
        {
            id: 'R7',
            kind: 'slo',
            desc: { ru: 'p99 сборки ленты не выше 250 мс', en: 'p99 of feed assembly stays under 250 ms' },
            flow: READERS,
            metric: 'latency.p99',
            max: 250,
        },
        {
            id: 'R8',
            kind: 'slo',
            desc: { ru: 'p99 публикации поста не выше 400 мс', en: 'p99 of publishing a post stays under 400 ms' },
            flow: AUTHORS,
            metric: 'latency.p99',
            max: 400,
        },
        {
            id: 'R9',
            kind: 'capacity',
            desc: {
                ru: 'Ни один блок не загружен выше 45% — при потере региона второй берёт всё',
                en: 'No block runs hotter than 45% — when a region dies the other takes everything',
            },
            maxUtilization: 0.45,
        },
        {
            id: 'R10',
            kind: 'freshness',
            desc: {
                ru: 'Разнос постов по лентам отстаёт не больше чем на 20 секунд',
                en: 'Timeline fan-out lags by no more than 20 seconds',
            },
            maxLagSec: 20,
        },
        {
            id: 'R11',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $3.5 млн в месяц', en: 'Monthly cost stays under $3.5M' },
            maxMonthlyCostUsd: 3500000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианная лента укладывается в 140 мс', en: 'Median feed stays under 140 ms' },
            flow: READERS,
            metric: 'latency.p50',
            max: 140,
        },
        {
            id: 'B2',
            kind: 'anomaly',
            desc: {
                ru: 'Устаревших чтений ленты не больше 3% — секунда отставания реплики допустима',
                en: 'No more than 3% stale feed reads — a second of replica lag is acceptable',
            },
            code: 'stale-read',
            maxSharePercent: 3,
        },
    ],
    scenarios: { required: ['peak', 'region-failure', 'write-conflict'], bonus: ['cache-flush', 'stale-read'] },
    relaxation: {
        peak: { utilizationFactor: 1.9, latencyFactor: 1.5 },
        'region-failure': { utilizationFactor: 2.1, latencyFactor: 2 },
        'write-conflict': { utilizationFactor: 1.9, latencyFactor: 1.5 },
        'cache-flush': { utilizationFactor: 2.1, latencyFactor: 3 },
        'stale-read': { utilizationFactor: 1.9, latencyFactor: 1.5 },
    },
    lockedParams: { [READERS]: readerParams, [AUTHORS]: authorParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько операций записи порождает один пост автора с сотней миллионов подписчиков — и сколько операций чтения сэкономит эта запись?',
                en: 'How many writes does one post from an author with a hundred million followers produce — and how many reads does that write save?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Сборка ленты на чтении — это десяток запросов к хранилищу постов на каждое открытие, то есть под два миллиона операций в секунду. Сборка на записи — это сто миллионов обновлений на один пост звезды. Ни то ни другое в чистом виде не работает: готовые ленты держите в памяти, а «звёзд» подмешивайте на чтении.',
                en: 'Assembling on read means a dozen queries to the post store per open — nearly two million operations per second. Assembling on write means a hundred million updates for one celebrity post. Neither works in its pure form: keep prebuilt timelines in memory and mix the celebrities in at read time.',
            },
            forRequirement: 'R1',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Два активных региона с гео-маршрутизацией и владельцем ключа: конфликтующих записей не возникает, а отставание реплики не может быть меньше половины межрегионального RTT — движок это проверит. В каждом регионе: готовые ленты в памяти, посты в широкой колоночной базе, ранжирование моделью на малой доле запросов. Разнос по лентам и индексация — за общим логом событий. И держите загрузку ниже половины: при потере региона второй принимает весь трафик.',
                en: 'Two active regions with geo routing and a key owner: conflicting writes never appear, and replica lag cannot be lower than half the cross-region RTT — the engine will check that. In each region: prebuilt timelines in memory, posts in a wide-column store, model ranking on a small share of requests. Fan-out and indexing live behind a shared event log. And keep utilisation below half: when a region dies the other takes all the traffic.',
            },
            forRequirement: 'R9',
        },
    ],
    referenceSolutions: [
        {
            id: 'two-region-fanout',
            name: { ru: 'Два региона и готовые ленты', en: 'Two regions and prebuilt timelines' },
            tradeoff: {
                ru: 'Лента собрана заранее и лежит в памяти ближайшего региона, посты реплицируются между регионами с владельцем ключа, ранжирование включается только там, где оно меняет порядок. Платите памятью — терабайты под готовые ленты стоят больше, чем весь compute, — и тем, что при потере региона вторая половина планеты ходит через океан.',
                en: 'The feed is prebuilt and sits in the memory of the nearest region, posts replicate between regions with a key owner, ranking kicks in only where it changes the order. You pay in memory — terabytes of prebuilt timelines cost more than all the compute — and with the fact that when a region dies half the planet crosses the ocean.',
            },
            build: twoRegionFanout,
        },
        {
            id: 'single-region-pull',
            name: { ru: 'Один регион, лента на чтении', en: 'One region, feed on read' },
            tradeoff: {
                ru: 'Нет ни репликации, ни разноса по лентам, ни отдельного хранилища готовых лент — только сервис и колоночная база. Ровно поэтому каждое открытие ленты превращается в дюжину обращений к постам, что даёт два миллиона операций в секунду по одному кластеру, а половина планеты ходит через океан за каждым запросом.',
                en: 'No replication, no fan-out, no separate timeline store — just a service and a wide-column database. Which is exactly why every feed open becomes a dozen post lookups, two million operations per second on one cluster, and half the planet crosses the ocean for every request.',
            },
            build: singleRegionPullFeed,
        },
    ],
};
