import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const PLAYERS = 'players';
const SPECTATORS = 'spectators';

const playerParams = {
    dau: 25000000,
    sessionsPerUserDay: 4,
    requestsPerSession: 25,
    avgRequestKb: 0.6,
    avgResponseKb: 4,
    readWriteMix: 0.85,
    cacheableShare: 0.7,
    peakFactor: 3,
    diurnalPattern: 'evening',
    geoDistribution: 'global',
    networkRttMs: 60,
};

const spectatorParams = {
    dau: 4000000,
    sessionsPerUserDay: 2,
    requestsPerSession: 30,
    avgRequestKb: 0.4,
    avgResponseKb: 6,
    readWriteMix: 1,
    cacheableShare: 0.9,
    peakFactor: 3,
    diurnalPattern: 'evening',
    geoDistribution: 'global',
};

const playerCalls = { requestBytes: 600, responseBytes: 4000 };
const spectatorCalls = { requestBytes: 400, responseBytes: 6000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'leaderboard',
        name: 'Лидерборд реального времени',
        nodes: [
            { id: PLAYERS, type: 'client-mobile', params: playerParams, position: { x: 0, y: 160 } },
            { id: SPECTATORS, type: 'client-web', params: spectatorParams, position: { x: 0, y: 520 } },
        ],
        links: [],
    });
}

function sortedSetAndStream(): SchemeV1 {
    return buildScheme({
        id: 'leaderboard-sorted-set',
        name: 'Шардированные sorted set и потоковый пересчёт топа',
        nodes: [
            { id: PLAYERS, type: 'client-mobile', params: playerParams, position: { x: 0, y: 160 } },
            { id: SPECTATORS, type: 'client-web', params: spectatorParams, position: { x: 0, y: 520 } },
            {
                id: 'edge',
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
                position: { x: 280, y: 160 },
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
                    rateLimitRpsPerClient: 30,
                    payloadLimitMb: 1,
                    logLinesPerRequest: 1,
                },
                position: { x: 280, y: 520 },
            },
            {
                id: 'live',
                type: 'ws-gateway',
                params: {
                    instances: 12,
                    azSpread: 3,
                    concurrentConnections: 1400000,
                    connectionsPerInstance: 140000,
                    memoryPerConnKb: 90,
                    memoryGb: 24,
                    messagesPerConnMin: 20,
                    messageBytes: 600,
                    fanoutMode: 'pub-sub',
                    serviceTimeMs: 0.3,
                    networkMbps: 20000,
                },
                position: { x: 440, y: 700 },
            },
            {
                id: 'score-api',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 4,
                    serviceTimeSigma: 0.4,
                    cpuShare: 0.05,
                    instances: 16,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 400,
                    queueLimit: 4000,
                    logLinesPerRequest: 0,
                },
                position: { x: 600, y: 340 },
            },
            {
                id: 'top',
                type: 'redis',
                params: {
                    shards: 8,
                    replicasPerShard: 2,
                    memoryGb: 16,
                    uniqueKeys: 400000,
                    keySizeBytes: 48,
                    valueSizeBytes: 12000,
                    ttlSec: 30,
                    zipfAlpha: 1.3,
                    hotKeyShare: 0.25,
                    evictionPolicy: 'lru',
                    persistence: 'none',
                    concurrencyControl: 'optimistic',
                },
                position: { x: 920, y: 200 },
            },
            {
                id: 'scores',
                type: 'redis-store',
                params: {
                    shards: 16,
                    replicasPerShard: 2,
                    memoryGb: 48,
                    uniqueKeys: 900000000,
                    keySizeBytes: 32,
                    valueSizeBytes: 120,
                    maxOpsPerSec: 140000,
                    hotKeyShare: 0.05,
                    persistence: 'aof',
                    concurrencyControl: 'optimistic',
                },
                position: { x: 920, y: 400 },
            },
            {
                id: 'events',
                type: 'kafka',
                params: {
                    brokers: 9,
                    partitions: 120,
                    replicationFactor: 3,
                    minInsync: 2,
                    messageSizeKb: 0.4,
                    batchMs: 20,
                    compression: 'lz4',
                    retentionHours: 48,
                    throughputMbsPerBroker: 300,
                },
                position: { x: 920, y: 620 },
            },
            {
                id: 'roller',
                type: 'stream-processor',
                params: {
                    parallelism: 120,
                    partitions: 120,
                    recordsPerSecPerTask: 20000,
                    stateSizeGb: 400,
                    checkpointIntervalSec: 15,
                    windowType: 'sliding',
                    exactlyOnce: true,
                    watermarkLagSec: 5,
                    instances: 6,
                    memoryGb: 64,
                },
                position: { x: 1240, y: 620 },
            },
            {
                id: 'history',
                type: 'scylla',
                params: {
                    nodes: 9,
                    replicationFactor: 3,
                    partitionKey: 'seasonId',
                    rowCount: 400000000000,
                    rowSizeBytes: 120,
                    storageGbPerNode: 8000,
                    maxOpsPerSecPerNode: 40000,
                    hintedHandoff: true,
                    concurrencyControl: 'optimistic',
                    conflictResolution: 'single-writer-per-key',
                },
                position: { x: 1560, y: 620 },
            },
        ],
        links: [
            { from: PLAYERS, to: 'edge', readShare: 0.85, calls: playerCalls },
            { from: SPECTATORS, to: 'gateway', readShare: 1, calls: spectatorCalls },
            { from: 'edge', to: 'score-api', readShare: 0.85, calls: playerCalls },
            { from: 'gateway', to: 'live', readShare: 1, calls: spectatorCalls },
            { from: 'live', to: 'score-api', readShare: 1, calls: spectatorCalls },
            {
                from: 'score-api',
                to: 'top',
                readShare: 1,
                policy: { timeoutMs: 200, retries: 1, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'score-api',
                to: 'scores',
                readShare: 0.7,
                calls: { fanout: 0.3 },
                policy: { timeoutMs: 200, retries: 1, circuitBreaker: true, idempotent: true },
            },
            { from: 'score-api', to: 'events', calls: { fanout: 0.15, requestBytes: 400, responseBytes: 0 } },
            {
                from: 'events',
                to: 'roller',
                policy: { timeoutMs: 20000, retries: 2, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'roller',
                to: 'top',
                readShare: 0,
                calls: { fanout: 0.02, requestBytes: 12000, responseBytes: 200 },
                policy: { timeoutMs: 2000, retries: 2, circuitBreaker: true, idempotent: true },
            },
            {
                from: 'roller',
                to: 'history',
                readShare: 0,
                calls: { fanout: 0.1, requestBytes: 1200, responseBytes: 200 },
                policy: { timeoutMs: 4000, retries: 2, circuitBreaker: true, idempotent: true },
            },
        ],
    });
}

