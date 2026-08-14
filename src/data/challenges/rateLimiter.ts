import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const CALLERS = 'callers';

const callerParams = {
    dau: 4000000,
    sessionsPerUserDay: 3,
    requestsPerSession: 18,
    avgRequestKb: 1,
    avgResponseKb: 4,
    readWriteMix: 0.85,
    cacheableShare: 0.3,
    peakFactor: 3,
    geoDistribution: 'global',
};

const clientCalls = { requestBytes: 1000, responseBytes: 4000 };
const bucketCalls = { requestBytes: 120, responseBytes: 80 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'rate-limiter',
        name: 'Ограничитель частоты запросов',
        nodes: [{ id: CALLERS, type: 'client-web', params: callerParams, position: { x: 0, y: 160 } }],
        links: [],
    });
}

function shardedBuckets(): SchemeV1 {
    return buildScheme({
        id: 'rate-limiter-sharded',
        name: 'Ведро на клиента в кластере кэша',
        nodes: [
            { id: CALLERS, type: 'client-web', params: callerParams, position: { x: 0, y: 160 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: { instances: 3, maxRpsPerInstance: 3400 },
                position: { x: 260, y: 160 },
            },
            { id: 'api', type: 'service', params: { serviceTimeMs: 18 }, position: { x: 520, y: 160 } },
            {
                id: 'buckets',
                type: 'redis',
                params: {
                    shards: 3,
                    replicasPerShard: 1,
                    memoryGb: 8,
                    uniqueKeys: 4000000,
                    valueSizeBytes: 64,
                    ttlSec: 60,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 800, y: 160 },
            },
        ],
        links: [
            { from: CALLERS, to: 'gateway', readShare: 0.85, calls: clientCalls },
            { from: 'gateway', to: 'api', readShare: 0.85, calls: clientCalls },
            { from: 'api', to: 'buckets', readShare: 0.2, calls: bucketCalls },
        ],
    });
}

function singleCounter(): SchemeV1 {
    return buildScheme({
        id: 'rate-limiter-single-counter',
        name: 'Один общий счётчик на одном узле',
        nodes: [
            { id: CALLERS, type: 'client-web', params: callerParams, position: { x: 0, y: 160 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: { instances: 3, maxRpsPerInstance: 3400 },
                position: { x: 260, y: 160 },
            },
            { id: 'api', type: 'service', params: { serviceTimeMs: 18 }, position: { x: 520, y: 160 } },
            {
                id: 'buckets',
                type: 'redis',
                params: {
                    mode: 'standalone',
                    shards: 1,
                    replicasPerShard: 0,
                    memoryGb: 8,
                    uniqueKeys: 1,
                    valueSizeBytes: 64,
                    ttlSec: 60,
                    hotKeyShare: 0.9,
                },
                position: { x: 800, y: 160 },
            },
        ],
        links: [
            { from: CALLERS, to: 'gateway', readShare: 0.85, calls: clientCalls },
            { from: 'gateway', to: 'api', readShare: 0.85, calls: clientCalls },
            { from: 'api', to: 'buckets', readShare: 0.2, calls: bucketCalls },
        ],
    });
}

export const rateLimiter: Challenge = {
    id: 'rate-limiter',
    level: 1,
    estimatedMinutes: 20,
    tags: ['rate-limit', 'cache', 'hot-key', 'consistency'],
    title: { ru: 'Ограничитель частоты запросов', en: 'API rate limiter' },
    brief: {
        ru: 'Публичный API принимает 2 500 запросов в секунду, и каждый нужно сверить с лимитом клиента до того, как он дойдёт до логики. Инстансов много, а лимит один на клиента — значит, счётчик в памяти инстанса не годится: его придётся держать снаружи и платить за поход к нему на каждом запросе.',
        en: 'A public API takes 2,500 requests per second and every one of them must be checked against the caller quota before it reaches any logic. There are many instances but one quota per caller, so a counter in instance memory will not do: it lives outside, and every request pays for the trip to it.',
    },
    given: {
        dau: callerParams.dau,
        requestsPerUserDay: callerParams.sessionsPerUserDay * callerParams.requestsPerSession,
        avgRps: 2500,
        limitCheckPerRequest: 1,
        peakFactor: callerParams.peakFactor,
    },
    flows: [{ id: CALLERS, name: { ru: 'Запрос к API', en: 'API call' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 8,
        allowedGroups: ['clients', 'edge', 'compute', 'cache', 'sql', 'nosql', 'topology'],
        forbiddenTypes: ['local-cache'],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: {
                ru: 'Счётчик лимита живёт вне инстанса приложения — иначе у каждого инстанса свой лимит',
                en: 'The quota counter lives outside the application instance — otherwise every instance has its own limit',
            },
            flow: CALLERS,
            to: { group: 'cache' },
        },
        {
            id: 'R2',
            kind: 'security',
            desc: {
                ru: 'Периметр закрыт: клиент не ходит в хранилище сам, TLS рвётся на входе',
                en: 'The perimeter holds: the client never reaches storage itself, TLS terminates at the edge',
            },
            requires: ['no-direct-client-to-db', 'tls-terminate'],
        },
        {
            id: 'R3',
            kind: 'slo',
            desc: {
                ru: 'p99 запроса не выше 160 мс — проверка лимита не должна съедать бюджет ответа',
                en: 'Request p99 stays under 160 ms — the quota check must not eat the response budget',
            },
            flow: CALLERS,
            metric: 'latency.p99',
            max: 160,
        },
        {
            id: 'R4',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 70%', en: 'No block runs hotter than 70%' },
            maxUtilization: 0.7,
        },
        {
            id: 'R5',
            kind: 'anomaly',
            desc: {
                ru: 'Одновременные проверки не затирают друг друга: потерянных инкрементов нет',
                en: 'Concurrent checks do not overwrite each other: no lost increments',
            },
            code: 'lost-update',
            maxRatePerSec: 0,
        },
        {
            id: 'R6',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $32 000 в месяц', en: 'Monthly cost stays under $32,000' },
            maxMonthlyCostUsd: 32000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианный запрос укладывается в 80 мс', en: 'Median request stays under 80 ms' },
            flow: CALLERS,
            metric: 'latency.p50',
            max: 80,
        },
        {
            id: 'B2',
            kind: 'capacity',
            desc: { ru: 'Даже самый горячий блок не переваливает за 60%', en: 'Even the hottest block stays under 60%' },
            maxUtilization: 0.6,
        },
    ],
    scenarios: { required: ['peak', 'az-failure'], bonus: ['cache-flush'] },
    relaxation: {
        peak: { utilizationFactor: 1.25 },
        'az-failure': { latencyFactor: 2.5, utilizationFactor: 1.3 },
        'cache-flush': { latencyFactor: 2, utilizationFactor: 1.3 },
    },
    lockedParams: { [CALLERS]: callerParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько ключей у вас на самом деле: один общий счётчик или по одному на каждого клиента?',
                en: 'How many keys do you actually have: one shared counter, or one per caller?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Инкремент — это чтение и запись одного значения. Если два инстанса делают это одновременно без атомарной операции, один из инкрементов пропадает, и лимит начинает пропускать лишнее.',
                en: 'An increment is a read plus a write of one value. If two instances do it at the same time without an atomic operation, one increment vanishes and the limit starts letting extra traffic through.',
            },
            forRequirement: 'R5',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Ключ вида «клиент + окно» размазывает нагрузку по шардам и убирает горячий ключ, а сам инкремент делайте атомарным — тогда лимит остаётся честным и при трёхкратном пике.',
                en: 'A key shaped as "caller + window" spreads the load across shards and removes the hot key, and the increment itself must be atomic — then the limit stays honest even at a 3x peak.',
            },
            forRequirement: 'R5',
        },
    ],
    referenceSolutions: [
        {
            id: 'sharded-buckets',
            name: { ru: 'Ведро на клиента в кластере кэша', en: 'Per-caller bucket in a cache cluster' },
            tradeoff: {
                ru: 'Ключ на клиента разъезжается по шардам, атомарный инкремент не теряет счёт, каждая реплика страхует свой шард. Платим за три шарда с репликами и за один поход в сеть на каждый запрос.',
                en: 'A per-caller key spreads across shards, the atomic increment never loses a count, and every shard has a standby replica. You pay for three shards with replicas and one network trip per request.',
            },
            build: shardedBuckets,
        },
        {
            id: 'single-counter',
            name: { ru: 'Один общий счётчик', en: 'One shared counter' },
            tradeoff: {
                ru: 'Вшестеро дешевле по железу и не надо думать о ключах, но весь трафик бьёт в один ключ на единственном узле: горячий ключ, никакого резерва и потерянные инкременты, из-за которых лимит пропускает лишнее.',
                en: 'Six times cheaper on hardware and no key design to think about, but all traffic hits one key on a single node: a hot key, no standby at all, and lost increments that let extra traffic slip past the limit.',
            },
            build: singleCounter,
        },
    ],
};
