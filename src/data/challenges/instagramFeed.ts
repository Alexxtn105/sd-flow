import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const VIEWERS = 'viewers';
const AUTHORS = 'authors';

const viewerParams = {
    dau: 20000000,
    sessionsPerUserDay: 5,
    requestsPerSession: 12,
    avgRequestKb: 1,
    avgResponseKb: 90,
    readWriteMix: 0.98,
    cacheableShare: 0.9,
    peakFactor: 2,
    diurnalPattern: 'evening',
    geoDistribution: 'global',
    networkRttMs: 40,
};

const authorParams = {
    dau: 2000000,
    sessionsPerUserDay: 1,
    requestsPerSession: 1,
    avgRequestKb: 1200,
    avgResponseKb: 2,
    readWriteMix: 0,
    cacheableShare: 0,
    peakFactor: 2,
    diurnalPattern: 'evening',
    geoDistribution: 'global',
    networkRttMs: 40,
};

const photoCalls = { requestBytes: 1000, responseBytes: 90000 };
const feedCalls = { requestBytes: 1000, responseBytes: 12000 };
const uploadCalls = { requestBytes: 1200000, responseBytes: 2000 };
const timelineCalls = { requestBytes: 300, responseBytes: 1500 };
const hydrateCalls = { fanout: 2, requestBytes: 400, responseBytes: 4000 };
const rankCalls = { fanout: 0.2, requestBytes: 6000, responseBytes: 1500 };
const mediaWriteCalls = { requestBytes: 1200000, responseBytes: 200 };
const postWriteCalls = { requestBytes: 2000, responseBytes: 200 };
const spreadCalls = { fanout: 6, requestBytes: 500, responseBytes: 100 };
const pullCalls = { fanout: 12, requestBytes: 400, responseBytes: 4000 };
const originPhotoCalls = { fanout: 0.84, requestBytes: 1000, responseBytes: 90000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'instagram-feed',
        name: 'Фотолента',
        nodes: [
            { id: VIEWERS, type: 'client-mobile', params: viewerParams, position: { x: 0, y: 160 } },
            { id: AUTHORS, type: 'client-mobile', params: authorParams, position: { x: 0, y: 560 } },
        ],
        links: [],
    });
}

