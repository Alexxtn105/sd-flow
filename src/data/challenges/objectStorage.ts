import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const APPS = 'apps';
const BULK = 'bulk';

const appParams = {
    clients: 8000,
    rpsPerClient: 1,
    quotaPerDay: 2000000000,
    burstiness: 4,
    authMode: 'jwt-local',
    peakFactor: 2.2,
    readWriteMix: 0.9,
    avgRequestKb: 40,
    avgResponseKb: 120,
    geoDistribution: 'europe',
    retries: 2,
    timeoutMs: 30000,
};

const bulkParams = {
    rps: 40,
    slaTier: 'basic',
    peakFactor: 2,
    readWriteMix: 0.2,
    avgRequestKb: 2000,
    avgResponseKb: 400,
    geoDistribution: 'europe',
    retries: 2,
    timeoutMs: 120000,
};

const objectCalls = { requestBytes: 40000, responseBytes: 120000 };
const bulkCalls = { requestBytes: 2000000, responseBytes: 400000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'object-storage',
        name: 'Объектное хранилище',
        nodes: [
            { id: APPS, type: 'client-api', params: appParams, position: { x: 0, y: 160 } },
            { id: BULK, type: 'client-internal', params: bulkParams, position: { x: 0, y: 560 } },
        ],
        links: [],
    });
}

