import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const READERS = 'readers';

const readerParams = {
    dau: 30000000,
    sessionsPerUserDay: 5,
    requestsPerSession: 8,
    avgRequestKb: 1,
    avgResponseKb: 8,
    readWriteMix: 0.96,
    cacheableShare: 0.7,
    peakFactor: 3,
    geoDistribution: 'global',
};

const clientCalls = { requestBytes: 1000, responseBytes: 8000 };
const timelineCalls = { requestBytes: 200, responseBytes: 8000 };
const tweetWriteCalls = { requestBytes: 2000, responseBytes: 200 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'twitter-feed',
        name: 'Лента коротких сообщений',
        nodes: [{ id: READERS, type: 'client-web', params: readerParams, position: { x: 0, y: 220 } }],
        links: [],
    });
}

function fanoutOnWrite(): SchemeV1 {
    return buildScheme({
        id: 'twitter-feed-fanout-on-write',
        name: 'Ленты собираются при записи',
        nodes: [
            { id: READERS, type: 'client-web', params: readerParams, position: { x: 0, y: 220 } },
            {
                id: 'edge',
                type: 'lb-l7',
                params: { instances: 3, maxRpsPerInstance: 20000 },
                position: { x: 240, y: 220 },
            },
            {
                id: 'feed-api',
                type: 'service',
                params: { instances: 12, autoscaleMax: 60, serviceTimeMs: 15 },
                position: { x: 500, y: 120 },
            },
            {
                id: 'timelines',
                type: 'redis',
                params: {
                    shards: 4,
                    replicasPerShard: 1,
                    memoryGb: 28,
                    uniqueKeys: 30000000,
                    valueSizeBytes: 1200,
                    ttlSec: 3600,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 780, y: 120 },
            },
            {
                id: 'post-api',
                type: 'service',
                params: { instances: 2, autoscaleMax: 20, serviceTimeMs: 25 },
                position: { x: 500, y: 360 },
            },
            {
                id: 'tweets',
                type: 'cassandra',
                params: { nodes: 3, replicationFactor: 3, rowCount: 3000000000, storageGbPerNode: 3000 },
                position: { x: 780, y: 480 },
            },
            {
                id: 'events',
                type: 'kafka',
                params: { partitions: 24, messageSizeKb: 2, retentionHours: 72 },
                position: { x: 780, y: 300 },
            },
            {
                id: 'spreader',
                type: 'worker',
                params: {
                    instances: 8,
                    concurrency: 32,
                    cpuCores: 4,
                    cpuShare: 0.4,
                    processingTimeMs: 40,
                },
                position: { x: 1040, y: 300 },
            },
        ],
        links: [
            { from: READERS, to: 'edge', readShare: 0.96, calls: clientCalls },
            { from: 'edge', to: 'feed-api', weight: 0.96, readShare: 1, calls: clientCalls },
            { from: 'edge', to: 'post-api', weight: 0.04, readShare: 0, calls: clientCalls },
            { from: 'feed-api', to: 'timelines', readShare: 1, calls: timelineCalls },
            { from: 'post-api', to: 'tweets', readShare: 0, calls: tweetWriteCalls },
            { from: 'post-api', to: 'events', calls: { fanout: 1, requestBytes: 2000 } },
            { from: 'events', to: 'spreader' },
            { from: 'spreader', to: 'timelines', readShare: 0, calls: { fanout: 8, requestBytes: 300, responseBytes: 100 } },
        ],
    });
}

function fanoutOnRead(): SchemeV1 {
    return buildScheme({
        id: 'twitter-feed-fanout-on-read',
        name: 'Лента собирается при чтении',
        nodes: [
            { id: READERS, type: 'client-web', params: readerParams, position: { x: 0, y: 220 } },
            {
                id: 'edge',
                type: 'lb-l7',
                params: { instances: 3, maxRpsPerInstance: 20000 },
                position: { x: 240, y: 220 },
            },
            {
                id: 'feed-api',
                type: 'service',
                params: { instances: 12, autoscaleMax: 60, serviceTimeMs: 15, callMode: 'parallel' },
                position: { x: 500, y: 120 },
            },
            {
                id: 'post-api',
                type: 'service',
                params: { instances: 2, autoscaleMax: 20, serviceTimeMs: 25 },
                position: { x: 500, y: 360 },
            },
            {
                id: 'tweets',
                type: 'cassandra',
                params: { nodes: 24, replicationFactor: 3, rowCount: 3000000000, storageGbPerNode: 3000 },
                position: { x: 800, y: 240 },
            },
        ],
        links: [
            { from: READERS, to: 'edge', readShare: 0.96, calls: clientCalls },
            { from: 'edge', to: 'feed-api', weight: 0.96, readShare: 1, calls: clientCalls },
            { from: 'edge', to: 'post-api', weight: 0.04, readShare: 0, calls: clientCalls },
            { from: 'feed-api', to: 'tweets', readShare: 1, calls: { fanout: 30, requestBytes: 200, responseBytes: 400 } },
            { from: 'post-api', to: 'tweets', readShare: 0, calls: tweetWriteCalls },
        ],
    });
}