function cachedAndRanked(): SchemeV1 {
    return buildScheme({
        id: 'instagram-feed-cached',
        name: 'Готовая лента в памяти, фото через сеть доставки',
        nodes: [
            { id: VIEWERS, type: 'client-mobile', params: viewerParams, position: { x: 0, y: 160 } },
            { id: AUTHORS, type: 'client-mobile', params: authorParams, position: { x: 0, y: 560 } },
            {
                id: 'photo-cdn',
                type: 'cdn',
                params: {
                    popCount: 120,
                    avgObjectKb: 90,
                    maxObjectSizeMb: 20,
                    ttlSec: 86400,
                    staleWhileRevalidateSec: 60,
                    originShield: true,
                    costPerGbEgress: 0.02,
                    costPerMillionRequests: 0.4,
                },
                position: { x: 300, y: 40 },
            },
            {
                id: 'gw',
                type: 'api-gateway',
                params: {
                    instances: 2,
                    azSpread: 2,
                    maxRpsPerInstance: 3000,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 60,
                    payloadLimitMb: 16,
                },
                position: { x: 300, y: 300 },
            },
            {
                id: 'feed-api',
                type: 'service',
                params: {
                    instances: 2,
                    autoscaleMax: 60,
                    serviceTimeMs: 12,
                    callMode: 'parallel',
                    cpuShare: 0.1,
                },
                position: { x: 620, y: 220 },
            },
            {
                id: 'feed-cache',
                type: 'redis',
                params: {
                    shards: 2,
                    replicasPerShard: 1,
                    memoryGb: 16,
                    uniqueKeys: 20000000,
                    valueSizeBytes: 1200,
                    ttlSec: 900,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 940, y: 120 },
            },
            {
                id: 'ranker',
                type: 'ml-inference',
                params: {
                    instances: 2,
                    gpuCount: 1,
                    gpuType: 'l4',
                    throughputPerGpu: 350,
                    batchSize: 16,
                    inferenceMs: 20,
                    modelSizeGb: 2,
                    quantized: true,
                    costPerInstanceHour: 1.1,
                },
                position: { x: 940, y: 300 },
            },
            {
                id: 'posts',
                type: 'cassandra',
                params: {
                    nodes: 4,
                    replicationFactor: 3,
                    partitionKey: 'authorId',
                    rowCount: 4000000000,
                    rowSizeBytes: 600,
                    storageGbPerNode: 1500,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 940, y: 470 },
            },
            {
                id: 'media',
                type: 's3',
                params: {
                    avgObjectSizeMb: 0.12,
                    prefixCount: 40,
                    objectCount: 3000000000,
                    lifecycleDays: 0,
                    costPerGbEgress: 0.02,
                },
                position: { x: 620, y: 40 },
            },
            {
                id: 'events',
                type: 'kafka',
                params: { brokers: 3, partitions: 12, messageSizeKb: 2, retentionHours: 72 },
                position: { x: 620, y: 620 },
            },
            {
                id: 'fanout',
                type: 'worker',
                params: {
                    instances: 2,
                    concurrency: 2,
                    cpuCores: 1,
                    cpuShare: 0.5,
                    processingTimeMs: 60,
                },
                position: { x: 940, y: 620 },
            },
            {
                id: 'upload-api',
                type: 'service',
                params: {
                    instances: 2,
                    autoscaleMax: 24,
                    serviceTimeMs: 45,
                    networkMbps: 400,
                },
                position: { x: 620, y: 420 },
            },
        ],
        links: [
            { from: VIEWERS, to: 'photo-cdn', weight: 10, readShare: 1, calls: photoCalls },
            { from: VIEWERS, to: 'gw', weight: 2, readShare: 0.9, calls: feedCalls },
            { from: AUTHORS, to: 'gw', weight: 1, readShare: 0, calls: uploadCalls },
            { from: 'photo-cdn', to: 'media', readShare: 1, calls: photoCalls },
            { from: 'gw', to: 'feed-api', weight: 0.99, readShare: 0.9, calls: feedCalls },
            { from: 'gw', to: 'upload-api', weight: 0.01, readShare: 0, calls: uploadCalls },
            { from: 'feed-api', to: 'feed-cache', readShare: 0.95, calls: timelineCalls },
            { from: 'feed-api', to: 'ranker', readShare: 1, calls: rankCalls },
            { from: 'feed-api', to: 'posts', readShare: 0.95, calls: hydrateCalls },
            { from: 'upload-api', to: 'media', readShare: 0, calls: mediaWriteCalls },
            { from: 'upload-api', to: 'posts', readShare: 0, calls: postWriteCalls },
            { from: 'upload-api', to: 'events', calls: { fanout: 1, requestBytes: 2000 } },
            { from: 'events', to: 'fanout' },
            { from: 'fanout', to: 'feed-cache', readShare: 0, calls: spreadCalls },
        ],
    });
}

