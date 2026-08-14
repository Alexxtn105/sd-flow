import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const USERS = 'users';

const userParams = {
    dau: 60000000,
    sessionsPerUserDay: 3,
    requestsPerSession: 6,
    sessionDurationMin: 2,
    peakFactor: 2,
    diurnalPattern: 'global',
    readWriteMix: 0.85,
    cacheableShare: 0.7,
    avgRequestKb: 0.3,
    avgResponseKb: 0.8,
    geoDistribution: 'global',
};

const clientCalls = { requestBytes: 300, responseBytes: 800 };
const cacheCalls = { requestBytes: 100, responseBytes: 800 };
const indexReadCalls = { requestBytes: 120, responseBytes: 800 };
const searchReadCalls = { requestBytes: 200, responseBytes: 800 };
const submitCalls = { fanout: 0.15, requestBytes: 400 };
const indexWriteCalls = { fanout: 0.2, requestBytes: 400, responseBytes: 100 };

const balancerParams = {
    instances: 2,
    azSpread: 3,
    maxRpsPerInstance: 25000,
    maxConnections: 200000,
    cpuCores: 8,
    tlsTerminate: true,
    tlsHandshakeMs: 1.2,
    keepAlive: true,
    latencyMs: 1,
    timeoutMs: 250,
    retryPolicy: 'none',
    costPerInstanceHour: 0.09,
};

const suggestParams = {
    runtime: 'go',
    instances: 4,
    autoscale: true,
    autoscaleMax: 40,
    autoscaleTargetUtilization: 0.5,
    azSpread: 3,
    serviceTimeMs: 6,
    serviceTimeSigma: 0.5,
    cpuShare: 0.25,
    concurrencyPerInstance: 256,
    cpuCores: 8,
    memoryGb: 8,
    networkMbps: 2000,
    timeoutMs: 150,
    queueLimit: 500,
    costPerInstanceHour: 0.17,
};

const queueParams = {
    brokers: 3,
    topics: 4,
    partitions: 24,
    replicationFactor: 3,
    minInsync: 2,
    messageSizeKb: 1,
    compression: 'lz4',
    retentionHours: 72,
    produceLatencyMs: 5,
    consumerGroups: 2,
    costPerInstanceHour: 0.45,
};

const indexerParams = {
    instances: 3,
    docsPerSec: 2000,
    docSizeKb: 0.3,
    indexExpansionRatio: 1.4,
    indexLagSec: 30,
    refreshIntervalSec: 5,
    indexServiceMs: 5,
    cpuShare: 0.6,
    cpuCores: 8,
    memoryGb: 16,
    mergeThroughputMbs: 100,
    costPerInstanceHour: 0.4,
};

function starter(): SchemeV1 {
    return buildScheme({
        id: 'autocomplete',
        name: 'Автодополнение поиска',
        nodes: [{ id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 240 } }],
        links: [],
    });
}

