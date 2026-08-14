import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const VIEWERS = 'viewers';
const CREATORS = 'creators';

const viewerParams = {
    dau: 100000000,
    sessionsPerUserDay: 5,
    requestsPerSession: 4,
    avgRequestKb: 1,
    avgResponseKb: 67500,
    readWriteMix: 0.99,
    cacheableShare: 0.95,
    peakFactor: 1.6,
    diurnalPattern: 'global',
    geoDistribution: 'global',
};

const creatorParams = {
    dau: 50000,
    sessionsPerUserDay: 1,
    requestsPerSession: 150,
    avgRequestKb: 10240,
    avgResponseKb: 2,
    readWriteMix: 0.02,
    cacheableShare: 0,
    peakFactor: 1.6,
    diurnalPattern: 'global',
    geoDistribution: 'global',
};

const segmentCalls = { requestBytes: 1000, responseBytes: 67500000 };
const metadataCalls = { requestBytes: 2000, responseBytes: 25000 };
const uploadCalls = { requestBytes: 10240000, responseBytes: 2000 };
const originalCalls = { requestBytes: 10240000, responseBytes: 200000 };
const sourceReadCalls = { requestBytes: 1000, responseBytes: 10240000 };
const renditionWriteCalls = { fanout: 2, requestBytes: 67500000, responseBytes: 200 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'video-hosting',
        name: 'Видеохостинг',
        nodes: [
            { id: VIEWERS, type: 'client-web', params: viewerParams, position: { x: 0, y: 120 } },
            { id: CREATORS, type: 'client-web', params: creatorParams, position: { x: 0, y: 560 } },
        ],
        links: [],
    });
}