function originServed(): SchemeV1 {
    return buildScheme({
        id: 'instagram-feed-origin',
        name: 'Лента собирается на чтении, фото отдаёт сервис',
        nodes: [
            { id: VIEWERS, type: 'client-mobile', params: viewerParams, position: { x: 0, y: 160 } },
            { id: AUTHORS, type: 'client-mobile', params: authorParams, position: { x: 0, y: 560 } },
            {
                id: 'gw',
                type: 'api-gateway',
                params: {
                    instances: 8,
                    azSpread: 3,
                    maxRpsPerInstance: 10000,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 60,
                    payloadLimitMb: 16,
                },
                position: { x: 300, y: 300 },
            },
            {
                id: 'feed-api',
                type: 'service',
                params: {
                    instances: 40,
                    autoscaleMax: 200,
                    serviceTimeMs: 14,
                    callMode: 'parallel',
                    cpuShare: 0.1,
                    networkMbps: 10000,
                },
                position: { x: 620, y: 220 },
            },
            {
                id: 'posts',
                type: 'cassandra',
                params: {
                    nodes: 12,
                    replicationFactor: 3,
                    partitionKey: 'authorId',
                    rowCount: 4000000000,
                    rowSizeBytes: 600,
                    storageGbPerNode: 2000,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 940, y: 340 },
            },
            {
                id: 'media',
                type: 's3',
                params: {
                    avgObjectSizeMb: 0.12,
                    prefixCount: 40,
                    objectCount: 3000000000,
                    lifecycleDays: 0,
                    costPerGbEgress: 0.02,
                },
                position: { x: 940, y: 120 },
            },
            {
                id: 'upload-api',
                type: 'service',
                params: {
                    instances: 3,
                    autoscaleMax: 24,
                    serviceTimeMs: 45,
                    networkMbps: 4000,
                },
                position: { x: 620, y: 520 },
            },
        ],
        links: [
            { from: VIEWERS, to: 'gw', weight: 12, readShare: 0.92, calls: { requestBytes: 1000, responseBytes: 77000 } },
            { from: AUTHORS, to: 'gw', weight: 1, readShare: 0, calls: uploadCalls },
            {
                from: 'gw',
                to: 'feed-api',
                weight: 0.99,
                readShare: 0.92,
                calls: { requestBytes: 1000, responseBytes: 77000 },
            },
            { from: 'gw', to: 'upload-api', weight: 0.01, readShare: 0, calls: uploadCalls },
            { from: 'feed-api', to: 'posts', readShare: 0.85, calls: pullCalls },
            { from: 'feed-api', to: 'media', readShare: 1, calls: originPhotoCalls },
            { from: 'upload-api', to: 'media', readShare: 0, calls: mediaWriteCalls },
            { from: 'upload-api', to: 'posts', readShare: 0, calls: postWriteCalls },
        ],
    });
}

