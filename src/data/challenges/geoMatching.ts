import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const DRIVERS = 'drivers';
const RIDERS = 'riders';

const driverParams = {
    deviceCount: 500000,
    reportIntervalSec: 5,
    payloadBytes: 220,
    batchSize: 1,
    alwaysConnected: true,
    peakFactor: 1.6,
    readWriteMix: 0.05,
    avgResponseKb: 0.2,
    geoDistribution: 'europe',
    retries: 1,
    timeoutMs: 4000,
};

const riderParams = {
    dau: 9000000,
    sessionsPerUserDay: 2,
    requestsPerSession: 20,
    avgRequestKb: 1,
    avgResponseKb: 8,
    readWriteMix: 0.8,
    cacheableShare: 0.4,
    peakFactor: 2.4,
    diurnalPattern: 'evening',
    geoDistribution: 'europe',
    networkRttMs: 50,
};

const pingCalls = { requestBytes: 220, responseBytes: 200 };
const riderCalls = { requestBytes: 1000, responseBytes: 8000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'geo-matching',
        name: 'Гео-поиск и матчинг в реальном времени',
        nodes: [
            { id: DRIVERS, type: 'client-iot', params: driverParams, position: { x: 0, y: 140 } },
            { id: RIDERS, type: 'client-mobile', params: riderParams, position: { x: 0, y: 540 } },
        ],
        links: [],
    });
}

function geoIndexAndStream(): SchemeV1 {
    return buildScheme({
        id: 'geo-matching-index',
        name: 'Гео-индекс в памяти и история позиций за потоком',
        nodes: [
            { id: DRIVERS, type: 'client-iot', params: driverParams, position: { x: 0, y: 140 } },
            { id: RIDERS, type: 'client-mobile', params: riderParams, position: { x: 0, y: 540 } },
            {
                id: 'ping-lb',
                type: 'lb-l7',
                params: {
                    instances: 14,
                    azSpread: 3,
                    maxRpsPerInstance: 25000,
                    cpuCores: 8,
                    tlsTerminate: true,
                    compression: false,
                    latencyMs: 0.5,
                },
                position: { x: 280, y: 140 },
            },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 4,
                    azSpread: 3,
                    maxRpsPerInstance: 6000,
                    serviceTimeMs: 2,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 20,
                    payloadLimitMb: 1,
                },
                position: { x: 280, y: 540 },
            },
            {
                id: 'tracker',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 1.5,
                    serviceTimeSigma: 0.4,
                    cpuShare: 0.05,
                    instances: 20,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 500,
                    logLinesPerRequest: 0,
                },
                position: { x: 600, y: 140 },
            },
            {
                id: 'cells',
                type: 'geo-index',
                params: {
                    precision: 7,
                    cellCount: 60000000,
                    updatesPerSec: 600000,
                    queryRadiusKm: 3,
                    backend: 'redis',
                    maxOpsPerSec: 700000,
                    rowSizeBytes: 220,
                    serviceTimeMs: 0.05,
                    instances: 8,
                },
                position: { x: 920, y: 300 },
            },
            {
                id: 'pings',
                type: 'nats',
                params: {
                    nodes: 6,
                    subjects: 4000,
                    streamRetention: 'limits',
                    maxAckPending: 20000,
                    maxOpsPerSecPerNode: 150000,
                    messageSizeKb: 0.25,
                    retentionHours: 12,
                    processingTimeMs: 2,
                },
                position: { x: 920, y: 60 },
            },
            {
                id: 'trails',
                type: 'stream-processor',
                params: {
                    parallelism: 120,
                    partitions: 120,
                    recordsPerSecPerTask: 20000,
                    stateSizeGb: 200,
                    checkpointIntervalSec: 30,
                    windowType: 'session',
                    exactlyOnce: false,
                    watermarkLagSec: 10,
                    instances: 8,
                    memoryGb: 48,
                },
                position: { x: 1240, y: 60 },
            },
            {
                id: 'history',
                type: 'timescale',
                params: {
                    readReplicas: 2,
                    metricsPerSec: 120000,
                    insertBatchRows: 4000,
                    chunkIntervalHours: 6,
                    compressionAfterDays: 1,
                    retentionDays: 180,
                    queryRangeHours: 24,
                    rowSizeBytes: 220,
                    cpuCores: 32,
                    maxConnections: 800,
                    provisionedIops: 80000,
                    readFromReplica: 0,
                },
                position: { x: 1560, y: 60 },
            },
            {
                id: 'matcher',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 9,
                    serviceTimeSigma: 0.6,
                    cpuShare: 0.12,
                    instances: 12,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 300,
                    queueLimit: 3000,
                },
                position: { x: 600, y: 540 },
            },
            {
                id: 'trips',
                type: 'mongodb',
                params: {
                    replicaSetSize: 3,
                    shardCount: 12,
                    shardKey: 'cityId',
                    writeConcern: 'majority',
                    readPreference: 'primary',
                    documentSizeKb: 3,
                    documentCount: 4000000000,
                    workingSetGb: 240,
                    wiredTigerCacheGb: 96,
                    storageGb: 24000,
                    cpuCores: 32,
                    maxConnections: 4000,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 920, y: 700 },
            },
            {
                id: 'eta-cache',
                type: 'redis',
                params: {
                    shards: 6,
                    replicasPerShard: 2,
                    memoryGb: 24,
                    uniqueKeys: 3000000,
                    valueSizeBytes: 2000,
                    ttlSec: 45,
                    zipfAlpha: 1.1,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 920, y: 540 },
            },
        ],
        links: [
            { from: DRIVERS, to: 'ping-lb', readShare: 0.05, calls: pingCalls },
            { from: RIDERS, to: 'gateway', readShare: 0.8, calls: riderCalls },
            { from: 'ping-lb', to: 'tracker', readShare: 0.05, calls: pingCalls },
            { from: 'gateway', to: 'matcher', readShare: 0.8, calls: riderCalls },
            {
                from: 'tracker',
                to: 'cells',
                readShare: 0,
                policy: { timeoutMs: 200, retries: 1, circuitBreaker: true, idempotent: true },
            },
            { from: 'tracker', to: 'pings', calls: { fanout: 1, requestBytes: 220, responseBytes: 0 } },
            { from: 'pings', to: 'trails', policy: { timeoutMs: 15000, retries: 2, circuitBreaker: true, idempotent: true } },
            {
                from: 'trails',
                to: 'history',
                readShare: 0,
                calls: { fanout: 0.001, requestBytes: 900000, responseBytes: 200 },
                policy: { timeoutMs: 10000, retries: 2, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'matcher',
                to: 'cells',
                readShare: 1,
                calls: { fanout: 0.3 },
                policy: { timeoutMs: 200, retries: 1, circuitBreaker: true, idempotent: true },
            },
            { from: 'matcher', to: 'eta-cache', readShare: 0.9 },
            {
                from: 'matcher',
                to: 'trips',
                readShare: 0.8,
                policy: { timeoutMs: 500, retries: 2, circuitBreaker: true, idempotent: true },
            },
        ],
    });
}

