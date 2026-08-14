import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const PAYERS = 'payers';
const MERCHANTS = 'merchants';

const payerParams = {
    dau: 5000000,
    sessionsPerUserDay: 2,
    requestsPerSession: 12,
    avgRequestKb: 2,
    avgResponseKb: 6,
    readWriteMix: 0.6,
    cacheableShare: 0.3,
    peakFactor: 2.2,
    diurnalPattern: 'evening',
    geoDistribution: 'europe',
    networkRttMs: 55,
};

const merchantParams = {
    clients: 300,
    rpsPerClient: 2,
    quotaPerDay: 20000000,
    burstiness: 2,
    authMode: 'jwt-local',
    peakFactor: 2,
    readWriteMix: 0.85,
    avgRequestKb: 2,
    avgResponseKb: 10,
    geoDistribution: 'europe',
};

const payerCalls = { requestBytes: 2000, responseBytes: 6000 };
const merchantCalls = { requestBytes: 2000, responseBytes: 10000 };

const ledgerParams = {
    readReplicas: 3,
    readFromReplica: 0.5,
    replicationMode: 'sync',
    replicaLagMs: 20,
    maxConnections: 4000,
    cpuCores: 32,
    provisionedIops: 120000,
    rowCount: 20000000000,
    rowSizeBytes: 600,
    storageGb: 40000,
    concurrencyControl: 'pessimistic',
    isolationLevel: 'serializable',
    transactionScope: 'single-shard',
};

function starter(): SchemeV1 {
    return buildScheme({
        id: 'payments',
        name: 'Платёжная система',
        nodes: [
            { id: PAYERS, type: 'client-mobile', params: payerParams, position: { x: 0, y: 160 } },
            { id: MERCHANTS, type: 'client-api', params: merchantParams, position: { x: 0, y: 520 } },
        ],
        links: [],
    });
}

