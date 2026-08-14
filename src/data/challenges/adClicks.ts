import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const BROWSERS = 'browsers';
const ADVERTISERS = 'advertisers';

const browserParams = {
    dau: 60000000,
    sessionsPerUserDay: 8,
    requestsPerSession: 6,
    avgRequestKb: 0.5,
    avgResponseKb: 0.2,
    readWriteMix: 0.02,
    cacheableShare: 0,
    peakFactor: 2.5,
    diurnalPattern: 'global',
    geoDistribution: 'global',
};

const advertiserParams = {
    clients: 20000,
    rpsPerClient: 0.05,
    quotaPerDay: 5000000,
    burstiness: 3,
    authMode: 'jwt-local',
    peakFactor: 2,
    readWriteMix: 1,
    avgRequestKb: 1,
    avgResponseKb: 60,
    geoDistribution: 'global',
};

const beaconCalls = { requestBytes: 500, responseBytes: 200 };
const dashboardCalls = { requestBytes: 1000, responseBytes: 60000 };

const rollupParams = {
    nodes: 12,
    shards: 4,
    replicas: 3,
    rowsIngestedPerSec: 10000,
    rowSizeBytes: 120,
    insertBatchRows: 200000,
    asyncInserts: true,
    columnsTotal: 60,
    columnsScannedPerQuery: 2,
    scanThroughputMbsPerCore: 150,
    cpuCores: 32,
    storageGbPerNode: 90000,
    queryConcurrency: 60,
    materializedViews: 4,
    ttlDays: 400,
};

function starter(): SchemeV1 {
    return buildScheme({
        id: 'ad-clicks',
        name: 'Агрегация рекламных кликов',
        nodes: [
            { id: BROWSERS, type: 'client-web', params: browserParams, position: { x: 0, y: 120 } },
            { id: ADVERTISERS, type: 'client-api', params: advertiserParams, position: { x: 0, y: 520 } },
        ],
        links: [],
    });
}