function postgisEverything(): SchemeV1 {
    return buildScheme({
        id: 'geo-matching-postgis',
        name: 'Позиции и матчинг одним пространственным запросом',
        nodes: [
            { id: DRIVERS, type: 'client-iot', params: driverParams, position: { x: 0, y: 140 } },
            { id: RIDERS, type: 'client-mobile', params: riderParams, position: { x: 0, y: 540 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 8,
                    azSpread: 3,
                    maxRpsPerInstance: 20000,
                    serviceTimeMs: 2,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 20,
                    payloadLimitMb: 1,
                },
                position: { x: 320, y: 340 },
            },
            {
                id: 'matcher',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 9,
                    serviceTimeSigma: 0.6,
                    cpuShare: 0.12,
                    instances: 12,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 300,
                    queueLimit: 3000,
                },
                position: { x: 640, y: 340 },
            },
            {
                id: 'geodb',
                type: 'postgres',
                params: {
                    readReplicas: 3,
                    readFromReplica: 0.6,
                    replicaLagMs: 800,
                    maxConnections: 900,
                    cpuCores: 64,
                    provisionedIops: 120000,
                    rowCount: 500000,
                    rowSizeBytes: 260,
                    storageGb: 8000,
                    queryProfile: 'range-scan',
                    workingSetGb: 60,
                    bufferPoolGb: 64,
                    concurrencyControl: 'none',
                },
                position: { x: 960, y: 340 },
            },
        ],
        links: [
            { from: DRIVERS, to: 'gateway', readShare: 0.05, calls: pingCalls },
            { from: RIDERS, to: 'gateway', readShare: 0.8, calls: riderCalls },
            { from: 'gateway', to: 'matcher', readShare: 0.1, calls: pingCalls },
            { from: 'matcher', to: 'geodb', readShare: 0.1 },
        ],
    });
}