function cdnAndQueue(): SchemeV1 {
    return buildScheme({
        id: 'video-hosting-cdn',
        name: 'Два CDN, объектное хранилище и очередь транскодинга',
        nodes: [
            { id: VIEWERS, type: 'client-web', params: viewerParams, position: { x: 0, y: 120 } },
            { id: CREATORS, type: 'client-web', params: creatorParams, position: { x: 0, y: 560 } },
            {
                id: 'cdn-primary',
                type: 'cdn',
                params: {
                    popCount: 1000,
                    avgObjectKb: 67500,
                    maxObjectSizeMb: 128,
                    ttlSec: 86400,
                    originShield: true,
                    costPerGbEgress: 0.02,
                },
                position: { x: 300, y: 0 },
            },
            {
                id: 'cdn-secondary',
                type: 'cdn',
                params: {
                    popCount: 1000,
                    avgObjectKb: 67500,
                    maxObjectSizeMb: 128,
                    ttlSec: 86400,
                    originShield: true,
                    costPerGbEgress: 0.02,
                },
                position: { x: 300, y: 180 },
            },
            {
                id: 'renditions',
                type: 's3',
                params: {
                    avgObjectSizeMb: 67.5,
                    prefixCount: 5000,
                    objectCount: 600000000,
                    lifecycleDays: 0,
                    throughputPerPrefixMbs: 400,
                },
                position: { x: 640, y: 90 },
            },
            { id: 'watch-lb', type: 'lb-l7', params: { instances: 4, cpuCores: 8 }, position: { x: 300, y: 360 } },
            {
                id: 'meta-api',
                type: 'service',
                params: { serviceTimeMs: 18, autoscaleMax: 80, instances: 6 },
                position: { x: 640, y: 360 },
            },
            {
                id: 'meta-cache',
                type: 'redis',
                params: { shards: 12, memoryGb: 64, replicasPerShard: 2, uniqueKeys: 400000000, ttlSec: 600 },
                position: { x: 980, y: 300 },
            },
            {
                id: 'meta-db',
                type: 'postgres',
                params: {
                    readReplicas: 4,
                    readFromReplica: 0.7,
                    replicationMode: 'sync',
                    provisionedIops: 40000,
                    rowCount: 5000000000,
                    storageGb: 40000,
                },
                position: { x: 980, y: 460 },
            },
            {
                id: 'upload-gw',
                type: 'api-gateway',
                params: { instances: 2, payloadLimitMb: 32, rateLimitRpsPerClient: 20 },
                position: { x: 300, y: 560 },
            },
            {
                id: 'upload-api',
                type: 'service',
                params: { serviceTimeMs: 40, networkMbps: 10000, instances: 2, autoscaleMax: 40 },
                position: { x: 640, y: 560 },
            },
            {
                id: 'originals',
                type: 's3',
                params: {
                    avgObjectSizeMb: 10.24,
                    prefixCount: 200,
                    objectCount: 2500000000,
                    storageClass: 'infrequent-access',
                    costPerGbMonth: 0.0125,
                    lifecycleDays: 0,
                },
                position: { x: 980, y: 620 },
            },
            {
                id: 'jobs',
                type: 'kafka',
                params: { partitions: 48, messageSizeKb: 2, retentionHours: 168 },
                position: { x: 640, y: 780 },
            },
            {
                id: 'transcoder',
                type: 'worker',
                params: {
                    instances: 250,
                    concurrency: 20,
                    cpuCores: 16,
                    cpuShare: 1,
                    processingTimeMs: 600000,
                    costPerInstanceHour: 0.68,
                },
                position: { x: 980, y: 780 },
            },
        ],
        links: [
            { from: VIEWERS, to: 'cdn-primary', weight: 3, readShare: 1, calls: segmentCalls },
            { from: VIEWERS, to: 'cdn-secondary', weight: 3, readShare: 1, calls: segmentCalls },
            { from: VIEWERS, to: 'watch-lb', weight: 2, readShare: 0.96, calls: metadataCalls },
            { from: 'cdn-primary', to: 'renditions', readShare: 1, calls: segmentCalls },
            { from: 'cdn-secondary', to: 'renditions', readShare: 1, calls: segmentCalls },
            { from: 'watch-lb', to: 'meta-api', readShare: 0.96, calls: metadataCalls },
            { from: 'meta-api', to: 'meta-cache', readShare: 0.96 },
            { from: 'meta-api', to: 'meta-db', readShare: 0.96 },
            { from: CREATORS, to: 'upload-gw', readShare: 0.02, calls: uploadCalls },
            { from: 'upload-gw', to: 'upload-api', readShare: 0.02, calls: uploadCalls },
            { from: 'upload-api', to: 'originals', readShare: 0.02, calls: originalCalls },
            { from: 'upload-api', to: 'meta-db', readShare: 0, calls: { fanout: 0.0067 } },
            { from: 'upload-api', to: 'jobs', calls: { fanout: 0.0333 } },
            { from: 'jobs', to: 'transcoder' },
            { from: 'transcoder', to: 'originals', readShare: 1, calls: sourceReadCalls },
            { from: 'transcoder', to: 'renditions', readShare: 0, calls: renditionWriteCalls },
        ],
    });
}