export const twitterFeed: Challenge = {
    id: 'twitter-feed',
    level: 2,
    estimatedMinutes: 30,
    tags: ['feed', 'fanout', 'cache', 'queue'],
    title: { ru: 'Лента коротких сообщений', en: 'Short-message feed' },
    brief: {
        ru: 'Тридцать миллионов человек в сутки листают ленту: около 14 000 запросов в секунду, из них 96% — чтение. Средний человек читает пару десятков авторов, а у звезды сотни тысяч подписчиков. Один и тот же результат можно собрать заранее при публикации или каждый раз при открытии ленты, и это два совершенно разных счёта за железо.',
        en: 'Thirty million people a day scroll a feed: about 14,000 requests per second, 96% of them reads. An average person follows a couple of dozen accounts, while a celebrity has hundreds of thousands of followers. The same result can be assembled up front on publish or from scratch on every open, and those are two very different hardware bills.',
    },
    given: {
        dau: readerParams.dau,
        requestsPerUserDay: readerParams.sessionsPerUserDay * readerParams.requestsPerSession,
        avgRps: 13889,
        readShare: readerParams.readWriteMix,
        avgFollowees: 30,
        avgFollowers: 200,
        peakFactor: readerParams.peakFactor,
    },
    flows: [{ id: READERS, name: { ru: 'Открыть ленту', en: 'Open the feed' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 12,
        allowedGroups: ['clients', 'edge', 'compute', 'cache', 'nosql', 'sql', 'messaging', 'topology'],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'security',
            desc: {
                ru: 'Периметр закрыт: браузер не ходит в хранилище напрямую, TLS рвётся на входе',
                en: 'The perimeter holds: the browser never talks to storage directly, TLS terminates at the edge',
            },
            requires: ['no-direct-client-to-db', 'tls-terminate'],
        },
        {
            id: 'R2',
            kind: 'slo',
            desc: { ru: 'p99 открытия ленты не выше 300 мс', en: 'Feed open p99 stays under 300 ms' },
            flow: READERS,
            metric: 'latency.p99',
            max: 300,
        },
        {
            id: 'R3',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 75%', en: 'No block runs hotter than 75%' },
            maxUtilization: 0.75,
        },
        {
            id: 'R4',
            kind: 'durability',
            desc: {
                ru: 'Сообщение не пропадает от одной сломанной железки — копий минимум три',
                en: 'A message does not vanish with one broken box — at least three copies exist',
            },
            flow: READERS,
            minReplication: 3,
        },
        {
            id: 'R5',
            kind: 'anomaly',
            desc: {
                ru: 'До 5% устаревших чтений ленты допустимо — это не банк',
                en: 'Up to 5% stale feed reads is acceptable — this is not a bank',
            },
            code: 'stale-read',
            maxSharePercent: 5,
        },
        {
            id: 'R6',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $40 000 в месяц', en: 'Monthly cost stays under $40,000' },
            maxMonthlyCostUsd: 40000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианное открытие ленты укладывается в 120 мс', en: 'Median feed open stays under 120 ms' },
            flow: READERS,
            metric: 'latency.p50',
            max: 120,
        },
        {
            id: 'B2',
            kind: 'budget',
            desc: { ru: 'Уложиться в $36 000 в месяц', en: 'Stay under $36,000 a month' },
            maxMonthlyCostUsd: 36000,
        },
    ],
    scenarios: { required: ['peak', 'az-failure'], bonus: ['cache-flush'] },
    relaxation: {
        peak: { utilizationFactor: 1.2 },
        'az-failure': { latencyFactor: 2.5, utilizationFactor: 1.3 },
        'cache-flush': { latencyFactor: 3, utilizationFactor: 1.6 },
    },
    lockedParams: { [READERS]: readerParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сравните две частоты: сколько раз в секунду появляется новое сообщение и сколько раз в секунду кто-то открывает ленту.',
                en: 'Compare two rates: how often a new message appears, and how often somebody opens a feed.',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Если ленту собирать в момент чтения, каждый запрос превращается в десятки обращений к хранилищу — умножьте 13 000 запросов в секунду на число подписок и посмотрите, во что упрётся база.',
                en: 'If the feed is assembled at read time, every request turns into dozens of store lookups — multiply 13,000 requests per second by the number of followees and see what the database runs into.',
            },
            forRequirement: 'R3',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Разложите работу по редкому событию: публикация происходит в двадцать раз реже чтения, поэтому раскладывать сообщение по готовым лентам дешевле в фоне — чтение тогда стоит одно обращение в память.',
                en: 'Move the work onto the rare event: publishing happens twenty times less often than reading, so spreading a message into prepared timelines in the background is cheaper — a read then costs one memory lookup.',
            },
            forRequirement: 'R3',
        },
    ],
    referenceSolutions: [
        {
            id: 'fanout-on-write',
            name: { ru: 'Ленты собираются при записи', en: 'Fan-out on write' },
            tradeoff: {
                ru: 'Публикация уходит в очередь, фоновые обработчики раскладывают её пачками по готовым лентам в памяти. Чтение стоит одно обращение, зато на каждое сообщение приходится работа, пропорциональная числу подписчиков, и лента живёт в двух местах сразу.',
                en: 'A publish goes to a queue and background consumers spread it in batches into ready-made timelines in memory. A read costs one lookup, but every message costs work proportional to the follower count, and the feed now lives in two places at once.',
            },
            build: fanoutOnWrite,
        },
        {
            id: 'fanout-on-read',
            name: { ru: 'Лента собирается при чтении', en: 'Fan-out on read' },
            tradeoff: {
                ru: 'Блоков вдвое меньше, запись тривиальна, дублирования данных нет. Но каждое открытие ленты превращается в десятки обращений к хранилищу, и вся экономия на записи уходит на железо под чтение.',
                en: 'Half the blocks, a trivial write path and no duplicated data. But every feed open turns into dozens of store lookups, and everything saved on writes is spent on hardware for reads.',
            },
            build: fanoutOnRead,
        },
    ],
};
