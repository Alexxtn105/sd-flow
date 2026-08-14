import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const BUYERS = 'buyers';

const buyerParams = {
    dau: 6000000,
    sessionsPerUserDay: 2,
    requestsPerSession: 30,
    avgRequestKb: 2,
    avgResponseKb: 8,
    readWriteMix: 0.75,
    cacheableShare: 0.4,
    peakFactor: 5,
    diurnalPattern: 'evening',
    geoDistribution: 'europe',
    networkRttMs: 60,
};

const clientCalls = { requestBytes: 2000, responseBytes: 8000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'flash-sale',
        name: 'Продажа билетов',
        nodes: [{ id: BUYERS, type: 'client-mobile', params: buyerParams, position: { x: 0, y: 200 } }],
        links: [],
    });
}

function reserveInCache(): SchemeV1 {
    return buildScheme({
        id: 'flash-sale-cache',
        name: 'Резервирование в кэше и запись за очередью',
        nodes: [
            { id: BUYERS, type: 'client-mobile', params: buyerParams, position: { x: 0, y: 200 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: { instances: 6, rateLimitRpsPerClient: 5, quotaPerDay: 2000 },
                position: { x: 280, y: 200 },
            },
            {
                id: 'sale-api',
                type: 'service',
                params: { serviceTimeMs: 12, cpuShare: 0.12, instances: 8, autoscaleMax: 120 },
                position: { x: 560, y: 200 },
            },
            {
                id: 'seats',
                type: 'redis',
                params: {
                    shards: 6,
                    memoryGb: 12,
                    replicasPerShard: 2,
                    uniqueKeys: 500000,
                    zipfAlpha: 1.2,
                    hotKeyShare: 0.25,
                    ttlSec: 900,
                    evictionPolicy: 'noeviction',
                    persistence: 'aof',
                    concurrencyControl: 'optimistic',
                    conflictResolution: 'single-writer-per-key',
                },
                position: { x: 840, y: 60 },
            },
            {
                id: 'orders',
                type: 'kafka',
                params: { partitions: 24, messageSizeKb: 1, retentionHours: 72, orderingScope: 'per-key' },
                position: { x: 840, y: 340 },
            },
            {
                id: 'ledger',
                type: 'worker',
                params: {
                    instances: 20,
                    concurrency: 32,
                    cpuCores: 4,
                    cpuShare: 0.3,
                    processingTimeMs: 20,
                    idempotent: true,
                    dlqEnabled: true,
                },
                position: { x: 1120, y: 340 },
            },
            {
                id: 'orders-db',
                type: 'postgres',
                params: {
                    readReplicas: 2,
                    readFromReplica: 0.15,
                    replicaLagMs: 120,
                    replicationMode: 'sync',
                    cpuCores: 24,
                    provisionedIops: 40000,
                    rowCount: 50000000,
                    storageGb: 2000,
                    concurrencyControl: 'pessimistic',
                    isolationLevel: 'serializable',
                },
                position: { x: 1120, y: 140 },
            },
        ],
        links: [
            { from: BUYERS, to: 'gateway', readShare: 0.75, calls: clientCalls },
            { from: 'gateway', to: 'sale-api', readShare: 0.75, calls: clientCalls },
            { from: 'sale-api', to: 'seats', readShare: 0.75 },
            { from: 'sale-api', to: 'orders-db', readShare: 1, calls: { fanout: 0.6 } },
            { from: 'sale-api', to: 'orders', calls: { fanout: 0.25 } },
            { from: 'orders', to: 'ledger' },
            { from: 'ledger', to: 'orders-db', readShare: 0 },
        ],
    });
}

function lockInDatabase(): SchemeV1 {
    return buildScheme({
        id: 'flash-sale-lock',
        name: 'Всё в базе под пессимистичной блокировкой',
        nodes: [
            { id: BUYERS, type: 'client-mobile', params: buyerParams, position: { x: 0, y: 200 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: { instances: 6, rateLimitRpsPerClient: 5, quotaPerDay: 2000 },
                position: { x: 280, y: 200 },
            },
            {
                id: 'sale-api',
                type: 'service',
                params: { serviceTimeMs: 12, cpuShare: 0.12, instances: 8, autoscaleMax: 120 },
                position: { x: 560, y: 200 },
            },
            {
                id: 'orders-db',
                type: 'postgres',
                params: {
                    readReplicas: 2,
                    readFromReplica: 0.15,
                    replicaLagMs: 120,
                    provisionedIops: 20000,
                    rowCount: 50000000,
                    storageGb: 2000,
                    cpuCores: 16,
                    maxConnections: 800,
                    writeServiceMs: 25,
                    concurrencyControl: 'pessimistic',
                    isolationLevel: 'serializable',
                },
                position: { x: 840, y: 200 },
            },
        ],
        links: [
            { from: BUYERS, to: 'gateway', readShare: 0.75, calls: clientCalls },
            { from: 'gateway', to: 'sale-api', readShare: 0.75, calls: clientCalls },
            { from: 'sale-api', to: 'orders-db', readShare: 0.75 },
        ],
    });
}

export const flashSale: Challenge = {
    id: 'flash-sale',
    level: 3,
    estimatedMinutes: 45,
    tags: ['hot-key', 'consistency', 'queue', 'locking'],
    title: { ru: 'Продажа билетов', en: 'Ticket flash sale' },
    brief: {
        ru: 'Полмиллиона билетов на концерт, шесть миллионов желающих и одна кнопка «купить». В обычную секунду это 4 200 запросов, в момент открытия продаж — 21 000, и все они дерутся за один и тот же счётчик мест. Продать больше, чем есть, нельзя ни разу; заставить человека ждать в очереди — можно.',
        en: 'Half a million concert tickets, six million people who want them and one Buy button. On an ordinary second that is 4,200 requests, at the moment the sale opens it is 21,000, and every one of them fights over the same seat counter. Selling more tickets than exist is never acceptable; making a person wait in a queue is.',
    },
    given: {
        dau: buyerParams.dau,
        requestsPerUserDay: buyerParams.sessionsPerUserDay * buyerParams.requestsPerSession,
        avgRps: 4167,
        peakRps: 20833,
        peakFactor: buyerParams.peakFactor,
        writeShare: 0.25,
        ticketsOnSale: 500000,
        clientRttMs: buyerParams.networkRttMs,
    },
    flows: [{ id: BUYERS, name: { ru: 'Покупка билета', en: 'Buy a ticket' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 12,
        allowedGroups: [
            'clients',
            'edge',
            'compute',
            'cache',
            'sql',
            'nosql',
            'messaging',
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
                ru: 'Купленный билет доезжает до долговечного журнала, а не остаётся только в кэше',
                en: 'A sold ticket reaches a durable ledger instead of living only in the cache',
            },
            flow: BUYERS,
            to: { group: 'sql' },
            notVia: [{ group: 'cache' }],
        },
        {
            id: 'R2',
            kind: 'anomaly',
            desc: {
                ru: 'Овербукинга нет: ни одно хранилище не теряет одновременные списания мест',
                en: 'No overbooking: no store loses concurrent seat decrements',
            },
            code: 'lost-update',
            maxRatePerSec: 0,
        },
        {
            id: 'R3',
            kind: 'anomaly',
            desc: {
                ru: 'Покупатель сразу видит свой билет: не больше 0.3% чтений после записи промахиваются',
                en: 'The buyer sees the ticket at once: no more than 0.3% of read-after-write requests miss',
            },
            code: 'read-your-writes',
            maxSharePercent: 0.3,
        },
        {
            id: 'R4',
            kind: 'slo',
            desc: { ru: 'p99 покупки не выше 250 мс', en: 'Purchase p99 stays under 250 ms' },
            flow: BUYERS,
            metric: 'latency.p99',
            max: 250,
        },
        {
            id: 'R5',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 80%', en: 'No block runs hotter than 80%' },
            maxUtilization: 0.8,
        },
        {
            id: 'R6',
            kind: 'durability',
            desc: { ru: 'Проданный билет хранится минимум в трёх копиях', en: 'A sold ticket is kept in at least three copies' },
            flow: BUYERS,
            minReplication: 3,
        },
        {
            id: 'R7',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $75 000 в месяц', en: 'Monthly cost stays under $75,000' },
            maxMonthlyCostUsd: 75000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианная покупка укладывается в 90 мс', en: 'Median purchase stays under 90 ms' },
            flow: BUYERS,
            metric: 'latency.p50',
            max: 90,
        },
        {
            id: 'B2',
            kind: 'freshness',
            desc: {
                ru: 'Очередь заказов разбирается быстрее чем за 2 секунды',
                en: 'The order queue drains in under 2 seconds',
            },
            maxLagSec: 2,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.15, latencyFactor: 1.6 },
        'cache-flush': { latencyFactor: 2, utilizationFactor: 1.15 },
        'az-failure': { latencyFactor: 2, utilizationFactor: 1.3 },
    },
    lockedParams: { [BUYERS]: buyerParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько запросов в секунду приходится на один и тот же ключ — счётчик оставшихся мест — и что происходит, когда два таких запроса читают его одновременно?',
                en: 'How many requests per second land on the same key — the remaining-seats counter — and what happens when two of them read it at the same time?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Прочитать остаток, вычесть и записать обратно — это read-modify-write. Без явного контроля конкурентности движок насчитает вам потерянные обновления, а покупателям — лишние билеты. Пессимистичная блокировка проблему решает, но сериализует продажи в одну строку.',
                en: 'Read the remainder, subtract, write it back — that is a read-modify-write. Without explicit concurrency control the engine will count lost updates for you and extra tickets for the buyers. A pessimistic lock fixes it but serialises the whole sale into one row.',
            },
            forRequirement: 'R2',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Держите счётчик мест в кэше с CAS-семантикой (concurrencyControl = optimistic), отвечайте покупателю сразу после успешного резерва, а долговечную запись заказа отправляйте в очередь — консьюмер разложит её в базу своим темпом. И не читайте «мои билеты» с асинхронной реплики: она отдаст пустой список ровно тому, кто только что заплатил.',
                en: 'Keep the seat counter in a cache with CAS semantics (concurrencyControl = optimistic), answer the buyer right after a successful reservation, and push the durable order into a queue — the consumer will land it in the database at its own pace. And do not read "my tickets" from an async replica: it will return an empty list to the person who just paid.',
            },
            forRequirement: 'R5',
        },
    ],
    referenceSolutions: [
        {
            id: 'reserve-in-cache',
            name: { ru: 'Резерв в кэше, запись за очередью', en: 'Reserve in cache, persist behind a queue' },
            tradeoff: {
                ru: 'Быстро и держит пик: место резервируется одной CAS-операцией, а заказ доезжает до базы асинхронно. Цена — две системы вместо одной и окно, в котором билет уже продан, но в журнале его ещё нет.',
                en: 'Fast and holds the peak: a seat is reserved by a single CAS operation and the order lands in the database asynchronously. The price is two systems instead of one and a window where the ticket is sold but not yet in the ledger.',
            },
            build: reserveInCache,
        },
        {
            id: 'lock-in-database',
            name: { ru: 'Всё в базе под блокировкой', en: 'Everything in the database under a lock' },
            tradeoff: {
                ru: 'Проще некуда и овербукинг невозможен по построению: одна транзакция, одна строка, serializable. Но горячая строка сериализует продажи, и на 4 200 запросах в секунду база стоит колом — очередь ожидания получается не в UI, а в пуле соединений.',
                en: 'As simple as it gets and overbooking is impossible by construction: one transaction, one row, serializable. But the hot row serialises the sale, and at 4,200 requests per second the database is wedged — the waiting room ends up in the connection pool rather than in the UI.',
            },
            build: lockInDatabase,
        },
    ],
};