function inMemoryPrefixIndex(): SchemeV1 {
    return buildScheme({
        id: 'autocomplete-fst',
        name: 'Префиксный индекс в памяти и обновление потоком',
        nodes: [
            { id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 240 } },
            { id: 'edge-lb', type: 'lb-l7', params: balancerParams, position: { x: 280, y: 240 } },
            { id: 'suggest', type: 'service', params: suggestParams, position: { x: 560, y: 240 } },
            {
                id: 'hot-prefixes',
                type: 'redis',
                params: {
                    mode: 'cluster',
                    shards: 2,
                    replicasPerShard: 1,
                    memoryGb: 5,
                    evictionPolicy: 'lru',
                    ttlSec: 3600,
                    keySizeBytes: 24,
                    valueSizeBytes: 200,
                    uniqueKeys: 400000000,
                    zipfAlpha: 0.8,
                    maxOpsPerSec: 100000,
                    maxConnections: 20000,
                    serviceTimeMs: 0.2,
                    persistence: 'none',
                    costPerInstanceHour: 0.25,
                },
                position: { x: 860, y: 80 },
            },
            {
                id: 'prefix-index',
                type: 'autocomplete',
                params: {
                    nodes: 3,
                    prefixCount: 400000000,
                    keySizeBytes: 24,
                    valueSizeBytes: 200,
                    memoryGb: 32,
                    cpuCores: 16,
                    queryConcurrency: 64,
                    queryServiceMs: 2,
                    indexServiceMs: 1,
                    updateLagMin: 10,
                    costPerInstanceHour: 0.35,
                },
                position: { x: 860, y: 300 },
            },
            { id: 'query-log', type: 'kafka', params: queueParams, position: { x: 560, y: 520 } },
            { id: 'indexer', type: 'search-indexer', params: indexerParams, position: { x: 860, y: 520 } },
        ],
        links: [
            { from: USERS, to: 'edge-lb', readShare: 0.85, calls: clientCalls },
            { from: 'edge-lb', to: 'suggest', readShare: 0.85, calls: clientCalls },
            { from: 'suggest', to: 'hot-prefixes', readShare: 1, calls: cacheCalls },
            {
                from: 'suggest',
                to: 'prefix-index',
                readShare: 1,
                calls: indexReadCalls,
                policy: { circuitBreaker: true },
            },
            { from: 'suggest', to: 'query-log', calls: submitCalls },
            { from: 'query-log', to: 'indexer', policy: { idempotent: true } },
            { from: 'indexer', to: 'prefix-index', readShare: 0, calls: indexWriteCalls },
        ],
    });
}

function searchClusterForEverything(): SchemeV1 {
    return buildScheme({
        id: 'autocomplete-elasticsearch',
        name: 'Подсказки прямо из поискового кластера',
        nodes: [
            { id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 240 } },
            { id: 'edge-lb', type: 'lb-l7', params: balancerParams, position: { x: 280, y: 240 } },
            { id: 'suggest', type: 'service', params: suggestParams, position: { x: 560, y: 240 } },
            {
                id: 'search-cluster',
                type: 'elasticsearch',
                params: {
                    nodes: 40,
                    shardsPerIndex: 8,
                    replicas: 1,
                    docCount: 400000000,
                    docSizeKb: 0.3,
                    indexExpansionRatio: 1.4,
                    indexedFields: 6,
                    refreshIntervalSec: 1,
                    queryType: 'match',
                    heapGb: 31,
                    cpuCores: 16,
                    storageGbPerNode: 500,
                    queryConcurrencyPerNode: 32,
                    queryServiceMs: 25,
                    indexServiceMs: 3,
                    replicaLagMs: 1000,
                    costPerInstanceHour: 0.6,
                },
                position: { x: 860, y: 240 },
            },
            { id: 'query-log', type: 'kafka', params: queueParams, position: { x: 560, y: 520 } },
            { id: 'indexer', type: 'search-indexer', params: indexerParams, position: { x: 860, y: 520 } },
        ],
        links: [
            { from: USERS, to: 'edge-lb', readShare: 0.85, calls: clientCalls },
            { from: 'edge-lb', to: 'suggest', readShare: 0.85, calls: clientCalls },
            { from: 'suggest', to: 'search-cluster', readShare: 1, calls: searchReadCalls },
            { from: 'suggest', to: 'query-log', calls: submitCalls },
            { from: 'query-log', to: 'indexer', policy: { idempotent: true } },
            { from: 'indexer', to: 'search-cluster', readShare: 0, calls: indexWriteCalls },
        ],
    });
}