function singleCdnAndMinio(): SchemeV1 {
    return buildScheme({
        id: 'video-hosting-minio',
        name: 'Один дешёвый CDN и собственное хранилище',
        nodes: [
            { id: VIEWERS, type: 'client-web', params: viewerParams, position: { x: 0, y: 120 } },
            { id: CREATORS, type: 'client-web', params: creatorParams, position: { x: 0, y: 560 } },
            {
                id: 'cdn-budget',
                type: 'cdn',
                params: {
                    popCount: 1000,
                    avgObjectKb: 67500,
                    maxObjectSizeMb: 128,
                    ttlSec: 86400,
                    originShield: true,
                    costPerGbEgress: 0.012,
                    costPerMillionRequests: 0.5,
                },
                position: { x: 300, y: 90 },
            },
            {
                id: 'renditions',
                type: 'minio',
                params: {
                    nodes: 32,
                    usableTb: 95000,
                    avgObjectSizeMb: 67.5,
                    objectCount: 600000000,
                    throughputGbps: 400,
                    maxOpsPerSecPerNode: 20000,
                },
                position: { x: 640, y: 90 },
            },
            { id: 'watch-lb', type: 'lb-l7', params: { instances: 4, cpuCores: 8 }, position: { x: 300, y: 360 } },
            {
                id: 'meta-api',
                type: 'service',
                params: { serviceTimeMs: 18, autoscaleMax: 80, instances: 6 },
                position: { x: 640, y: 360 },
            },
            {
                id: 'meta-cache',
                type: 'redis',
                params: { shards: 12, memoryGb: 64, replicasPerShard: 2, uniqueKeys: 400000000, ttlSec: 600 },
                position: { x: 980, y: 300 },
            },
            {
                id: 'meta-db',
                type: 'postgres',
                params: {
                    readReplicas: 4,
                    readFromReplica: 0.7,
                    replicationMode: 'sync',
                    provisionedIops: 40000,
                    rowCount: 5000000000,
                    storageGb: 40000,
                },
                position: { x: 980, y: 460 },
            },
            {
                id: 'upload-gw',
                type: 'api-gateway',
                params: { instances: 2, payloadLimitMb: 32, rateLimitRpsPerClient: 20 },
                position: { x: 300, y: 560 },
            },
            {
                id: 'upload-api',
                type: 'service',
                params: { serviceTimeMs: 40, networkMbps: 10000, instances: 2, autoscaleMax: 40 },
                position: { x: 640, y: 560 },
            },
            {
                id: 'originals',
                type: 'minio',
                params: {
                    nodes: 24,
                    usableTb: 55000,
                    avgObjectSizeMb: 10.24,
                    objectCount: 2500000000,
                    throughputGbps: 100,
                    costPerTbMonth: 9,
                },
                position: { x: 980, y: 620 },
            },
            {
                id: 'jobs',
                type: 'kafka',
                params: { partitions: 48, messageSizeKb: 2, retentionHours: 168 },
                position: { x: 640, y: 780 },
            },
            {
                id: 'transcoder',
                type: 'worker',
                params: {
                    instances: 250,
                    concurrency: 20,
                    cpuCores: 16,
                    cpuShare: 1,
                    processingTimeMs: 600000,
                    costPerInstanceHour: 0.68,
                },
                position: { x: 980, y: 780 },
            },
        ],
        links: [
            { from: VIEWERS, to: 'cdn-budget', weight: 3, readShare: 1, calls: segmentCalls },
            { from: VIEWERS, to: 'watch-lb', weight: 1, readShare: 0.96, calls: metadataCalls },
            { from: 'cdn-budget', to: 'renditions', readShare: 1, calls: segmentCalls },
            { from: 'watch-lb', to: 'meta-api', readShare: 0.96, calls: metadataCalls },
            { from: 'meta-api', to: 'meta-cache', readShare: 0.96 },
            { from: 'meta-api', to: 'meta-db', readShare: 0.96 },
            { from: CREATORS, to: 'upload-gw', readShare: 0.02, calls: uploadCalls },
            { from: 'upload-gw', to: 'upload-api', readShare: 0.02, calls: uploadCalls },
            { from: 'upload-api', to: 'originals', readShare: 0.02, calls: originalCalls },
            { from: 'upload-api', to: 'meta-db', readShare: 0, calls: { fanout: 0.0067 } },
            { from: 'upload-api', to: 'jobs', calls: { fanout: 0.0333 } },
            { from: 'jobs', to: 'transcoder' },
            { from: 'transcoder', to: 'originals', readShare: 1, calls: sourceReadCalls },
            { from: 'transcoder', to: 'renditions', readShare: 0, calls: renditionWriteCalls },
        ],
    });
}