function streamingRollups(): SchemeV1 {
    return buildScheme({
        id: 'ad-clicks-streaming',
        name: 'Потоковая агрегация в окнах и витрина в OLAP',
        nodes: [
            { id: BROWSERS, type: 'client-web', params: browserParams, position: { x: 0, y: 120 } },
            { id: ADVERTISERS, type: 'client-api', params: advertiserParams, position: { x: 0, y: 520 } },
            {
                id: 'beacon-lb',
                type: 'lb-l7',
                params: {
                    instances: 6,
                    azSpread: 3,
                    maxRpsPerInstance: 25000,
                    cpuCores: 8,
                    tlsTerminate: true,
                    compression: false,
                    latencyMs: 0.6,
                },
                position: { x: 280, y: 140 },
            },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 3,
                    azSpread: 3,
                    maxRpsPerInstance: 4000,
                    serviceTimeMs: 1.5,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 20,
                    payloadLimitMb: 1,
                    logLinesPerRequest: 1,
                },
                position: { x: 280, y: 520 },
            },
            {
                id: 'collector',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 1.2,
                    serviceTimeSigma: 0.4,
                    cpuShare: 0.05,
                    instances: 14,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 400,
                    logLinesPerRequest: 0,
                },
                position: { x: 560, y: 140 },
            },
            {
                id: 'events',
                type: 'kafka',
                params: {
                    brokers: 12,
                    partitions: 180,
                    replicationFactor: 3,
                    minInsync: 2,
                    messageSizeKb: 0.5,
                    batchMs: 25,
                    compression: 'zstd',
                    retentionHours: 72,
                    diskGbPerBroker: 12000,
                    throughputMbsPerBroker: 400,
                },
                position: { x: 840, y: 140 },
            },
            {
                id: 'aggregator',
                type: 'stream-processor',
                params: {
                    parallelism: 180,
                    partitions: 180,
                    recordsPerSecPerTask: 20000,
                    stateSizeGb: 900,
                    checkpointIntervalSec: 30,
                    windowType: 'tumbling',
                    exactlyOnce: true,
                    watermarkLagSec: 20,
                    instances: 12,
                    memoryGb: 96,
                },
                position: { x: 1120, y: 140 },
            },
            { id: 'rollups', type: 'clickhouse', params: rollupParams, position: { x: 1400, y: 60 } },
            {
                id: 'raw',
                type: 'lakehouse',
                params: {
                    rawGbPerDay: 1440,
                    format: 'parquet',
                    compression: 'zstd',
                    partitionScheme: 'hour',
                    lifecycleDays: 400,
                    bandwidthGbps: 80,
                    maxIngestMbs: 4000,
                    queryConcurrency: 40,
                },
                position: { x: 1400, y: 300 },
            },
            {
                id: 'dashboard',
                type: 'bff',
                params: {
                    instances: 4,
                    downstreamCalls: 2,
                    callMode: 'parallel',
                    aggregationMs: 6,
                    serviceTimeMs: 12,
                    downstreamCallMs: 60,
                    cpuShare: 0.15,
                    concurrencyPerInstance: 64,
                    timeoutMs: 4000,
                },
                position: { x: 560, y: 520 },
            },
            {
                id: 'report-cache',
                type: 'redis',
                params: {
                    shards: 3,
                    replicasPerShard: 2,
                    memoryGb: 32,
                    uniqueKeys: 20000,
                    valueSizeBytes: 60000,
                    ttlSec: 120,
                    zipfAlpha: 1.1,
                },
                position: { x: 900, y: 520 },
            },
        ],
        links: [
            { from: BROWSERS, to: 'beacon-lb', readShare: 0.02, calls: beaconCalls },
            { from: ADVERTISERS, to: 'gateway', readShare: 1, calls: dashboardCalls },
            { from: 'beacon-lb', to: 'collector', readShare: 0.02, calls: beaconCalls },
            { from: 'gateway', to: 'dashboard', readShare: 1, calls: dashboardCalls },
            { from: 'collector', to: 'events', calls: { fanout: 1, requestBytes: 500, responseBytes: 0 } },
            {
                from: 'events',
                to: 'aggregator',
                policy: { timeoutMs: 30000, retries: 2, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'aggregator',
                to: 'rollups',
                readShare: 0,
                calls: { fanout: 0.0005, requestBytes: 6000000, responseBytes: 200 },
                policy: { timeoutMs: 20000, retries: 2, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'aggregator',
                to: 'raw',
                readShare: 0,
                calls: { fanout: 0.001, requestBytes: 500000, responseBytes: 200 },
                policy: { timeoutMs: 20000, retries: 2, circuitBreaker: true, idempotent: true },
            },
            { from: 'dashboard', to: 'report-cache', readShare: 1 },
            {
                from: 'dashboard',
                to: 'rollups',
                readShare: 1,
                calls: { requestBytes: 2000, responseBytes: 60000 },
                policy: { timeoutMs: 4000, retries: 1, circuitBreaker: true, idempotent: true },
            },
        ],
    });
}

function directToOlap(): SchemeV1 {
    return buildScheme({
        id: 'ad-clicks-direct',
        name: 'Каждое событие пишется в OLAP напрямую',
        nodes: [
            { id: BROWSERS, type: 'client-web', params: browserParams, position: { x: 0, y: 120 } },
            { id: ADVERTISERS, type: 'client-api', params: advertiserParams, position: { x: 0, y: 520 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 8,
                    azSpread: 3,
                    maxRpsPerInstance: 9000,
                    serviceTimeMs: 1.5,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 400,
                    payloadLimitMb: 1,
                    logLinesPerRequest: 0,
                },
                position: { x: 280, y: 300 },
            },
            {
                id: 'collector',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 1.2,
                    serviceTimeSigma: 0.4,
                    cpuShare: 0.05,
                    instances: 14,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 400,
                    logLinesPerRequest: 0,
                },
                position: { x: 560, y: 140 },
            },
            {
                id: 'rollups',
                type: 'clickhouse',
                params: {
                    nodes: 12,
                    shards: 4,
                    replicas: 3,
                    rowsIngestedPerSec: 2000000,
                    rowSizeBytes: 120,
                    insertBatchRows: 10000,
                    asyncInserts: false,
                    columnsTotal: 60,
                    columnsScannedPerQuery: 40,
                    scanThroughputMbsPerCore: 150,
                    cpuCores: 32,
                    storageGbPerNode: 90000,
                    queryConcurrency: 12,
                    materializedViews: 0,
                    ttlDays: 400,
                },
                position: { x: 900, y: 300 },
            },
        ],
        links: [
            { from: BROWSERS, to: 'gateway', readShare: 0.02, calls: beaconCalls },
            { from: ADVERTISERS, to: 'gateway', readShare: 1, calls: dashboardCalls },
            { from: 'gateway', to: 'collector', readShare: 0.05, calls: beaconCalls },
            { from: 'collector', to: 'rollups', readShare: 0.05 },
        ],
    });
}