function erasureAndShardedMeta(): SchemeV1 {
    return buildScheme({
        id: 'object-storage-erasure',
        name: 'Erasure coding в плоскости данных и шардированные метаданные',
        nodes: [
            { id: APPS, type: 'client-api', params: appParams, position: { x: 0, y: 160 } },
            { id: BULK, type: 'client-internal', params: bulkParams, position: { x: 0, y: 560 } },
            {
                id: 'front',
                type: 'lb-l7',
                params: {
                    instances: 4,
                    azSpread: 3,
                    maxRpsPerInstance: 20000,
                    maxConnections: 200000,
                    cpuCores: 16,
                    tlsTerminate: true,
                    compression: false,
                    latencyMs: 0.8,
                },
                position: { x: 280, y: 340 },
            },
            {
                id: 'edge-cache',
                type: 'reverse-cache',
                params: {
                    instances: 4,
                    azSpread: 3,
                    cacheSizeGb: 800,
                    cacheHitRatio: 0.6,
                    ttlSec: 600,
                    staleWhileRevalidateSec: 60,
                    avgObjectKb: 120,
                    uniqueKeys: 40000000,
                    zipfAlpha: 1.1,
                    maxRpsPerInstance: 20000,
                    serviceTimeMs: 0.6,
                    cpuCores: 16,
                    networkMbps: 40000,
                },
                position: { x: 560, y: 160 },
            },
            {
                id: 'api',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 3,
                    serviceTimeSigma: 0.5,
                    cpuShare: 0.06,
                    instances: 6,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 400,
                    networkMbps: 25000,
                    queueLimit: 6000,
                    logLinesPerRequest: 1,
                },
                position: { x: 840, y: 340 },
            },
            {
                id: 'meta',
                type: 'vitess',
                params: {
                    shardCount: 24,
                    replicasPerShard: 2,
                    shardKey: 'bucketId',
                    shardStrategy: 'hash',
                    crossShardQueryShare: 0.02,
                    vtgateInstances: 4,
                    vtgateMaxRps: 20000,
                    maxConnections: 900,
                    cpuCores: 16,
                    bufferPoolGb: 64,
                    storageGb: 60000,
                    provisionedIops: 60000,
                    rowCount: 400000000000,
                    rowSizeBytes: 320,
                    readFromReplica: 0.5,
                    replicaLagMs: 200,
                    replicationMode: 'sync',
                    consistencyModel: 'linearizable',
                    concurrencyControl: 'optimistic',
                },
                position: { x: 1160, y: 160 },
            },
            {
                id: 'blobs',
                type: 'minio',
                params: {
                    nodes: 24,
                    disksPerNode: 48,
                    diskSizeTb: 30,
                    erasureCoding: 'ec-8-4',
                    storageOverhead: 1.5,
                    usableTb: 30000,
                    throughputGbps: 200,
                    maxOpsPerSecPerNode: 8000,
                    objectCount: 100000000000,
                    avgObjectSizeMb: 0.12,
                    firstByteLatencyMs: 6,
                    versioning: false,
                },
                position: { x: 1160, y: 420 },
            },
            {
                id: 'notifications',
                type: 'kafka',
                params: {
                    brokers: 6,
                    partitions: 60,
                    replicationFactor: 3,
                    minInsync: 2,
                    messageSizeKb: 1,
                    retentionHours: 72,
                    throughputMbsPerBroker: 250,
                },
                position: { x: 1480, y: 420 },
            },
            {
                id: 'lifecycle',
                type: 'worker',
                params: {
                    instances: 20,
                    concurrency: 64,
                    cpuCores: 4,
                    cpuShare: 0.25,
                    processingTimeMs: 60,
                    retries: 4,
                    idempotent: true,
                    dlqEnabled: true,
                },
                position: { x: 1780, y: 420 },
            },
            {
                id: 'archive',
                type: 'glacier',
                params: {
                    objectCount: 60000000000,
                    avgObjectSizeMb: 0.12,
                    retrievalTier: 'expedited',
                    retrievalHours: 1,
                    concurrency: 20000,
                    throughputMbs: 4000,
                    minStorageDays: 180,
                },
                position: { x: 2080, y: 420 },
            },
            {
                id: 'access-log',
                type: 'audit-log',
                params: {
                    eventsPerSec: 14000,
                    eventBytes: 700,
                    retentionYears: 3,
                    immutable: true,
                    compressionRatio: 4,
                    maxIngestMbs: 600,
                    maxOpsPerSec: 600000,
                },
                position: { x: 840, y: 640 },
            },
        ],
        links: [
            { from: APPS, to: 'front', readShare: 0.75, calls: objectCalls },
            { from: BULK, to: 'front', readShare: 0.2, calls: bulkCalls },
            { from: 'front', to: 'edge-cache', readShare: 0.72, calls: objectCalls },
            { from: 'edge-cache', to: 'api', readShare: 0.72, calls: objectCalls },
            {
                from: 'api',
                to: 'meta',
                readShare: 0.72,
                policy: { timeoutMs: 800, retries: 2, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'api',
                to: 'blobs',
                readShare: 0.72,
                calls: { requestBytes: 40000, responseBytes: 120000 },
                policy: { timeoutMs: 20000, retries: 2, circuitBreaker: true, idempotent: true },
            },
            { from: 'api', to: 'access-log', calls: { fanout: 1 }, policy: { idempotent: true } },
            { from: 'blobs', to: 'notifications', calls: { fanout: 0.3 } },
            {
                from: 'notifications',
                to: 'lifecycle',
                policy: { timeoutMs: 20000, retries: 4, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'lifecycle',
                to: 'archive',
                readShare: 0,
                calls: { fanout: 0.001, requestBytes: 120000, responseBytes: 120000 },
                policy: { timeoutMs: 60000, retries: 2, circuitBreaker: true, idempotent: true },
            },
        ],
    });
}

function sharedFilesystem(): SchemeV1 {
    return buildScheme({
        id: 'object-storage-nfs',
        name: 'Общая файловая система и метаданные в одной базе',
        nodes: [
            { id: APPS, type: 'client-api', params: appParams, position: { x: 0, y: 160 } },
            { id: BULK, type: 'client-internal', params: bulkParams, position: { x: 0, y: 560 } },
            {
                id: 'front',
                type: 'lb-l7',
                params: {
                    instances: 30,
                    azSpread: 3,
                    maxRpsPerInstance: 20000,
                    maxConnections: 200000,
                    cpuCores: 16,
                    tlsTerminate: true,
                    compression: false,
                    latencyMs: 0.8,
                },
                position: { x: 320, y: 340 },
            },
            {
                id: 'api',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 3,
                    serviceTimeSigma: 0.5,
                    cpuShare: 0.06,
                    instances: 6,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 400,
                    networkMbps: 25000,
                    queueLimit: 6000,
                },
                position: { x: 660, y: 340 },
            },
            {
                id: 'meta',
                type: 'postgres',
                params: {
                    readReplicas: 2,
                    readFromReplica: 0.6,
                    replicaLagMs: 400,
                    maxConnections: 900,
                    cpuCores: 64,
                    provisionedIops: 120000,
                    rowCount: 400000000000,
                    rowSizeBytes: 320,
                    storageGb: 120000,
                    concurrencyControl: 'none',
                },
                position: { x: 1000, y: 200 },
            },
            {
                id: 'files',
                type: 'nfs',
                params: {
                    storageGb: 900000,
                    throughputMbs: 3000,
                    burstCredits: 4000000,
                    provisionedIops: 400000,
                    latencyMs: 3,
                },
                position: { x: 1000, y: 480 },
            },
        ],
        links: [
            { from: APPS, to: 'front', readShare: 0.75, calls: objectCalls },
            { from: BULK, to: 'front', readShare: 0.2, calls: bulkCalls },
            { from: 'front', to: 'api', readShare: 0.72, calls: objectCalls },
            { from: 'api', to: 'meta', readShare: 0.72 },
            {
                from: 'api',
                to: 'files',
                readShare: 0.72,
                calls: { requestBytes: 40000, responseBytes: 120000 },
            },
        ],
    });
}