function sagaAndOutbox(): SchemeV1 {
    return buildScheme({
        id: 'payments-saga',
        name: 'Сага, outbox и внешний шлюз за очередью',
        nodes: [
            { id: PAYERS, type: 'client-mobile', params: payerParams, position: { x: 0, y: 160 } },
            { id: MERCHANTS, type: 'client-api', params: merchantParams, position: { x: 0, y: 520 } },
            {
                id: 'edge-waf',
                type: 'waf',
                params: { instances: 3, azSpread: 3, rulesCount: 180, inspectionMs: 0.9, rateLimitRps: 40000 },
                position: { x: 260, y: 320 },
            },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 3,
                    azSpread: 3,
                    maxRpsPerInstance: 4000,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 60,
                    payloadLimitMb: 2,
                },
                position: { x: 520, y: 320 },
            },
            {
                id: 'checkout',
                type: 'service',
                params: {
                    serviceTimeMs: 14,
                    serviceTimeSigma: 0.5,
                    cpuShare: 0.1,
                    instances: 6,
                    autoscale: false,
                    autoscaleMax: 40,
                    azSpread: 3,
                    queueLimit: 2000,
                },
                position: { x: 800, y: 320 },
            },
            {
                id: 'ids',
                type: 'id-gen',
                params: { strategy: 'uuidv7', idsPerSec: 200000, instances: 3, monotonic: true },
                position: { x: 1080, y: 40 },
            },
            {
                id: 'idem-cache',
                type: 'redis',
                params: {
                    shards: 3,
                    replicasPerShard: 2,
                    memoryGb: 24,
                    uniqueKeys: 60000000,
                    ttlSec: 3600,
                    evictionPolicy: 'noeviction',
                    persistence: 'aof',
                    concurrencyControl: 'optimistic',
                },
                position: { x: 1080, y: 180 },
            },
            { id: 'ledger', type: 'aurora', params: ledgerParams, position: { x: 1080, y: 340 } },
            {
                id: 'outbox-relay',
                type: 'outbox',
                params: { instances: 3, pollIntervalMs: 50, batchSize: 400, backlogRows: 40000, publishLagMs: 300 },
                position: { x: 1080, y: 520 },
            },
            {
                id: 'events',
                type: 'kafka',
                params: { partitions: 48, replicationFactor: 3, minInsync: 2, messageSizeKb: 2, retentionHours: 336 },
                position: { x: 1360, y: 520 },
            },
            {
                id: 'charges',
                type: 'sqs',
                params: { queueType: 'fifo', maxReceiveCount: 6, batchSize: 10, messageSizeKb: 4, maxInflight: 200000 },
                position: { x: 1360, y: 700 },
            },
            {
                id: 'charger',
                type: 'worker',
                params: {
                    instances: 4,
                    concurrency: 40,
                    cpuCores: 4,
                    cpuShare: 0.25,
                    processingTimeMs: 180,
                    retries: 4,
                    idempotent: true,
                    dlqEnabled: true,
                },
                position: { x: 1640, y: 700 },
            },
            {
                id: 'saga',
                type: 'saga-orchestrator',
                params: {
                    workflowsPerSec: 400,
                    stepsPerWorkflow: 6,
                    stateStore: 'database',
                    maxOpsPerSec: 6000,
                    concurrency: 60,
                    instances: 3,
                    serviceTimeMs: 4,
                    retentionDays: 90,
                },
                position: { x: 1920, y: 700 },
            },
            {
                id: 'psp',
                type: 'payment-external',
                params: {
                    p50Ms: 140,
                    p99Ms: 900,
                    rateLimitRps: 400,
                    maxConcurrency: 60,
                    timeoutMs: 8000,
                    idempotencyRequired: true,
                    webhookCallback: true,
                    costPerTransaction: 0.012,
                },
                position: { x: 2200, y: 700 },
            },
            {
                id: 'settlement',
                type: 'worker',
                params: {
                    instances: 3,
                    concurrency: 32,
                    cpuCores: 4,
                    cpuShare: 0.25,
                    processingTimeMs: 40,
                    retries: 3,
                    idempotent: true,
                    dlqEnabled: true,
                },
                position: { x: 1640, y: 520 },
            },
            {
                id: 'archive',
                type: 's3',
                params: {
                    objectCount: 400000000000,
                    avgObjectSizeMb: 0.0014,
                    prefixCount: 200,
                    versioning: true,
                    lifecycleDays: 2555,
                    storageClass: 'standard',
                },
                position: { x: 1920, y: 460 },
            },
        ],
        links: [
            { from: PAYERS, to: 'edge-waf', readShare: 0.6, calls: payerCalls },
            { from: MERCHANTS, to: 'edge-waf', readShare: 0.85, calls: merchantCalls },
            { from: 'edge-waf', to: 'gateway', readShare: 0.68, calls: payerCalls },
            { from: 'gateway', to: 'checkout', readShare: 0.68, calls: payerCalls },
            { from: 'checkout', to: 'ids', readShare: 0, calls: { fanout: 0.06 } },
            { from: 'checkout', to: 'idem-cache', readShare: 0.68 },
            {
                from: 'checkout',
                to: 'ledger',
                readShare: 0.68,
                policy: { timeoutMs: 800, retries: 2, circuitBreaker: true, idempotent: true },
            },
            { from: 'checkout', to: 'outbox-relay', calls: { fanout: 0.06 } },

            { from: 'checkout', to: 'charges', calls: { fanout: 0.06 } },
            { from: 'outbox-relay', to: 'events' },
            { from: 'events', to: 'settlement', policy: { timeoutMs: 4000, retries: 3, circuitBreaker: true, idempotent: true } },
            { from: 'settlement', to: 'ledger', readShare: 0, policy: { timeoutMs: 2000, retries: 2, circuitBreaker: true, idempotent: true } },
            {
                from: 'settlement',
                to: 'archive',
                readShare: 0,
                calls: { fanout: 1, requestBytes: 1400, responseBytes: 200 },
                policy: { timeoutMs: 3000, retries: 2, circuitBreaker: true, idempotent: true },
            },
            { from: 'charges', to: 'charger', policy: { timeoutMs: 9000, retries: 4, circuitBreaker: true, idempotent: true } },
            { from: 'charger', to: 'saga', readShare: 0, policy: { timeoutMs: 9000, retries: 2, circuitBreaker: true, idempotent: true } },
            { from: 'saga', to: 'psp', readShare: 0, policy: { timeoutMs: 9000, retries: 2, circuitBreaker: true, idempotent: true } },
        ],
    });
}

