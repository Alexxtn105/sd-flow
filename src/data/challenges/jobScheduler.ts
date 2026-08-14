import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const TENANTS = 'tenants';

const tenantParams = {
    clients: 1500,
    rpsPerClient: 2,
    quotaPerDay: 40000000,
    burstiness: 4,
    authMode: 'jwt-local',
    peakFactor: 2.5,
    readWriteMix: 0.5,
    avgRequestKb: 2,
    avgResponseKb: 4,
    geoDistribution: 'global',
};

const tenantCalls = { requestBytes: 2000, responseBytes: 4000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'job-scheduler',
        name: 'Распределённый планировщик задач',
        nodes: [{ id: TENANTS, type: 'client-api', params: tenantParams, position: { x: 0, y: 300 } }],
        links: [],
    });
}

function leasesAndQueue(): SchemeV1 {
    return buildScheme({
        id: 'job-scheduler-leases',
        name: 'Аренды, очередь отложенных задач и идемпотентный исполнитель',
        nodes: [
            { id: TENANTS, type: 'client-api', params: tenantParams, position: { x: 0, y: 300 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 3,
                    azSpread: 3,
                    maxRpsPerInstance: 4000,
                    serviceTimeMs: 2,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 40,
                    payloadLimitMb: 1,
                },
                position: { x: 280, y: 300 },
            },
            {
                id: 'api',
                type: 'service',
                params: {
                    serviceTimeMs: 8,
                    serviceTimeSigma: 0.5,
                    cpuShare: 0.08,
                    instances: 6,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 200,
                    queueLimit: 1000,
                },
                position: { x: 560, y: 300 },
            },
            {
                id: 'registry',
                type: 'etcd',
                params: {
                    nodes: 5,
                    writeQuorumMs: 8,
                    maxDbSizeMb: 4096,
                    watchers: 20000,
                    leaseCount: 200000,
                    uniqueKeys: 400000,
                    batchSize: 256,
                    cpuCores: 16,
                    cpuShare: 0.15,
                },
                position: { x: 840, y: 100 },
            },
            {
                id: 'journal',
                type: 'cockroach',
                params: {
                    nodes: 9,
                    regions: 1,
                    replicationFactor: 3,
                    partitionStrategy: 'range',
                    partitionKey: 'tenantId',
                    maxOpsPerSecPerNode: 12000,
                    storageGbPerNode: 4000,
                    rowCount: 8000000000,
                    rowSizeBytes: 500,
                    readFromReplica: 0,
                    crossRegionRttMs: 30,
                },
                position: { x: 840, y: 300 },
            },
            {
                id: 'schedule',
                type: 'scheduler-queue',
                params: {
                    delayDistribution: 'flat',
                    maxDelayHours: 24,
                    pendingJobs: 400000000,
                    instances: 6,
                    batchSize: 1200,
                    pollIntervalSec: 0.5,
                    memoryGb: 3072,
                    messageSizeKb: 2,
                },
                position: { x: 840, y: 520 },
            },
            {
                id: 'ready',
                type: 'rabbitmq',
                params: {
                    nodes: 5,
                    queues: 60,
                    quorumQueues: true,
                    throughputPerQueue: 20000,
                    prefetch: 64,
                    ackMode: 'manual',
                    messageSizeKb: 2,
                    maxQueueDepth: 2000000,
                    dlqEnabled: true,
                    ttlSec: 7200,
                },
                position: { x: 1120, y: 520 },
            },
            {
                id: 'runner',
                type: 'worker',
                params: {
                    instances: 16,
                    concurrency: 48,
                    cpuCores: 8,
                    cpuShare: 0.25,
                    processingTimeMs: 220,
                    prefetch: 16,
                    retries: 5,
                    idempotent: true,
                    dlqEnabled: true,
                },
                position: { x: 1400, y: 520 },
            },
            {
                id: 'leases',
                type: 'dist-lock',
                params: {
                    backend: 'etcd',
                    lockHoldMs: 20,
                    contentionRate: 0.01,
                    fencingTokens: true,
                    maxOpsPerSec: 200000,
                    instances: 3,
                },
                position: { x: 1400, y: 300 },
            },
            {
                id: 'dead',
                type: 'dlq',
                params: {
                    maxRetries: 5,
                    reprocessMode: 'manual',
                    redriveDelaySec: 600,
                    alertThresholdMessages: 50,
                    maxDepth: 40000000,
                    retentionHours: 168,
                    messageSizeKb: 2,
                },
                position: { x: 1680, y: 660 },
            },
            {
                id: 'callbacks',
                type: 'webhook',
                params: {
                    subscribers: 1,
                    deliveryTimeoutMs: 3000,
                    retryBackoffMs: 800,
                    maxRetries: 4,
                    slowConsumerShare: 0.03,
                    concurrency: 512,
                    serviceTimeMs: 90,
                    maxOpsPerSec: 40000,
                    instances: 4,
                },
                position: { x: 1680, y: 400 },
            },
        ],
        links: [
            { from: TENANTS, to: 'gateway', readShare: 0.5, calls: tenantCalls },
            { from: 'gateway', to: 'api', readShare: 0.5, calls: tenantCalls },
            {
                from: 'api',
                to: 'registry',
                readShare: 0.5,
                calls: { fanout: 0.2 },
                policy: { timeoutMs: 500, retries: 2, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'api',
                to: 'journal',
                readShare: 0.5,
                policy: { timeoutMs: 800, retries: 2, circuitBreaker: true, idempotent: true },
            },
            { from: 'api', to: 'schedule', calls: { fanout: 0.2 } },
            { from: 'schedule', to: 'ready' },
            { from: 'ready', to: 'runner', policy: { timeoutMs: 30000, retries: 5, circuitBreaker: true, idempotent: true } },
            {
                from: 'runner',
                to: 'leases',
                readShare: 0,
                policy: { timeoutMs: 400, retries: 2, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'runner',
                to: 'journal',
                readShare: 0,
                policy: { timeoutMs: 800, retries: 2, circuitBreaker: true, idempotent: true },
            },
            { from: 'runner', to: 'dead', calls: { fanout: 0.002 } },
            {
                from: 'runner',
                to: 'callbacks',
                readShare: 0,
                calls: { fanout: 0.6 },
                policy: { timeoutMs: 5000, retries: 3, circuitBreaker: true, idempotent: true },
            },
        ],
    });
}

function pollingMonolith(): SchemeV1 {
    return buildScheme({
        id: 'job-scheduler-polling',
        name: 'Опрос таблицы и запуск в том же процессе',
        nodes: [
            { id: TENANTS, type: 'client-api', params: tenantParams, position: { x: 0, y: 300 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 3,
                    azSpread: 3,
                    maxRpsPerInstance: 4000,
                    serviceTimeMs: 2,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 40,
                    payloadLimitMb: 1,
                },
                position: { x: 280, y: 300 },
            },
            {
                id: 'api',
                type: 'monolith',
                params: {
                    instances: 4,
                    azSpread: 2,
                    moduleCount: 8,
                    serviceTimeMs: 1400,
                    serviceTimeSigma: 1,
                    cpuShare: 0.3,
                    cpuCores: 16,
                    concurrencyPerInstance: 200,
                    sharedDbConnections: 60,
                    queueLimit: 400,
                    timeoutMs: 8000,
                },
                position: { x: 560, y: 300 },
            },
            {
                id: 'journal',
                type: 'postgres',
                params: {
                    readReplicas: 0,
                    readFromReplica: 0,
                    maxConnections: 600,
                    cpuCores: 32,
                    provisionedIops: 40000,
                    rowCount: 8000000000,
                    rowSizeBytes: 500,
                    storageGb: 30000,
                    queryProfile: 'range-scan',
                    concurrencyControl: 'none',
                    multiAz: false,
                },
                position: { x: 840, y: 300 },
            },
        ],
        links: [
            { from: TENANTS, to: 'gateway', readShare: 0.5, calls: tenantCalls },
            { from: 'gateway', to: 'api', readShare: 0.5, calls: tenantCalls },
            { from: 'api', to: 'journal', readShare: 0.5, calls: { fanout: 3 } },
        ],
    });
}

export const jobScheduler: Challenge = {
    id: 'job-scheduler',
    level: 4,
    estimatedMinutes: 60,
    tags: ['scheduling', 'leases', 'at-least-once', 'idempotency', 'coordination'],
    title: { ru: 'Распределённый планировщик задач', en: 'Distributed job scheduler' },
    brief: {
        ru: 'Полторы тысячи сервисов-арендаторов ставят задачи в общий планировщик: 3 000 запросов в секунду, из них 600 — «выполни вот это через час или через сутки». В ожидании висит 400 миллионов задач. В момент наступления срока задачу должен взять ровно один исполнитель — а исполнителей десятки, они падают посреди работы, их часы расходятся на секунды, и очередь честно доставляет сообщение «хотя бы один раз». Задача, выполненная дважды, — это дважды отправленный счёт клиенту.',
        en: 'Fifteen hundred tenant services push jobs into a shared scheduler: 3,000 requests per second, 600 of them "run this in an hour or a day". Four hundred million jobs sit waiting. When a job comes due exactly one worker must pick it up — and there are dozens of workers, they die mid-run, their clocks drift by seconds, and the queue honestly delivers "at least once". A job executed twice is an invoice sent twice.',
    },
    given: {
        tenantServices: tenantParams.clients,
        avgRps: 3000,
        writeShare: 0.5,
        jobsPerSec: 600,
        pendingJobs: 400000000,
        maxDelayHours: 24,
        jobDurationMs: 220,
        clockSkewSec: 2,
        peakFactor: tenantParams.peakFactor,
    },
    flows: [{ id: TENANTS, name: { ru: 'Постановка и запуск задачи', en: 'Schedule and run a job' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 14,
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
                ru: 'Задача доезжает до исполнителя через очередь, а не вызовом из обработчика запроса',
                en: 'A job reaches the worker through a queue, not by a call from the request handler',
            },
            flow: TENANTS,
            to: { type: 'worker' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'worker' },
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Факт запуска записан в долговечный журнал, а не только в очередь',
                en: 'The fact of a run is written to a durable journal, not only to the queue',
            },
            flow: TENANTS,
            to: { group: 'sql' },
            notVia: [{ group: 'messaging' }],
        },
        {
            id: 'R3',
            kind: 'anomaly',
            desc: {
                ru: 'Повторная доставка сообщения не приводит к повторному выполнению задачи',
                en: 'A redelivered message never leads to a second execution',
            },
            code: 'duplicate-processing',
            maxRatePerSec: 0,
        },
        {
            id: 'R4',
            kind: 'anomaly',
            desc: {
                ru: 'Два исполнителя не затирают статус одной и той же задачи',
                en: 'Two workers never overwrite the status of the same job',
            },
            code: 'lost-update',
            maxRatePerSec: 0,
        },
        {
            id: 'R5',
            kind: 'slo',
            desc: { ru: 'p99 постановки задачи не выше 250 мс', en: 'p99 of scheduling a job stays under 250 ms' },
            flow: TENANTS,
            metric: 'latency.p99',
            max: 250,
        },
        {
            id: 'R6',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 70%', en: 'No block runs hotter than 70%' },
            maxUtilization: 0.7,
        },
        {
            id: 'R7',
            kind: 'freshness',
            desc: {
                ru: 'Наступившие сроки разбираются не дольше 15 секунд',
                en: 'Jobs that came due are picked up within 15 seconds',
            },
            maxLagSec: 15,
        },
        {
            id: 'R8',
            kind: 'redundancy',
            desc: {
                ru: 'На пути задачи нет ни одного блока в единственном экземпляре',
                en: 'No block on the job path runs as a single copy',
            },
            flow: TENANTS,
            minRedundancy: 3,
        },
        {
            id: 'R9',
            kind: 'security',
            desc: {
                ru: 'Аутентификация и квоты на периметре, арендатор не ходит в хранилище напрямую',
                en: 'Authentication and quotas at the edge, no tenant talks to the store directly',
            },
            requires: ['auth-on-edge', 'rate-limit-at-edge', 'no-direct-client-to-db'],
        },
        {
            id: 'R10',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $60 000 в месяц', en: 'Monthly cost stays under $60,000' },
            maxMonthlyCostUsd: 60000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианная постановка укладывается в 100 мс', en: 'Median scheduling stays under 100 ms' },
            flow: TENANTS,
            metric: 'latency.p50',
            max: 100,
        },
        {
            id: 'B2',
            kind: 'capacity',
            desc: {
                ru: 'Самый горячий блок не выходит за половину ёмкости — есть запас на всплеск сроков',
                en: 'The hottest block stays within half its capacity — room for a burst of due jobs',
            },
            maxUtilization: 0.5,
        },
    ],
    scenarios: { required: ['peak', 'az-failure'], bonus: ['cache-flush'] },
    relaxation: {
        peak: { utilizationFactor: 1.4, latencyFactor: 1.6 },
        'az-failure': { utilizationFactor: 1.4, latencyFactor: 2 },
        'cache-flush': { utilizationFactor: 1.3, latencyFactor: 2 },
    },
    lockedParams: { [TENANTS]: tenantParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Исполнитель взял задачу, начал работу и умер, не подтвердив сообщение. Очередь отдаст задачу другому. Что должно быть верно, чтобы это не превратилось во второй счёт клиенту?',
                en: 'A worker took a job, started running and died without acknowledging the message. The queue will hand the job to somebody else. What must be true so that this does not become a second invoice?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Четыреста миллионов ожидающих задач — это не очередь, это индекс по времени. Очередь нужна другая: в неё попадают только те задачи, чей срок уже наступил. И у взявшего задачу должна быть аренда с ограниченным сроком и токеном — иначе «умерший» исполнитель, который на самом деле просто завис, продолжит писать результат после того, как задачу отдали другому.',
                en: 'Four hundred million pending jobs is not a queue, it is a time index. The queue you need is a different one: only jobs whose time has come go into it. And whoever takes a job needs a time-bounded lease with a token — otherwise the "dead" worker, which was merely frozen, keeps writing its result after the job was handed to somebody else.',
            },
            forRequirement: 'R3',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Разделите три вещи: хранилище отложенных задач с индексом по сроку, обычную очередь готовых к запуску и журнал запусков. Консьюмер помечается идемпотентным прямо на ребре, аренду берите через распределённую блокировку с fencing-токенами, а журнал держите на линеаризуемом хранилище — расхождение часов на две секунды не должно превращаться в два запуска.',
                en: 'Separate three things: a store of delayed jobs indexed by due time, an ordinary queue of jobs ready to run, and a journal of runs. Mark the consumer idempotent on the edge itself, take the lease through a distributed lock with fencing tokens, and keep the journal on a linearizable store — two seconds of clock drift must not turn into two runs.',
            },
            forRequirement: 'R1',
        },
    ],
    referenceSolutions: [
        {
            id: 'leases-and-queue',
            name: { ru: 'Аренды и очередь готовых задач', en: 'Leases and a ready queue' },
            tradeoff: {
                ru: 'Три хранилища вместо одного, зато каждое занимается своим: индекс сроков держит четыреста миллионов ожидающих, очередь несёт только наступившее, журнал на кворуме фиксирует запуск. Платите за это координацией: аренда — это ещё один сетевой вызов на каждую задачу, а координатор кворума становится тем, на что вы смотрите первым делом при любом инциденте.',
                en: 'Three stores instead of one, but each does its own job: the due-time index holds four hundred million pending jobs, the queue carries only what came due, the quorum journal records the run. You pay in coordination: a lease is one more network call per job, and the quorum coordinator becomes the first thing you look at in any incident.',
            },
            build: leasesAndQueue,
        },
        {
            id: 'polling-monolith',
            name: { ru: 'Опрос таблицы и запуск на месте', en: 'Poll the table and run in place' },
            tradeoff: {
                ru: 'Одна таблица, один процесс, ноль распределённых примитивов — и ровно поэтому задача на 220 мс превращается в полуторасекундный синхронный ответ, а «взять задачу» становится состязанием за одну и ту же строку без всякого контроля конкурентности. Дёшево, понятно и не работает.',
                en: 'One table, one process, zero distributed primitives — and precisely for that reason a 220 ms job turns into a one-and-a-half-second synchronous response, and "take a job" becomes a race for the same row with no concurrency control at all. Cheap, obvious and broken.',
            },
            build: pollingMonolith,
        },
    ],
};