export const videoHosting: Challenge = {
    id: 'video-hosting',
    level: 3,
    estimatedMinutes: 45,
    tags: ['media', 'cdn', 'storage', 'async', 'cost'],
    title: { ru: 'Видеохостинг', en: 'Video hosting' },
    brief: {
        ru: 'Сто миллионов человек в сутки смотрят по пять шестиминутных роликов. Плеер берёт видео двухминутными сегментами по 67.5 МБ и один раз ходит за метаданными: 23 000 запросов в секунду, 101 ПБ в сутки, 9.4 Тбит/с непрерывно. Сверху 50 тысяч загрузок в день, и каждую надо перекодировать в пять качеств по десять минут процессорного времени на качество. Узкое место здесь не база — по объёму она смешная. Узкое место — раздача и хранение.',
        en: 'A hundred million people a day watch five six-minute clips each. The player pulls video in two-minute segments of 67.5 MB and asks for metadata once: 23,000 requests per second, 101 PB a day, a steady 9.4 Tbit/s. On top of that 50,000 uploads a day, each transcoded into five renditions at ten CPU-minutes per rendition. The bottleneck here is not the database — by volume it is laughable. The bottleneck is delivery and storage.',
    },
    given: {
        dau: viewerParams.dau,
        viewsPerUserDay: viewerParams.sessionsPerUserDay,
        requestsPerView: viewerParams.requestsPerSession,
        segmentMb: 67.5,
        avgWatchMinutes: 6,
        watchRps: 23148,
        egressPbDay: 101,
        egressTbitPerSec: 9.4,
        uploadsPerDay: 50000,
        avgSourceGb: 1.5,
        renditionsPerVideo: 5,
        transcodeMinutesPerRendition: 10,
        storageGrowthTbDay: 109,
        cdnEgressUsdPerGb: 0.02,
        peakFactor: viewerParams.peakFactor,
    },
    flows: [
        { id: VIEWERS, name: { ru: 'Просмотр видео', en: 'Watch a video' }, weightInScore: 0.6 },
        { id: CREATORS, name: { ru: 'Загрузка видео', en: 'Upload a video' }, weightInScore: 0.4 },
    ],
    constraints: {
        maxNodes: 20,
        allowedGroups: [
            'clients',
            'edge',
            'compute',
            'storage',
            'cache',
            'sql',
            'nosql',
            'messaging',
            'olap',
            'observability',
            'platform',
            'topology',
        ],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: {
                ru: 'Загруженный оригинал доезжает до объектного хранилища, а не до реляционной базы',
                en: 'The uploaded original reaches object storage, not a relational database',
            },
            flow: CREATORS,
            to: { group: 'storage' },
            notVia: [{ group: 'sql' }],
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Транскодинг идёт за очередью и не держит ответ загрузчику',
                en: 'Transcoding runs behind a queue and never holds up the uploader’s response',
            },
            flow: CREATORS,
            to: { group: 'compute' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'worker' },
        },
        {
            id: 'R3',
            kind: 'slo',
            desc: {
                ru: 'p99 сборки страницы просмотра — метаданные плюс сегменты — не выше 450 мс',
                en: 'p99 of assembling the watch page — metadata plus segments — stays under 450 ms',
            },
            flow: VIEWERS,
            metric: 'latency.p99',
            max: 450,
        },
        {
            id: 'R4',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 80%', en: 'No block runs hotter than 80%' },
            maxUtilization: 0.8,
        },
        {
            id: 'R5',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $72 млн в месяц', en: 'Monthly cost stays under $72M' },
            maxMonthlyCostUsd: 72000000,
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
            kind: 'security',
            desc: {
                ru: 'Аутентификация на периметре, клиент не ходит в хранилища напрямую',
                en: 'Authentication at the edge, no client talks to a store directly',
            },
            requires: ['auth-on-edge', 'no-direct-client-to-db', 'tls-terminate'],
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'durability',
            desc: { ru: 'Оригинал живёт минимум в трёх копиях', en: 'The original lives in at least three copies' },
            flow: CREATORS,
            minReplication: 3,
        },
        {
            id: 'B2',
            kind: 'freshness',
            desc: {
                ru: 'Очередь транскодинга разбирается быстрее чем за 30 секунд',
                en: 'The transcoding queue drains in under 30 seconds',
            },
            maxLagSec: 30,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.15 },
        'cache-flush': { latencyFactor: 2.5, utilizationFactor: 1.15 },
        'az-failure': { latencyFactor: 2, utilizationFactor: 1.3 },
    },
    lockedParams: { [VIEWERS]: viewerParams, [CREATORS]: creatorParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько терабит в секунду уходит зрителям и сколько такой полосы физически даёт одна точка присутствия?',
                en: 'How many terabits per second leave for viewers, and how much of that does a single point of presence physically provide?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Раздача 101 ПБ в сутки прямо из хранилища по прайсу $0.09 за гигабайт — это $273 млн в месяц. Контракт с CDN стоит $0.02 за гигабайт, но полоса одного провайдера не бесконечна: тысяча точек присутствия по 10 Гбит/с — это 10 Тбит/с, а вам нужно 9.4 Тбит/с уже в среднем.',
                en: 'Serving 101 PB a day straight from storage at $0.09 per gigabyte is $273M a month. A CDN contract costs $0.02 per gigabyte, but a single provider’s bandwidth is finite: a thousand points of presence at 10 Gbit/s each is 10 Tbit/s, and you already need 9.4 Tbit/s on average.',
            },
            forRequirement: 'R5',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Поставьте два CDN и разделите между ними сегменты поровну — каждый останется около половины своей полосы даже на пике. Транскодинг вынесите за Kafka: пять заданий на ролик по десять минут CPU каждое дают 1736 занятых ядер, пул считайте от пиковой, а не от средней нагрузки.',
                en: 'Put two CDNs in and split the segments evenly — each stays near half its bandwidth even at peak. Move transcoding behind Kafka: five jobs per clip at ten CPU-minutes each keep 1,736 cores busy, and size the pool for the peak, not the average.',
            },
            forRequirement: 'R4',
        },
    ],
    referenceSolutions: [
        {
            id: 'cdn-and-queue',
            name: { ru: 'Два CDN, S3 и очередь транскодинга', en: 'Two CDNs, S3 and a transcoding queue' },
            tradeoff: {
                ru: 'Скучная классика, которая работает: полоса поделена между двумя провайдерами, origin видит один запрос из двадцати, транскодинг живёт своей жизнью за очередью. Платите за это двумя контрактами вместо одного и синхронизацией контента между провайдерами.',
                en: 'The boring classic that works: bandwidth split across two providers, the origin sees one request in twenty, transcoding lives its own life behind a queue. The price is two contracts instead of one and keeping content in sync between them.',
            },
            build: cdnAndQueue,
        },
        {
            id: 'single-cdn-and-minio',
            name: { ru: 'Один дешёвый CDN и своё хранилище', en: 'One cheap CDN and self-hosted storage' },
            tradeoff: {
                ru: 'Дешевле почти вдвое: гигабайт по $0.012 и свои диски вместо S3. Расплата тройная: единственный провайдер занят на 94% уже в обычный день, промахи кэша складываются в 750 Гбит/с и кладут origin, а erasure coding раздувает те же данные в полтора раза — объявленных петабайт не хватает на три года.',
                en: 'Almost twice as cheap: $0.012 per gigabyte and your own disks instead of S3. The bill comes three times over: the single provider already runs at 94% on an ordinary day, cache misses add up to 750 Gbit/s and flatten the origin, and erasure coding inflates the same data by half — the declared petabytes do not cover three years.',
            },
            build: singleCdnAndMinio,
        },
    ],
};