function rankInSql(): SchemeV1 {
    return buildScheme({
        id: 'leaderboard-sql',
        name: 'Рейтинг считается запросом ORDER BY',
        nodes: [
            { id: PLAYERS, type: 'client-mobile', params: playerParams, position: { x: 0, y: 160 } },
            { id: SPECTATORS, type: 'client-web', params: spectatorParams, position: { x: 0, y: 520 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: {
                    instances: 6,
                    azSpread: 3,
                    maxRpsPerInstance: 12000,
                    serviceTimeMs: 1.5,
                    authMode: 'jwt-local',
                    rateLimitRpsPerClient: 30,
                    payloadLimitMb: 1,
                    logLinesPerRequest: 1,
                },
                position: { x: 280, y: 340 },
            },
            {
                id: 'score-api',
                type: 'service',
                params: {
                    runtime: 'go',
                    serviceTimeMs: 4,
                    serviceTimeSigma: 0.4,
                    cpuShare: 0.05,
                    instances: 16,
                    autoscale: false,
                    azSpread: 3,
                    concurrencyPerInstance: 400,
                    queueLimit: 4000,
                    logLinesPerRequest: 0,
                },
                position: { x: 600, y: 340 },
            },
            {
                id: 'scores',
                type: 'postgres',
                params: {
                    readReplicas: 3,
                    readFromReplica: 0.9,
                    replicaLagMs: 600,
                    maxConnections: 900,
                    cpuCores: 64,
                    provisionedIops: 80000,
                    rowCount: 900000000,
                    rowSizeBytes: 120,
                    storageGb: 4000,
                    queryProfile: 'aggregate',
                    workingSetGb: 200,
                    bufferPoolGb: 64,
                    concurrencyControl: 'none',
                },
                position: { x: 920, y: 340 },
            },
        ],
        links: [
            { from: PLAYERS, to: 'gateway', readShare: 0.85, calls: playerCalls },
            { from: SPECTATORS, to: 'gateway', readShare: 1, calls: spectatorCalls },
            { from: 'gateway', to: 'score-api', readShare: 0.87, calls: playerCalls },
            { from: 'score-api', to: 'scores', readShare: 0.87 },
        ],
    });
}

export const leaderboard: Challenge = {
    id: 'leaderboard',
    level: 4,
    estimatedMinutes: 60,
    tags: ['ranking', 'hot-key', 'streaming', 'websocket', 'approximation'],
    title: { ru: 'Лидерборд реального времени', en: 'Real-time leaderboard' },
    brief: {
        ru: 'Мобильная игра на 25 миллионов игроков в сутки: 29 000 запросов в секунду, каждый седьмой — новый результат матча. Плюс четыре миллиона зрителей турнира, которые держат открытым веб-сокет и ждут, что таблица обновится сама. Игрок хочет видеть свою позицию среди 900 миллионов записей и топ-100 сезона. Топ-100 — это один ключ, в который смотрят все сразу; позиция игрока — это 900 миллионов разных ключей. Это две совершенно разные задачи, и решать их одним запросом ORDER BY не выйдет.',
        en: 'A mobile game with 25 million daily players: 29,000 requests per second, every seventh one a fresh match result. Plus four million tournament spectators holding a web socket open and expecting the table to refresh by itself. A player wants their rank among 900 million records and the season top 100. The top 100 is a single key everybody stares at; a player rank is 900 million different keys. These are two completely different problems, and one ORDER BY will not solve both.',
    },
    given: {
        dau: playerParams.dau,
        requestsPerUserDay: playerParams.sessionsPerUserDay * playerParams.requestsPerSession,
        avgRps: 28935,
        spectatorConnections: 1400000,
        rankedPlayers: 900000000,
        writeShare: 0.15,
        topSize: 100,
        peakFactor: playerParams.peakFactor,
        clientRttMs: playerParams.networkRttMs,
    },
    flows: [
        { id: PLAYERS, name: { ru: 'Результат и позиция игрока', en: 'Player result and rank' }, weightInScore: 0.65 },
        { id: SPECTATORS, name: { ru: 'Трансляция таблицы', en: 'Live table broadcast' }, weightInScore: 0.35 },
    ],
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
                ru: 'Результат матча доезжает до долговечного хранилища результатов',
                en: 'A match result reaches a durable score store',
            },
            flow: PLAYERS,
            to: { group: 'nosql' },
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Зритель получает таблицу из кэша, а не пересчётом на каждое соединение',
                en: 'A spectator gets the table from a cache, not from a recount per connection',
            },
            flow: SPECTATORS,
            to: { group: 'cache' },
        },
        {
            id: 'R3',
            kind: 'anomaly',
            desc: {
                ru: 'Одновременные результаты одного игрока не затирают друг друга',
                en: 'Concurrent results from the same player never overwrite each other',
            },
            code: 'lost-update',
            maxRatePerSec: 0,
        },
        {
            id: 'R4',
            kind: 'anomaly',
            desc: {
                ru: 'Повторная доставка события не удваивает очки в таблице',
                en: 'A redelivered event never doubles the points in the table',
            },
            code: 'duplicate-processing',
            maxRatePerSec: 0,
        },
        {
            id: 'R5',
            kind: 'slo',
            desc: { ru: 'p99 запроса игрока не выше 160 мс', en: 'p99 of a player request stays under 160 ms' },
            flow: PLAYERS,
            metric: 'latency.p99',
            max: 160,
        },
        {
            id: 'R6',
            kind: 'slo',
            desc: { ru: 'p99 обновления у зрителя не выше 200 мс', en: 'p99 of a spectator update stays under 200 ms' },
            flow: SPECTATORS,
            metric: 'latency.p99',
            max: 200,
        },
        {
            id: 'R7',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 70%', en: 'No block runs hotter than 70%' },
            maxUtilization: 0.7,
        },
        {
            id: 'R8',
            kind: 'freshness',
            desc: {
                ru: 'Пересчёт топа отстаёт не больше чем на 5 секунд',
                en: 'The top recount lags by no more than 5 seconds',
            },
            maxLagSec: 5,
        },
        {
            id: 'R9',
            kind: 'redundancy',
            desc: {
                ru: 'На пути игрока нет ни одного блока в единственном экземпляре',
                en: 'No block on the player path runs as a single copy',
            },
            flow: PLAYERS,
            minRedundancy: 3,
        },
        {
            id: 'R10',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $120 000 в месяц', en: 'Monthly cost stays under $120,000' },
            maxMonthlyCostUsd: 120000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианный запрос игрока укладывается в 90 мс', en: 'Median player request stays under 90 ms' },
            flow: PLAYERS,
            metric: 'latency.p50',
            max: 90,
        },
        {
            id: 'B2',
            kind: 'anomaly',
            desc: {
                ru: 'Устаревших чтений таблицы не больше 2%',
                en: 'No more than 2% of table reads are stale',
            },
            code: 'stale-read',
            maxSharePercent: 2,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.35, latencyFactor: 1.5 },
        'cache-flush': { utilizationFactor: 1.35, latencyFactor: 2.5 },
        'az-failure': { utilizationFactor: 1.4, latencyFactor: 2 },
    },
    lockedParams: { [PLAYERS]: playerParams, [SPECTATORS]: spectatorParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько запросов в секунду приходится на ключ «топ-100 сезона» и сколько — на средний ключ «позиция игрока»? Это одно хранилище или два?',
                en: 'How many requests per second land on the "season top 100" key, and how many on an average "player rank" key? Is that one store or two?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Точная позиция среди 900 миллионов на каждый запрос не нужна никому — нужен топ и приблизительный ранг. Топ пересчитывайте потоково по окну и кладите готовым в кэш с коротким TTL, а результаты матчей пишите в шардированное хранилище с CAS. Тогда самый горячий ключ читается из кэша, а не строится запросом.',
                en: 'Nobody actually needs an exact rank among 900 million on every request — they need the top and an approximate rank. Recompute the top in a windowed stream and put it ready-made into a short-TTL cache, and write match results into a sharded store with CAS. Then the hottest key is read from a cache instead of being built by a query.',
            },
            forRequirement: 'R7',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Три хранилища с разными свойствами: кэш топа (TTL 30 секунд, доля горячего ключа около четверти), шардированный key-value для очков игроков с оптимистичной блокировкой, широкое колоночное хранилище для истории сезонов. Зрителей держите на веб-сокет-шлюзе — четыре миллиона соединений это про память на соединение, а не про запросы в секунду.',
                en: 'Three stores with different properties: a top cache (30-second TTL, roughly a quarter of traffic on the hot key), a sharded key-value store for player scores with optimistic locking, and a wide-column store for season history. Keep spectators on a web-socket gateway — four million connections is about memory per connection, not about requests per second.',
            },
            forRequirement: 'R2',
        },
    ],
    referenceSolutions: [
        {
            id: 'sorted-set-and-stream',
            name: { ru: 'Sorted set и потоковый пересчёт', en: 'Sorted sets and a streaming recount' },
            tradeoff: {
                ru: 'Горячий ключ и холодные ключи разъехались по разным хранилищам: топ живёт в кэше и обновляется потоковым обработчиком, очки игроков — в шардированном key-value с CAS, история сезонов — в широкой колоночной базе. Платите приблизительностью: между матчем и его появлением в топе проходят секунды, и объяснять это игроку придётся вам.',
                en: 'The hot key and the cold keys moved into different stores: the top lives in a cache refreshed by a stream processor, player scores sit in a sharded key-value store with CAS, season history goes to a wide-column store. You pay in approximation: seconds pass between a match and its appearance in the top, and you are the one who explains that to the player.',
            },
            build: sortedSetAndStream,
        },
        {
            id: 'rank-in-sql',
            name: { ru: 'Рейтинг запросом ORDER BY', en: 'Ranking by ORDER BY' },
            tradeoff: {
                ru: 'Одна таблица, один индекс, одна строка SQL — и ровно она превращает каждый просмотр таблицы в агрегат по 900 миллионам строк. Дёшево по числу блоков, разорительно по процессорам, а чтение с отстающей реплики показывает игроку позицию до его собственного матча.',
                en: 'One table, one index, one line of SQL — and that line turns every table view into an aggregate over 900 million rows. Cheap in blocks, ruinous in CPUs, and reading from a lagging replica shows the player a rank from before their own match.',
            },
            build: rankInSql,
        },
    ],
};