export const autocomplete: Challenge = {
    id: 'autocomplete',
    level: 3,
    estimatedMinutes: 45,
    tags: ['latency', 'in-memory', 'search', 'cache', 'streaming'],
    title: { ru: 'Автодополнение поиска', en: 'Search autocomplete' },
    brief: {
        ru: 'Шестьдесят миллионов человек в сутки набирают запрос в строке поиска, и после каждой паузы в наборе браузер просит подсказку: три сессии по шесть запросов — 12 500 запросов в секунду в обычную минуту и 25 000 на пике. Список должен успеть нарисоваться до следующей нажатой клавиши: весь бюджет — 100 мс, и сорок пять из них уже съедены дорогой до дата-центра. Словарь — 400 млн префиксов с готовой десяткой продолжений: 22 ГБ, если сложить его в FST. И он не статичен: то, что люди ищут прямо сейчас, обязано попадать в подсказки за минуты, а не к следующему утру.',
        en: 'Sixty million people a day type into the search box, and after every pause the browser asks for suggestions: three sessions of six requests each — 12,500 requests per second on an ordinary minute and 25,000 at peak. The list has to be painted before the next keystroke: the whole budget is 100 ms and forty-five of them are already spent on the trip to the data centre. The dictionary is 400 million prefixes with a precomputed top ten: 22 GB once packed into an FST. And it is not static: whatever people are searching for right now has to reach the suggestions within minutes, not by next morning.',
    },
    given: {
        dau: userParams.dau,
        sessionsPerUserDay: userParams.sessionsPerUserDay,
        requestsPerSession: userParams.requestsPerSession,
        avgRps: 12500,
        peakRps: 25000,
        peakFactor: userParams.peakFactor,
        clientRttMs: 45,
        p99Ms: 100,
        prefixCount: 400000000,
        topK: 10,
        keySizeBytes: 24,
        valueSizeBytes: 200,
        indexRamGb: 22,
        updateLagMin: 10,
        avgResponseKb: userParams.avgResponseKb,
        writeShare: 0.15,
    },
    flows: [{ id: USERS, name: { ru: 'Запрос подсказки', en: 'Ask for suggestions' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 12,
        allowedGroups: [
            'clients',
            'edge',
            'compute',
            'cache',
            'search',
            'messaging',
            'sql',
            'nosql',
            'storage',
            'platform',
            'observability',
            'topology',
        ],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: {
                ru: 'Подсказка приходит из поисковой структуры, а не из реляционной базы по LIKE',
                en: 'A suggestion comes from a search structure, not from a relational database via LIKE',
            },
            flow: USERS,
            to: { group: 'search' },
            notVia: [{ group: 'sql' }],
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Индекс обновляется потоком за очередью, а не по ходу ответа на подсказку',
                en: 'The index is updated by a stream behind a queue, never inside the suggest response',
            },
            flow: USERS,
            to: { group: 'search' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'search-indexer' },
        },
        {
            id: 'R3',
            kind: 'slo',
            desc: {
                ru: 'p99 подсказки не выше 100 мс: 45 мс из них уже забрала дорога до клиента',
                en: 'Suggestion p99 stays under 100 ms, and 45 of those are already gone on the client round trip',
            },
            flow: USERS,
            metric: 'latency.p99',
            max: 100,
        },
        {
            id: 'R4',
            kind: 'slo',
            desc: {
                ru: 'Медианная подсказка укладывается в 70 мс — иначе список опаздывает за набором',
                en: 'The median suggestion fits into 70 ms, otherwise the list lags behind typing',
            },
            flow: USERS,
            metric: 'latency.p50',
            max: 70,
        },
        {
            id: 'R5',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 80%', en: 'No block runs hotter than 80%' },
            maxUtilization: 0.8,
        },
        {
            id: 'R6',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $12 000 в месяц', en: 'Monthly cost stays under $12,000' },
            maxMonthlyCostUsd: 12000,
        },
        {
            id: 'R7',
            kind: 'freshness',
            desc: {
                ru: 'Поток обновления индекса не копится: самое медленное асинхронное ребро отстаёт меньше чем на 2 секунды',
                en: 'The index-update stream does not pile up: the slowest asynchronous edge lags by under 2 seconds',
            },
            maxLagSec: 2,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: {
                ru: 'p99 укладывается в 80 мс — подсказка успевает между двумя нажатиями',
                en: 'p99 fits into 80 ms — the suggestion lands between two keystrokes',
            },
            flow: USERS,
            metric: 'latency.p99',
            max: 80,
        },
        {
            id: 'B2',
            kind: 'redundancy',
            desc: {
                ru: 'На пути подсказки нет ни одного одиночного инстанса',
                en: 'Not a single instance on the suggest path is alone',
            },
            flow: USERS,
            minRedundancy: 2,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.15, latencyFactor: 1.4 },
        'cache-flush': { latencyFactor: 1.6, utilizationFactor: 1.15 },
        'az-failure': { latencyFactor: 2, utilizationFactor: 1.3 },
    },
    lockedParams: { [USERS]: userParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько миллисекунд остаётся сервису после того, как из 100 мс вычли дорогу до клиента, и сколько дисковых обращений в этот остаток помещается?',
                en: 'How many milliseconds are left to the service once the client round trip is taken out of the 100 ms, and how many disk seeks fit into what remains?',
            },
            forRequirement: 'R3',
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Поиск по префиксу в полнотекстовом кластере стоит десятки миллисекунд CPU на запрос и веером идёт по всем шардам. Умножьте это на 12 500 запросов в секунду и посмотрите, сколько нод придётся купить. Готовая десятка продолжений на префикс — это 22 ГБ в FST, а он целиком помещается в память одной машины.',
                en: 'A prefix search in a full-text cluster costs tens of milliseconds of CPU per query and fans out across every shard. Multiply that by 12,500 requests per second and see how many nodes you have to buy. A precomputed top ten per prefix is 22 GB in an FST, and that fits into the memory of a single machine.',
            },
            forRequirement: 'R5',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Держите весь префиксный словарь резидентно в памяти нескольких одинаковых реплик и отвечайте из него за пару миллисекунд, а самые частые префиксы снимайте кэшем перед ним. Поток отправленных запросов уводите в очередь: индексатор разберёт его своим темпом и допишет в индекс — тогда лаг обновления виден отдельно от задержки ответа и не мешает ей.',
                en: 'Keep the whole prefix dictionary resident in the memory of a few identical replicas and answer from it in a couple of milliseconds, with a cache in front for the most frequent prefixes. Push the stream of submitted queries into a queue: the indexer drains it at its own pace and patches the index — then the update lag is visible separately from the response latency and does not get in its way.',
            },
            forRequirement: 'R7',
        },
    ],
    referenceSolutions: [
        {
            id: 'in-memory-prefix-index',
            name: {
                ru: 'FST в памяти, кэш горячих префиксов, обновление потоком',
                en: 'In-memory FST, hot-prefix cache, streaming updates',
            },
            tradeoff: {
                ru: 'Ответ собирается из двух обращений в память: кэш снимает половину запросов, остальные идут в реплику с резидентным словарём и возвращаются за две миллисекунды. Платите за это оперативной памятью — 22 ГБ словаря лежат на каждой реплике целиком — и тем, что новый тренд появляется в подсказках не мгновенно, а через очередь и индексатор.',
                en: 'The answer is assembled from two memory lookups: the cache takes half the requests, the rest go to a replica with the dictionary resident and come back in two milliseconds. You pay for it in RAM — all 22 GB of the dictionary sit on every replica — and with the fact that a new trend reaches the suggestions through a queue and an indexer rather than instantly.',
            },
            build: inMemoryPrefixIndex,
        },
        {
            id: 'search-cluster-for-everything',
            name: {
                ru: 'Подсказки прямо из поискового кластера',
                en: 'Suggestions straight from the search cluster',
            },
            tradeoff: {
                ru: 'Один индекс на всё: тот же кластер, что обслуживает полноценный поиск, отвечает и на подсказки. Заманчиво — не нужна отдельная система, ранжирование уже есть. Но каждый запрос веером идёт по восьми шардам и стоит двадцать пять миллисекунд CPU: сорока нод не хватает даже на среднюю нагрузку, а чтобы хватило, кластер придётся вырастить в пять раз и заплатить за это как за пять кластеров.',
                en: 'One index for everything: the very cluster that serves full search also answers suggestions. Tempting — no separate system to run, the ranking is already there. But every query fans out across eight shards and costs twenty-five milliseconds of CPU: forty nodes are not enough even for the average load, and to make them enough the cluster has to grow fivefold and be paid for as five clusters.',
            },
            build: searchClusterForEverything,
        },
    ],
};