export const instagramFeed: Challenge = {
    id: 'instagram-feed',
    level: 2,
    estimatedMinutes: 30,
    tags: ['feed', 'cache', 'media', 'cdn', 'ranking'],
    title: { ru: 'Фотолента', en: 'Photo feed' },
    brief: {
        ru: 'Двадцать миллионов человек в сутки листают фотоленту: 13 900 запросов в секунду, но только каждый шестой из них — за самой лентой, остальные пять из шести тянут картинки по 90 КБ. Это гигабайт в секунду, и от того, откуда он льётся, счёт за месяц отличается втрое. Сама лента при этом не хронология: порядок карточек выбирает модель, а звать её на каждое открытие — отдельные деньги. Два миллиона публикаций в сутки против миллиарда открытий: подумайте, в какой из этих двух моментов дешевле делать работу.',
        en: 'Twenty million people a day scroll a photo feed: 13,900 requests per second, but only one in six asks for the feed itself — the other five in six pull 90 KB images. That is a gigabyte per second, and where it flows from changes the monthly bill threefold. And the feed is not a timeline: a model picks the order of the cards, and calling it on every open costs real money. Two million posts a day against a billion feed opens: think about which of those two moments is the cheaper place to do the work.',
    },
    given: {
        dau: viewerParams.dau,
        sessionsPerUserDay: viewerParams.sessionsPerUserDay,
        requestsPerSession: viewerParams.requestsPerSession,
        avgRps: 13889,
        readShare: viewerParams.readWriteMix,
        avgFollowees: 300,
        avgFollowers: 300,
        uploadsPerDay: authorParams.dau,
        postsPerSec: 23,
        avgObjectKb: 90,
        avgUploadKb: authorParams.avgRequestKb,
        egressGbPerSec: 1.04,
        cdnEgressUsdPerGb: 0.02,
        peakFactor: viewerParams.peakFactor,
    },
    flows: [
        { id: VIEWERS, name: { ru: 'Листать ленту', en: 'Scroll the feed' }, weightInScore: 0.8 },
        { id: AUTHORS, name: { ru: 'Опубликовать фото', en: 'Publish a photo' }, weightInScore: 0.2 },
    ],
    constraints: {
        maxNodes: 14,
        allowedGroups: ['clients', 'edge', 'compute', 'cache', 'nosql', 'sql', 'storage', 'messaging', 'topology'],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: {
                ru: 'Лента отдаётся из заранее собранной структуры в памяти, а не пересобирается на каждое открытие',
                en: 'The feed is served from a prebuilt in-memory structure, not reassembled on every open',
            },
            flow: VIEWERS,
            to: { group: 'cache' },
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Картинки едут к зрителю через сеть доставки, а не из origin на каждый просмотр',
                en: 'Images reach the viewer through a delivery network, not from the origin on every view',
            },
            flow: VIEWERS,
            to: { group: 'storage' },
            viaAny: [{ type: 'cdn' }],
            notVia: [{ group: 'sql' }],
        },
        {
            id: 'R3',
            kind: 'capability',
            desc: {
                ru: 'Порядок карточек выбирает модель ранжирования, а не время публикации',
                en: 'A ranking model picks the order of the cards, not the publication time',
            },
            flow: VIEWERS,
            to: { type: 'ml-inference' },
        },
        {
            id: 'R4',
            kind: 'slo',
            desc: { ru: 'p99 открытия ленты не выше 400 мс', en: 'Feed open p99 stays under 400 ms' },
            flow: VIEWERS,
            metric: 'latency.p99',
            max: 400,
        },
        {
            id: 'R5',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 70%', en: 'No block runs hotter than 70%' },
            maxUtilization: 0.7,
        },
        {
            id: 'R6',
            kind: 'durability',
            desc: {
                ru: 'Опубликованная фотография живёт минимум в трёх копиях',
                en: 'A published photo lives in at least three copies',
            },
            flow: AUTHORS,
            minReplication: 3,
        },
        {
            id: 'R7',
            kind: 'anomaly',
            desc: {
                ru: 'Лента не прыгает назад: не больше 1% чтений видят более старое состояние, чем предыдущее',
                en: 'The feed never jumps backwards: no more than 1% of reads see an older state than the previous one',
            },
            code: 'monotonic-read',
            maxSharePercent: 1,
        },
        {
            id: 'R8',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $150 000 в месяц', en: 'Monthly cost stays under $150,000' },
            maxMonthlyCostUsd: 150000,
        },
        {
            id: 'R9',
            kind: 'security',
            desc: {
                ru: 'Аутентификация на входе, TLS рвётся на периметре, клиент не ходит в хранилище напрямую',
                en: 'Authentication at the entry point, TLS terminated at the perimeter, no client talks to storage directly',
            },
            requires: ['auth-on-edge', 'no-direct-client-to-db', 'tls-terminate'],
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианное открытие ленты укладывается в 150 мс', en: 'Median feed open stays under 150 ms' },
            flow: VIEWERS,
            metric: 'latency.p50',
            max: 150,
        },
        {
            id: 'B2',
            kind: 'budget',
            desc: { ru: 'Уложиться в $130 000 в месяц', en: 'Stay under $130,000 a month' },
            maxMonthlyCostUsd: 130000,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.35 },
        'cache-flush': { latencyFactor: 3, utilizationFactor: 1.4 },
        'az-failure': { latencyFactor: 2, utilizationFactor: 1.3 },
    },
    lockedParams: { [VIEWERS]: viewerParams, [AUTHORS]: authorParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Посчитайте два потока отдельно: сколько запросов в секунду приходится на саму ленту и сколько — на картинки, и сколько байт весит каждый.',
                en: 'Count the two streams separately: how many requests per second go to the feed itself and how many to the images, and how many bytes each carries.',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Гигабайт в секунду картинок — это 2.7 млн гигабайт в месяц. Из объектного хранилища по прайсу $0.09 за гигабайт получается $243 000 за одну только раздачу, и это ещё до счёта за сам API-шлюз, через который вы эти байты прогнали. Сеть доставки берёт $0.02 и при hit ratio 0.92 оставляет origin восемь процентов трафика.',
                en: 'A gigabyte per second of images is 2.7 million gigabytes a month. Out of object storage at $0.09 per gigabyte that is $243,000 for delivery alone — before the bill for the API gateway you pushed those bytes through. A delivery network charges $0.02 and, at a 0.92 hit ratio, leaves the origin eight percent of the traffic.',
            },
            forRequirement: 'R8',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Собирайте ленту заранее: публикация случается в сто раз реже открытия, поэтому раскладывать пост по готовым лентам дешевле в фоне за очередью. В памяти держите только список идентификаторов — тела постов достаются из хранилища одной пачкой. Модель ранжирования зовите не на каждое открытие, а на первую страницу сессии: это одна пятая запросов вместо всех.',
                en: 'Build the feed up front: publishing happens a hundred times less often than opening, so spreading a post into prepared timelines in the background behind a queue is cheaper. Keep only the list of identifiers in memory — the post bodies come out of the store in one batch. Call the ranking model not on every open but on the first page of a session: that is one request in five instead of all of them.',
            },
            forRequirement: 'R1',
        },
    ],
    referenceSolutions: [
        {
            id: 'cached-and-ranked',
            name: { ru: 'Готовая лента и сеть доставки', en: 'Prebuilt feed and a delivery network' },
            tradeoff: {
                ru: 'Публикация уходит в очередь, фоновый обработчик раскладывает её по трёмстам чужим лентам пачками по полсотни — шесть обращений в память на пост. В памяти лежат только идентификаторы, тела достаются из колоночной базы одной пачкой на страницу, модель ранжирования включается на первой странице сессии, а картинки живут на краю сети. Платите за это памятью под двадцать миллионов лент, секундами задержки раскладки и тем, что лента и посты теперь лежат в двух местах сразу.',
                en: 'A publish goes to a queue and a background consumer spreads it into three hundred other timelines in batches of fifty — six memory calls per post. Memory holds only identifiers, the bodies come out of the wide-column store in one batch per page, the ranking model runs on the first page of a session, and the images live at the edge of the network. You pay with memory for twenty million timelines, seconds of spreading lag, and the fact that the feed and the posts now live in two places at once.',
            },
            build: cachedAndRanked,
        },
        {
            id: 'origin-served',
            name: { ru: 'Лента на чтении, фото из origin', en: 'Feed on read, photos from the origin' },
            tradeoff: {
                ru: 'Вдвое меньше блоков, никакого дублирования и никакой задержки раскладки: и лента, и картинки собираются в момент запроса, а хопов на пути меньше — медиана даже лучше. Расплата тройная. Гигабайт картинок в секунду идёт через API-шлюз и оплачивается по прайсу origin: только за шлюз выходит $381 000 в месяц. Каждое открытие превращается в дюжину обращений к постам — 165 000 операций в секунду против ёмкости в 40 000, кластер стоит колом. И порядок карточек остаётся хронологическим: ранжировать нечем.',
                en: 'Half the blocks, no duplication and no spreading lag: both the feed and the images are assembled at request time, and with fewer hops on the way the median is even better. The bill comes three times over. A gigabyte of images per second goes through the API gateway and is billed at origin rates: the gateway alone comes to $381,000 a month. Every open turns into a dozen post lookups — 165,000 operations per second against a capacity of 40,000, and the cluster stalls. And the order of the cards stays chronological: there is nothing to rank with.',
            },
            build: originServed,
        },
    ],
};