function synchronousGateway(): SchemeV1 {
    return buildScheme({
        id: 'payments-sync',
        name: 'Синхронный вызов шлюза из чекаута',
        nodes: [
            { id: PAYERS, type: 'client-mobile', params: payerParams, position: { x: 0, y: 160 } },
            { id: MERCHANTS, type: 'client-api', params: merchantParams, position: { x: 0, y: 520 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 3,
                    azSpread: 3,
                    maxRpsPerInstance: 4000,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 60,
                    payloadLimitMb: 2,
                },
                position: { x: 400, y: 320 },
            },
            {
                id: 'checkout',
                type: 'service',
                params: {
                    serviceTimeMs: 14,
                    serviceTimeSigma: 0.5,
                    cpuShare: 0.1,
                    instances: 10,
                    autoscaleMax: 90,
                    azSpread: 3,
                    queueLimit: 2000,
                    timeoutMs: 5000,
                },
                position: { x: 700, y: 320 },
            },
            {
                id: 'ledger',
                type: 'postgres',
                params: {
                    readReplicas: 2,
                    readFromReplica: 0.6,
                    replicaLagMs: 400,
                    maxConnections: 900,
                    cpuCores: 32,
                    provisionedIops: 60000,
                    rowCount: 20000000000,
                    rowSizeBytes: 600,
                    storageGb: 40000,
                    concurrencyControl: 'none',
                },
                position: { x: 1000, y: 200 },
            },
            {
                id: 'psp',
                type: 'payment-external',
                params: {
                    p50Ms: 240,
                    p99Ms: 4000,
                    rateLimitRps: 4000,
                    maxConcurrency: 1200,
                    timeoutMs: 8000,
                    webhookCallback: false,
                    costPerTransaction: 0.012,
                },
                position: { x: 1000, y: 460 },
            },
        ],
        links: [
            { from: PAYERS, to: 'gateway', readShare: 0.6, calls: payerCalls },
            { from: MERCHANTS, to: 'gateway', readShare: 0.85, calls: merchantCalls },
            { from: 'gateway', to: 'checkout', readShare: 0.68, calls: payerCalls },
            { from: 'checkout', to: 'ledger', readShare: 0.68 },
            { from: 'checkout', to: 'psp', readShare: 0, calls: { fanout: 0.06 } },
        ],
    });
}