export const adClicks: Challenge = {
    id: 'ad-clicks',
    level: 4,
    estimatedMinutes: 60,
    tags: ['analytics', 'streaming', 'olap', 'windows', 'cost'],
    title: { ru: 'Агрегация рекламных кликов', en: 'Ad click aggregation' },
    brief: {
        ru: 'Рекламная сеть собирает показы и клики: 33 000 событий в секунду по 500 байт, 2.9 млрд событий в сутки, 1.4 ТБ сырых данных ежедневно. Двадцать тысяч рекламодателей смотрят на дашборды и хотят видеть открутку бюджета «почти сейчас», а раз в квартал приходит аудит и требует пересчитать те же цифры по сырым логам за год. Два счётчика на одно событие: быстрый приблизительный и медленный точный. Дубли обязаны схлопываться — за один клик рекламодатель платит один раз.',
        en: 'An ad network collects impressions and clicks: 33,000 events per second at 500 bytes each, 2.9 billion events a day, 1.4 TB of raw data daily. Twenty thousand advertisers stare at dashboards and want to see budget burn "almost now", and once a quarter an audit demands the same numbers recomputed from a year of raw logs. Two counters per event: a fast approximate one and a slow exact one. Duplicates must collapse — an advertiser pays once per click.',
    },
    given: {
        dau: browserParams.dau,
        requestsPerUserDay: browserParams.sessionsPerUserDay * browserParams.requestsPerSession,
        eventsPerSec: 33333,
        eventBytes: 500,
        rawGbDay: 1440,
        advertisers: advertiserParams.clients,
        dashboardRps: 1000,
        rollupWindowSec: 60,
        auditHorizonYears: 1,
        peakFactor: browserParams.peakFactor,
    },
    flows: [
        { id: BROWSERS, name: { ru: 'Событие показа и клика', en: 'Impression and click event' }, weightInScore: 0.55 },
        { id: ADVERTISERS, name: { ru: 'Дашборд рекламодателя', en: 'Advertiser dashboard' }, weightInScore: 0.45 },
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
                ru: 'Событие доезжает до аналитического хранилища через буфер, а не синхронной записью',
                en: 'The event reaches analytical storage through a buffer, not a synchronous write',
            },
            flow: BROWSERS,
            to: { group: 'olap' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'stream-processor' },
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Дашборд читает витрину, а не сырой поток событий',
                en: 'The dashboard reads a rollup store, not the raw event stream',
            },
            flow: ADVERTISERS,
            to: { group: 'olap' },
            notVia: [{ group: 'messaging' }],
        },
        {
            id: 'R3',
            kind: 'anomaly',
            desc: {
                ru: 'Повторная доставка события не превращается в второй клик в отчёте',
                en: 'A redelivered event never becomes a second click in the report',
            },
            code: 'duplicate-processing',
            maxRatePerSec: 0,
        },
        {
            id: 'R4',
            kind: 'slo',
            desc: { ru: 'p99 записи события не выше 120 мс', en: 'p99 of writing an event stays under 120 ms' },
            flow: BROWSERS,
            metric: 'latency.p99',
            max: 120,
        },
        {
            id: 'R5',
            kind: 'slo',
            desc: { ru: 'p99 дашборда не выше 900 мс', en: 'Dashboard p99 stays under 900 ms' },
            flow: ADVERTISERS,
            metric: 'latency.p99',
            max: 900,
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
                ru: 'Отставание конвейера агрегации не больше 60 секунд',
                en: 'The aggregation pipeline lags by no more than 60 seconds',
            },
            maxLagSec: 60,
        },
        {
            id: 'R8',
            kind: 'storage',
            desc: {
                ru: 'Объявленной ёмкости хватает на год сырых данных с запасом 20%',
                en: 'Declared capacity covers a year of raw data with 20% headroom',
            },
            horizonYears: 1,
            headroom: 1.2,
        },
        {
            id: 'R9',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $400 000 в месяц', en: 'Monthly cost stays under $400,000' },
            maxMonthlyCostUsd: 400000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианный дашборд укладывается в 300 мс', en: 'Median dashboard stays under 300 ms' },
            flow: ADVERTISERS,
            metric: 'latency.p50',
            max: 300,
        },
        {
            id: 'B2',
            kind: 'capacity',
            desc: {
                ru: 'Даже самый горячий блок не выходит за половину своей ёмкости',
                en: 'Even the hottest block stays within half its capacity',
            },
            maxUtilization: 0.5,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.4, latencyFactor: 1.5 },
        'cache-flush': { utilizationFactor: 1.3, latencyFactor: 2.5 },
        'az-failure': { utilizationFactor: 1.4, latencyFactor: 2 },
    },
    lockedParams: { [BROWSERS]: browserParams, [ADVERTISERS]: advertiserParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько строк в секунду придётся вставить в аналитическую базу, если писать каждое событие отдельной вставкой — и во сколько раз это отличается от того, что колоночная база любит?',
                en: 'How many rows per second must be inserted into the analytical store if every event is its own insert — and how far is that from what a columnar store actually likes?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Колоночная база живёт большими пачками: 200 000 строк за вставку вместо одной. Кто-то должен эти пачки собирать, дедуплицировать и считать окна — и этот кто-то стоит между приёмником событий и витриной. Заодно решается вопрос «а где взять сырые данные для квартального аудита»: они уезжают тем же конвейером в дешёвое колоночное хранилище.',
                en: 'A columnar store lives on big batches: 200,000 rows per insert instead of one. Somebody has to assemble those batches, deduplicate them and compute the windows — and that somebody sits between the event collector and the rollup store. It also answers "where do the raw rows for the quarterly audit come from": the same pipeline drops them into cheap columnar storage.',
            },
            forRequirement: 'R6',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Приёмник только пишет в лог событий и отвечает 200 байтами. Дальше поток разбирает потоковый обработчик с exactly-once и окнами: в витрину едут агрегаты (одна вставка на тысячи событий), в озеро — сырые записи для аудита. Дашборд ходит в витрину через кэш с коротким TTL: двадцать тысяч рекламодателей смотрят на одни и те же топ-кампании.',
                en: 'The collector only writes to the event log and answers with 200 bytes. Downstream a stream processor with exactly-once semantics and windows takes over: aggregates go to the rollup store (one insert per thousands of events), raw records go to the lake for the audit. The dashboard reads the rollup store through a short-TTL cache: twenty thousand advertisers stare at the same top campaigns.',
            },
            forRequirement: 'R1',
        },
    ],
    referenceSolutions: [
        {
            id: 'streaming-rollups',
            name: { ru: 'Поток, окна и витрина', en: 'Stream, windows and a rollup store' },
            tradeoff: {
                ru: 'Два счётчика, как и просили: агрегаты в колоночной витрине обновляются за десятки секунд, сырые события лежат в озере для квартального аудита. Платите за это тем, что цифра на дашборде и цифра в аудите совпадают не всегда и не сразу, и вам придётся объяснять это рекламодателю.',
                en: 'Two counters, exactly as asked: aggregates in the columnar rollup store refresh in tens of seconds, raw events sit in the lake for the quarterly audit. The price is that the dashboard number and the audit number do not always match right away, and you will have to explain that to the advertiser.',
            },
            build: streamingRollups,
        },
        {
            id: 'direct-to-olap',
            name: { ru: 'Прямая запись в колоночную базу', en: 'Straight into the columnar store' },
            tradeoff: {
                ru: 'Три блока вместо восьми и никакого конвейера: приёмник вставляет строку, дашборд читает ту же таблицу. И то и другое разваливается на одних и тех же 33 000 вставок в секунду — колоночная база не для этого, а дашборд без витрины сканирует все колонки подряд.',
                en: 'Three blocks instead of eight and no pipeline at all: the collector inserts a row, the dashboard reads the same table. Both fall apart on the very same 33,000 inserts per second — a columnar store is not built for that, and a dashboard without rollups scans every column there is.',
            },
            build: directToOlap,
        },
    ],
};