export const geoMatching: Challenge = {
    id: 'geo-matching',
    level: 4,
    estimatedMinutes: 60,
    tags: ['geo', 'realtime', 'matching', 'streaming', 'iot'],
    title: { ru: 'Гео-поиск и матчинг в реальном времени', en: 'Real-time geo search and matching' },
    brief: {
        ru: 'Полмиллиона водителей шлют координаты каждые пять секунд — 100 000 записей в секунду, которые устаревают через те же пять секунд. Одновременно 2 100 пассажиров в секунду спрашивают «кто рядом со мной» и ждут ответ за четверть секунды. Позиции почти не нужно хранить — их нужно быстро искать по радиусу; поездки, наоборот, надо хранить годами. Плюс регуляторное требование: трек каждой поездки поднимается за полгода назад.',
        en: 'Half a million drivers push coordinates every five seconds — 100,000 writes per second that go stale in those same five seconds. At the same time 2,100 riders per second ask "who is near me" and expect an answer in a quarter of a second. Positions barely need storing — they need fast radius search; trips, on the contrary, must be kept for years. Plus a regulatory requirement: the track of any trip is recoverable half a year back.',
    },
    given: {
        activeDrivers: driverParams.deviceCount,
        pingIntervalSec: driverParams.reportIntervalSec,
        pingsPerSec: 100000,
        dau: riderParams.dau,
        riderRps: 2083,
        searchRadiusKm: 3,
        trackRetentionDays: 180,
        peakFactor: riderParams.peakFactor,
        clientRttMs: riderParams.networkRttMs,
    },
    flows: [
        { id: DRIVERS, name: { ru: 'Обновление позиции', en: 'Position update' }, weightInScore: 0.45 },
        { id: RIDERS, name: { ru: 'Поиск и заказ машины', en: 'Search and book a car' }, weightInScore: 0.55 },
    ],
    constraints: {
        maxNodes: 16,
        allowedGroups: [
            'clients',
            'edge',
            'compute',
            'sql',
            'nosql',
            'cache',
            'messaging',
            'search',
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
                ru: 'Позиция водителя попадает в структуру, по которой ищут соседей',
                en: 'A driver position lands in the structure used for neighbour search',
            },
            flow: DRIVERS,
            to: { type: 'geo-index' },
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Пассажир ищет машины по тому же гео-индексу, а не сканированием базы поездок',
                en: 'A rider searches the same geo index instead of scanning the trip store',
            },
            flow: RIDERS,
            to: { type: 'geo-index' },
        },
        {
            id: 'R3',
            kind: 'capability',
            desc: {
                ru: 'Трек позиций доезжает до долговечного хранилища через буфер',
                en: 'The position trail reaches durable storage through a buffer',
            },
            flow: DRIVERS,
            to: { group: 'nosql' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'stream-processor' },
        },
        {
            id: 'R4',
            kind: 'slo',
            desc: { ru: 'p99 обновления позиции не выше 120 мс', en: 'p99 of a position update stays under 120 ms' },
            flow: DRIVERS,
            metric: 'latency.p99',
            max: 120,
        },
        {
            id: 'R5',
            kind: 'slo',
            desc: { ru: 'p99 поиска машины не выше 250 мс', en: 'p99 of a car search stays under 250 ms' },
            flow: RIDERS,
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
            kind: 'anomaly',
            desc: {
                ru: 'Две одновременные заявки не назначают одну машину дважды',
                en: 'Two simultaneous requests never assign the same car twice',
            },
            code: 'lost-update',
            maxRatePerSec: 0,
        },
        {
            id: 'R8',
            kind: 'freshness',
            desc: {
                ru: 'Трек позиций отстаёт не больше чем на 10 секунд',
                en: 'The position trail lags by no more than 10 seconds',
            },
            maxLagSec: 10,
        },
        {
            id: 'R9',
            kind: 'geo',
            desc: {
                ru: 'До входной точки не больше 60 мс — иначе четверть бюджета уходит на дорогу',
                en: 'No more than 60 ms to the entry point — otherwise a quarter of the budget goes to the wire',
            },
            maxClientRttMs: 60,
        },
        {
            id: 'R10',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $240 000 в месяц', en: 'Monthly cost stays under $240,000' },
            maxMonthlyCostUsd: 240000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианный поиск укладывается в 120 мс', en: 'Median search stays under 120 ms' },
            flow: RIDERS,
            metric: 'latency.p50',
            max: 120,
        },
        {
            id: 'B2',
            kind: 'redundancy',
            desc: {
                ru: 'На пути пассажира нет блока в единственном экземпляре',
                en: 'No block on the rider path runs as a single copy',
            },
            flow: RIDERS,
            minRedundancy: 3,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.4, latencyFactor: 1.5 },
        'cache-flush': { utilizationFactor: 1.35, latencyFactor: 2 },
        'az-failure': { utilizationFactor: 1.4, latencyFactor: 2 },
    },
    lockedParams: { [DRIVERS]: driverParams, [RIDERS]: riderParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько живёт одна запись о позиции — и сколько раз её прочитают за это время? А сколько живёт запись о поездке?',
                en: 'How long does one position record live — and how many times will it be read in that time? And how long does a trip record live?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Сто тысяч записей в секунду, которые устаревают через пять секунд, не надо класть в долговечную базу — им нужна структура в памяти с делением на ячейки. Но регулятор хочет трек за полгода, поэтому тот же поток параллельно уходит в буфер и оттуда в хранилище временных рядов, где он сжимается в десять раз.',
                en: 'A hundred thousand writes per second that expire in five seconds do not belong in a durable database — they need an in-memory cell structure. But the regulator wants half a year of tracks, so the same stream goes in parallel into a buffer and from there into a time-series store where it compresses tenfold.',
            },
            forRequirement: 'R3',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Разведите три пути. Пинги идут через лёгкий балансировщик в приёмник, оттуда в гео-индекс с точностью ячейки около трёх километров и в шину. Поиск идёт из матчинга в тот же индекс, ETA кэшируется на 45 секунд. Поездки живут в шардированном документном хранилище с оптимистичной блокировкой — иначе две заявки назначат одну машину.',
                en: 'Split three paths. Pings go through a light balancer into a collector, then into a geo index with a cell precision of about three kilometres and into a bus. Search goes from the matcher into the same index, ETA is cached for 45 seconds. Trips live in a sharded document store with optimistic locking — otherwise two requests assign the same car.',
            },
            forRequirement: 'R6',
        },
    ],
    referenceSolutions: [
        {
            id: 'geo-index-and-stream',
            name: { ru: 'Гео-индекс в памяти и трек за потоком', en: 'In-memory geo index and a streamed trail' },
            tradeoff: {
                ru: 'Горячее и холодное разъехались: позиции живут в ячеечном индексе, где запись стоит микросекунды, а поиск по радиусу не трогает диск; трек той же телеметрии уезжает через шину в сжатое хранилище временных рядов. Платите двумя копиями одних и тех же данных и тем, что индекс в памяти после перезапуска пуст ровно пять секунд — и всё это время поиск не находит никого.',
                en: 'Hot and cold went separate ways: positions live in a cell index where a write costs microseconds and a radius search never touches disk; the trail of the same telemetry goes over a bus into a compressed time-series store. You pay with two copies of the same data and with the fact that the in-memory index is empty for exactly five seconds after a restart — and search finds nobody the whole time.',
            },
            build: geoIndexAndStream,
        },
        {
            id: 'postgis-everything',
            name: { ru: 'Всё одним пространственным запросом', en: 'Everything in one spatial query' },
            tradeoff: {
                ru: 'Одна база с пространственным индексом и никаких лишних сущностей — ровно до того момента, как в неё начинают писать сто тысяч обновлений в секунду по тем же строкам, которые одновременно сканируются по радиусу. Индекс перестраивается быстрее, чем его успевают прочитать, а чтение с отстающей реплики предлагает пассажиру машину, которая уехала восемь секунд назад.',
                en: 'One database with a spatial index and no extra moving parts — right up to the moment a hundred thousand updates per second land on the same rows that are being radius-scanned. The index rebuilds faster than it can be read, and a lagging replica offers the rider a car that left eight seconds ago.',
            },
            build: postgisEverything,
        },
    ],
};