export const objectStorage: Challenge = {
    id: 'object-storage',
    level: 5,
    estimatedMinutes: 90,
    tags: ['storage', 'erasure-coding', 'durability', 'metadata', 'lifecycle'],
    title: { ru: 'Объектное хранилище', en: 'Object storage' },
    brief: {
        ru: 'Вы строите не клиента объектного хранилища, а само хранилище: 8 000 приложений дают 8 000 операций в секунду со средним объектом 120 КБ, плюс резервное копирование кусками по 2 МБ. Сто миллиардов объектов, 30 ПБ полезной ёмкости и обещанные одиннадцать девяток долговечности — это про erasure coding, а не про три копии. Метаданных при этом столько же, сколько объектов: сто миллиардов строк, к которым обращаются на каждый GET.',
        en: 'You are building not a client of an object store but the store itself: 8,000 applications drive 8,000 operations per second with an average object of 120 KB, plus backups in 2 MB parts. A hundred billion objects, 30 PB of usable capacity and a promised eleven nines of durability — that is about erasure coding, not about three copies. And there are as many metadata rows as objects: a hundred billion of them, touched on every single GET.',
    },
    given: {
        tenantApps: appParams.clients,
        objectOpsPerSec: 8000,
        avgObjectKb: 120,
        bulkOpsPerSec: 40,
        bulkPartMb: 2,
        objectCount: 100000000000,
        usablePb: 30,
        erasureOverhead: 1.5,
        durabilityNines: 11,
        peakFactor: appParams.peakFactor,
    },
    flows: [
        { id: APPS, name: { ru: 'Операция с объектом', en: 'Object operation' }, weightInScore: 0.7 },
        { id: BULK, name: { ru: 'Резервное копирование', en: 'Bulk backup' }, weightInScore: 0.3 },
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
            'search',
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
                ru: 'Тело объекта уходит в плоскость данных, а не в реляционную базу метаданных',
                en: 'The object body goes to the data plane, not into the relational metadata store',
            },
            flow: APPS,
            to: { group: 'storage' },
            notVia: [{ group: 'sql' }],
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Метаданные объекта живут в отдельном шардированном хранилище',
                en: 'Object metadata lives in a separate sharded store',
            },
            flow: APPS,
            to: { group: 'sql' },
            notVia: [{ group: 'storage' }],
        },
        {
            id: 'R3',
            kind: 'capability',
            desc: {
                ru: 'Событие изменения объекта доезжает до фонового обработчика через очередь',
                en: 'An object change event reaches the background worker through a queue',
            },
            flow: APPS,
            to: { type: 'worker' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'worker' },
        },
        {
            id: 'R4',
            kind: 'slo',
            desc: { ru: 'p99 операции с объектом не выше 400 мс', en: 'p99 of an object operation stays under 400 ms' },
            flow: APPS,
            metric: 'latency.p99',
            max: 400,
        },
        {
            id: 'R5',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 65%', en: 'No block runs hotter than 65%' },
            maxUtilization: 0.65,
        },
        {
            id: 'R6',
            kind: 'storage',
            desc: {
                ru: 'Объявленной ёмкости хватает на три года прироста с запасом 20%',
                en: 'Declared capacity covers three years of growth with 20% headroom',
            },
            horizonYears: 3,
            headroom: 1.2,
        },
        {
            id: 'R7',
            kind: 'redundancy',
            desc: {
                ru: 'На пути объекта нет ни одного блока в единственном экземпляре',
                en: 'No block on the object path runs as a single copy',
            },
            flow: APPS,
            minRedundancy: 3,
        },
        {
            id: 'R8',
            kind: 'freshness',
            desc: {
                ru: 'Фоновая обработка событий отстаёт не больше чем на 30 секунд',
                en: 'Background event processing lags by no more than 30 seconds',
            },
            maxLagSec: 30,
        },
        {
            id: 'R9',
            kind: 'security',
            desc: {
                ru: 'TLS терминируется на входе, клиент не ходит в хранилище напрямую',
                en: 'TLS terminates at the entry, no client talks to the store directly',
            },
            requires: ['tls-terminate', 'no-direct-client-to-db'],
        },
        {
            id: 'R10',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $1.2 млн в месяц', en: 'Monthly cost stays under $1.2M' },
            maxMonthlyCostUsd: 1200000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианная операция укладывается в 150 мс', en: 'Median operation stays under 150 ms' },
            flow: APPS,
            metric: 'latency.p50',
            max: 150,
        },
        {
            id: 'B2',
            kind: 'slo',
            desc: {
                ru: 'Доступность операций с объектами не ниже 99.95%',
                en: 'Object operation availability stays at or above 99.95%',
            },
            flow: APPS,
            metric: 'availability',
            min: 0.9995,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.45, latencyFactor: 1.6 },
        'cache-flush': { utilizationFactor: 1.45, latencyFactor: 2.5 },
        'az-failure': { utilizationFactor: 1.45, latencyFactor: 2 },
    },
    lockedParams: { [APPS]: appParams, [BULK]: bulkParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько дисков надо потерять одновременно, чтобы объект стал невосстановимым, — при трёх копиях и при схеме 8+4? И во сколько раз отличается занятое место?',
                en: 'How many disks must be lost at once for an object to become unrecoverable — with three copies and with an 8+4 scheme? And how far apart is the space they occupy?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Тело и описание объекта — две разные задачи с разной физикой. Тело большое, читается целиком и хорошо ложится на erasure coding: полтора байта на байт вместо трёх. Описание маленькое, читается на каждый запрос и обязано быть шардированным: четыреста миллиардов строк не живут в одном экземпляре базы.',
                en: 'The body and the description of an object are two different problems with different physics. The body is large, read whole and fits erasure coding well: one and a half bytes per byte instead of three. The description is small, read on every request and must be sharded: four hundred billion rows do not live in a single database instance.',
            },
            forRequirement: 'R2',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Плоскость данных — erasure-кластер 8+4 с накладными расходами полтора; плоскость метаданных — шардированный SQL по ключу бакета с репликами на чтение. Перед ними обратный кэш: половина GET приходится на несколько процентов объектов. Жизненный цикл (перенос в архив, удаление по правилам) вешайте на события хранилища и очередь, а не на обход всех объектов по ночам.',
                en: 'The data plane is an 8+4 erasure cluster with an overhead of one and a half; the metadata plane is sharded SQL by bucket key with read replicas. In front of them, a reverse cache: half of the GETs land on a few percent of the objects. Hang the lifecycle (archival, rule-based deletion) on storage events and a queue instead of walking every object nightly.',
            },
            forRequirement: 'R3',
        },
    ],
    referenceSolutions: [
        {
            id: 'erasure-and-sharded-meta',
            name: { ru: 'Erasure coding и шардированные метаданные', en: 'Erasure coding and sharded metadata' },
            tradeoff: {
                ru: 'Данные и метаданные разъехались по разным системам с разной физикой: 8+4 вместо трёх копий экономит половину дисков, шардированный SQL держит сто миллиардов строк, события хранилища двигают жизненный цикл. Платите тем, что запись объекта теперь трогает две системы, и рассинхрон между ними — ваш новый класс инцидентов. Линтер справедливо указывает ещё на две цены этого решения: журнал доступа живёт единственным кластером, а вызов холодного архива из обработчика синхронный — архив отвечает часами, и звать его с горячего пути нельзя.',
                en: 'Data and metadata went into different systems with different physics: 8+4 instead of three copies saves half the disks, sharded SQL holds a hundred billion rows, storage events drive the lifecycle. You pay with the fact that writing an object now touches two systems, and drift between them is your new class of incident. The linter rightly points at two more prices of this design: the access log lives as a single cluster, and the call into cold storage from the worker is synchronous — the archive answers in hours and must never be on a hot path.',
            },
            build: erasureAndShardedMeta,
        },
        {
            id: 'shared-filesystem',
            name: { ru: 'Общая файловая система', en: 'A shared filesystem' },
            tradeoff: {
                ru: 'Файлы — в сетевую файловую систему, описания — в одну базу, и никакого своего протокола. Ровно до того момента, как полоса единственной точки монтирования становится потолком всей системы, а четыреста миллиардов строк в одном экземпляре базы перестают помещаться в буферный пул.',
                en: 'Files into a network filesystem, descriptions into one database, and no home-grown protocol. Right up to the moment the bandwidth of a single mount point becomes the ceiling of the whole system and four hundred billion rows in one database instance stop fitting into the buffer pool.',
            },
            build: sharedFilesystem,
        },
    ],
};