export const payments: Challenge = {
    id: 'payments',
    level: 4,
    estimatedMinutes: 60,
    tags: ['payments', 'idempotency', 'saga', 'audit', 'external'],
    title: { ru: 'Платёжная система', en: 'Payment platform' },
    brief: {
        ru: 'Приём платежей для маркетплейса: 1 390 запросов в секунду от покупателей и ещё 600 — от мерчантов по API. Списаний из них 119 в секунду, и каждое надо провести ровно один раз: сеть теряет ответы, мобильный клиент повторяет запрос, внешний эквайер отвечает по 140 мс в медиане и по 900 мс в хвосте, а иногда не отвечает вовсе. Деньги не имеют права ни потеряться, ни списаться дважды, при этом покупатель ждёт ответа не дольше 300 мс. Всё, что произошло с деньгами, хранится семь лет. И заранее неприятный факт: комиссия эквайера $0.012 за операцию — это $3.8 млн в месяц, в тридцать раз больше всей вашей инфраструктуры.',
        en: 'Payment acceptance for a marketplace: 1,390 requests per second from buyers plus another 600 from merchants over the API. Of those, 119 per second actually move money, and each must be applied exactly once: the network drops responses, the mobile client retries, the external acquirer answers in 140 ms at the median and 900 ms in the tail, and sometimes it does not answer at all. Money may neither vanish nor be charged twice, and the buyer waits no longer than 300 ms. Everything that happened to money is kept for seven years. And an unpleasant fact up front: the acquirer fee of $0.012 per transaction is $3.8M a month — thirty times your entire infrastructure.',
    },
    given: {
        dau: payerParams.dau,
        requestsPerUserDay: payerParams.sessionsPerUserDay * payerParams.requestsPerSession,
        avgRps: 1389,
        merchantRps: 600,
        writeShare: 0.32,
        paymentsPerSec: 119,
        pspLimitRps: 400,
        pspP99Ms: 900,
        pspFeeUsd: 0.012,
        archiveRetentionYears: 7,
        peakFactor: payerParams.peakFactor,
        clientRttMs: payerParams.networkRttMs,
    },
    flows: [
        { id: PAYERS, name: { ru: 'Оплата заказа', en: 'Pay for an order' }, weightInScore: 0.7 },
        { id: MERCHANTS, name: { ru: 'API мерчанта', en: 'Merchant API' }, weightInScore: 0.3 },
    ],
    constraints: {
        maxNodes: 18,
        allowedGroups: [
            'clients',
            'edge',
            'compute',
            'sql',
            'nosql',
            'cache',
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
                ru: 'Платёж доезжает до внешнего эквайера, но не из синхронного ответа покупателю',
                en: 'The payment reaches the external acquirer, but not from the buyer’s synchronous response',
            },
            flow: PAYERS,
            to: { type: 'payment-external' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'worker' },
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Проводка попадает в реляционный журнал, а не только в кэш идемпотентности',
                en: 'The posting lands in a relational ledger, not just in the idempotency cache',
            },
            flow: PAYERS,
            to: { group: 'sql' },
            notVia: [{ group: 'cache' }],
        },
        {
            id: 'R3',
            kind: 'anomaly',
            desc: {
                ru: 'Повторная доставка команды не превращается в повторное списание',
                en: 'A redelivered command never turns into a second charge',
            },
            code: 'duplicate-processing',
            maxRatePerSec: 0,
        },
        {
            id: 'R4',
            kind: 'anomaly',
            desc: {
                ru: 'Одновременные проводки по одному счёту не затирают друг друга',
                en: 'Concurrent postings to the same account never overwrite each other',
            },
            code: 'lost-update',
            maxRatePerSec: 0,
        },
        {
            id: 'R5',
            kind: 'anomaly',
            desc: {
                ru: 'Плательщик видит собственный платёж: не больше 0.1% чтений после записи промахиваются',
                en: 'The payer sees their own payment: no more than 0.1% of read-after-write requests miss',
            },
            code: 'read-your-writes',
            maxSharePercent: 0.1,
        },
        {
            id: 'R6',
            kind: 'slo',
            desc: { ru: 'p99 ответа покупателю не выше 300 мс', en: 'p99 of the buyer response stays under 300 ms' },
            flow: PAYERS,
            metric: 'latency.p99',
            max: 300,
        },
        {
            id: 'R7',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 65%', en: 'No block runs hotter than 65%' },
            maxUtilization: 0.65,
        },
        {
            id: 'R8',
            kind: 'redundancy',
            desc: {
                ru: 'На пути платежа нет ни одного блока в единственном экземпляре',
                en: 'No block on the payment path runs as a single copy',
            },
            flow: PAYERS,
            minRedundancy: 3,
        },
        {
            id: 'R9',
            kind: 'capability',
            desc: {
                ru: 'Каждая проводка доезжает до неизменяемого архива в объектном хранилище',
                en: 'Every posting reaches an immutable archive in object storage',
            },
            flow: PAYERS,
            to: { group: 'storage' },
        },
        {
            id: 'R11',
            kind: 'security',
            desc: {
                ru: 'Аутентификация и ограничение частоты на периметре, клиент не ходит в хранилища напрямую',
                en: 'Authentication and rate limiting at the edge, no client talks to a store directly',
            },
            requires: ['auth-on-edge', 'rate-limit-at-edge', 'no-direct-client-to-db', 'tls-terminate'],
        },
        {
            id: 'R10',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $4.2 млн в месяц', en: 'Monthly cost stays under $4.2M' },
            maxMonthlyCostUsd: 4200000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианная оплата укладывается в 130 мс', en: 'Median payment stays under 130 ms' },
            flow: PAYERS,
            metric: 'latency.p50',
            max: 130,
        },
        {
            id: 'B2',
            kind: 'storage',
            desc: {
                ru: 'Объявленной ёмкости архива хватает на семь лет с запасом 30%',
                en: 'Declared archive capacity covers seven years with 30% headroom',
            },
            horizonYears: 7,
            headroom: 1.3,
        },
        {
            id: 'B3',
            kind: 'freshness',
            desc: {
                ru: 'Очередь списаний разбирается быстрее чем за 5 секунд',
                en: 'The charge queue drains in under 5 seconds',
            },
            maxLagSec: 5,
        },
    ],
    scenarios: { required: ['peak', 'az-failure'], bonus: ['cache-flush'] },
    relaxation: {
        peak: { utilizationFactor: 1.45, latencyFactor: 1.6 },
        'az-failure': { utilizationFactor: 1.45, latencyFactor: 2 },
        'cache-flush': { utilizationFactor: 1.3, latencyFactor: 2 },
    },
    lockedParams: { [PAYERS]: payerParams, [MERCHANTS]: merchantParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Покупатель нажал «оплатить», ответ не дошёл, клиент повторил запрос. Сколько раз в этот момент спишутся деньги — и что в вашей схеме отличает второй запрос от первого?',
                en: 'The buyer pressed Pay, the response never arrived, the client retried. How many times does the money move now — and what in your scheme tells the second request from the first?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Синхронный вызов эквайера привязывает ваш p99 к чужому: 900 мс в хвосте партнёра становятся 900 мс в вашем ответе. Отвяжите списание от ответа — команда в очередь, ответ покупателю сразу, статус приезжает вебхуком. Заодно исчезает вопрос «что делать, если партнёр не ответил»: команда просто ждёт в очереди.',
                en: 'A synchronous acquirer call chains your p99 to somebody else’s: their 900 ms tail becomes your 900 ms response. Detach the charge from the response — command into a queue, answer the buyer immediately, status arrives by webhook. That also settles the question of what to do when the partner does not answer: the command simply waits in the queue.',
            },
            forRequirement: 'R6',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Ключ идемпотентности живёт в кэше с CAS (concurrencyControl = optimistic) и суткой TTL, консьюмеры помечены идемпотентными на самом ребре, а событие «деньги списаны» публикуется не отдельным вызовом, а через outbox из той же транзакции, что и проводка. Журнал держите на serializable с pessimistic-контролем и читайте свои записи с primary: асинхронная реплика вернёт пустой баланс тому, кто только что заплатил.',
                en: 'The idempotency key lives in a cache with CAS (concurrencyControl = optimistic) and a one-day TTL, consumers are marked idempotent on the edge itself, and the "money moved" event is published not by a separate call but through an outbox inside the same transaction as the posting. Keep the ledger serializable with pessimistic control and read your own writes from the primary: an async replica returns an empty balance to the person who just paid.',
            },
            forRequirement: 'R3',
        },
    ],
    referenceSolutions: [
        {
            id: 'saga-and-outbox',
            name: { ru: 'Сага, outbox и очередь списаний', en: 'Saga, outbox and a charge queue' },
            tradeoff: {
                ru: 'Покупатель получает ответ, пока эквайер ещё думает: команда уходит в FIFO-очередь, сага ведёт её через шаги и умеет откатить, событие «деньги списаны» уезжает через outbox из той же транзакции, что и проводка. Платите за это тем, что «оплачено» и «подтверждено эквайером» — два разных состояния, и пользовательский интерфейс обязан их различать.',
                en: 'The buyer gets an answer while the acquirer is still thinking: the command goes into a FIFO queue, a saga walks it through the steps and can compensate, and the "money moved" event leaves through an outbox inside the same transaction as the posting. The price is that "paid" and "confirmed by the acquirer" are two different states, and the UI has to tell them apart.',
            },
            build: sagaAndOutbox,
        },
        {
            id: 'synchronous-gateway',
            name: { ru: 'Синхронный вызов эквайера', en: 'Synchronous acquirer call' },
            tradeoff: {
                ru: 'Вдвое меньше блоков и никакой распределённой машины состояний: чекаут сам зовёт эквайера и сам пишет проводку. Ровно поэтому хвост партнёра становится вашим хвостом, повтор запроса клиентом списывает деньги второй раз, а чтение баланса с асинхронной реплики показывает плательщику остаток до платежа.',
                en: 'Half the blocks and no distributed state machine: checkout calls the acquirer itself and writes the posting itself. Which is exactly why the partner’s tail becomes your tail, a client retry charges the money twice, and reading the balance from an async replica shows the payer the amount from before the payment.',
            },
            build: synchronousGateway,
        },
    ],
};
