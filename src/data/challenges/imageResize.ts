import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const UPLOADERS = 'uploaders';

const uploaderParams = {
    dau: 1500000,
    sessionsPerUserDay: 2,
    requestsPerSession: 4,
    avgRequestKb: 800,
    avgResponseKb: 60,
    readWriteMix: 0.55,
    cacheableShare: 0.6,
    peakFactor: 3,
    geoDistribution: 'global',
};

const clientCalls = { requestBytes: 800000, responseBytes: 60000 };
const blobCalls = { requestBytes: 800000, responseBytes: 200000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'image-resize',
        name: 'Хостинг картинок с ресайзом',
        nodes: [{ id: UPLOADERS, type: 'client-web', params: uploaderParams, position: { x: 0, y: 200 } }],
        links: [],
    });
}

function queueAndWorkers(): SchemeV1 {
    return buildScheme({
        id: 'image-resize-workers',
        name: 'Очередь и пул обработчиков',
        nodes: [
            { id: UPLOADERS, type: 'client-web', params: uploaderParams, position: { x: 0, y: 200 } },
            { id: 'gateway', type: 'api-gateway', params: { payloadLimitMb: 25 }, position: { x: 260, y: 200 } },
            {
                id: 'upload-api',
                type: 'service',
                params: { serviceTimeMs: 25, networkMbps: 4000 },
                position: { x: 520, y: 200 },
            },
            {
                id: 'media',
                type: 's3',
                params: { avgObjectSizeMb: 0.8, objectCount: 400000000, prefixCount: 24 },
                position: { x: 800, y: 80 },
            },
            {
                id: 'jobs',
                type: 'kafka',
                params: { messageSizeKb: 2, partitions: 24, retentionHours: 48 },
                position: { x: 800, y: 340 },
            },
            {
                id: 'resizer',
                type: 'worker',
                params: { instances: 16, concurrency: 16, cpuCores: 8, processingTimeMs: 2500 },
                position: { x: 1080, y: 340 },
            },
        ],
        links: [
            { from: UPLOADERS, to: 'gateway', readShare: 0.55, calls: clientCalls },
            { from: 'gateway', to: 'upload-api', readShare: 0.55, calls: clientCalls },
            { from: 'upload-api', to: 'media', readShare: 0.55, calls: blobCalls },
            { from: 'upload-api', to: 'jobs', calls: { fanout: 0.45 } },
            { from: 'jobs', to: 'resizer' },
            { from: 'resizer', to: 'media', readShare: 0.2, calls: blobCalls },
        ],
    });
}

function serverlessResize(): SchemeV1 {
    return buildScheme({
        id: 'image-resize-serverless',
        name: 'Очередь и функции по требованию',
        nodes: [
            { id: UPLOADERS, type: 'client-web', params: uploaderParams, position: { x: 0, y: 200 } },
            { id: 'gateway', type: 'api-gateway', params: { payloadLimitMb: 25 }, position: { x: 260, y: 200 } },
            {
                id: 'upload-api',
                type: 'service',
                params: { serviceTimeMs: 25, networkMbps: 4000 },
                position: { x: 520, y: 200 },
            },
            {
                id: 'media',
                type: 's3',
                params: { avgObjectSizeMb: 0.8, objectCount: 400000000, prefixCount: 24 },
                position: { x: 800, y: 80 },
            },
            { id: 'jobs', type: 'sqs', params: { messageSizeKb: 2 }, position: { x: 800, y: 340 } },
            {
                id: 'resizer',
                type: 'serverless',
                params: { memoryMb: 2048, serviceTimeMs: 2500, maxConcurrency: 400, coldStartShare: 0.05 },
                position: { x: 1080, y: 340 },
            },
        ],
        links: [
            { from: UPLOADERS, to: 'gateway', readShare: 0.55, calls: clientCalls },
            { from: 'gateway', to: 'upload-api', readShare: 0.55, calls: clientCalls },
            { from: 'upload-api', to: 'media', readShare: 0.55, calls: blobCalls },
            { from: 'upload-api', to: 'jobs', calls: { fanout: 0.45 } },
            { from: 'jobs', to: 'resizer' },
            { from: 'resizer', to: 'media', readShare: 0.2, calls: blobCalls },
        ],
    });
}

export const imageResize: Challenge = {
    id: 'image-resize',
    level: 1,
    estimatedMinutes: 25,
    tags: ['async', 'queue', 'storage', 'media'],
    title: { ru: 'Хостинг картинок с ресайзом', en: 'Image hosting with resizing' },
    brief: {
        ru: 'Полтора миллиона человек в сутки заливают фотографии по 800 КБ — около 140 запросов в секунду, почти половина из них загрузки. Каждую картинку надо превратить в несколько размеров, но это занимает секунды, а пользователь ждать не готов.',
        en: 'A million and a half people a day upload 800 KB photos — about 140 requests per second, nearly half of them uploads. Every picture needs several sizes, that takes seconds, and the user is not willing to wait.',
    },
    given: {
        dau: uploaderParams.dau,
        requestsPerUserDay: uploaderParams.sessionsPerUserDay * uploaderParams.requestsPerSession,
        avgRps: 139,
        avgUploadKb: uploaderParams.avgRequestKb,
        uploadShare: 0.45,
        resizeSeconds: 2.5,
        peakFactor: uploaderParams.peakFactor,
    },
    flows: [{ id: UPLOADERS, name: { ru: 'Загрузка картинки', en: 'Upload a picture' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 10,
        allowedGroups: ['clients', 'edge', 'compute', 'storage', 'messaging', 'cache', 'sql', 'nosql', 'topology'],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: {
                ru: 'Оригинал доезжает до объектного хранилища',
                en: 'The original reaches object storage',
            },
            flow: UPLOADERS,
            to: { group: 'storage' },
            notVia: [{ group: 'sql' }],
        },
        {
            id: 'R2',
            kind: 'capability',
            desc: {
                ru: 'Ресайз выполняется за очередью и не держит ответ пользователю',
                en: 'Resizing happens behind a queue and never holds up the user’s response',
            },
            flow: UPLOADERS,
            to: { group: 'compute' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'worker' },
        },
        {
            id: 'R3',
            kind: 'slo',
            desc: { ru: 'p99 загрузки не выше 700 мс', en: 'Upload p99 stays under 700 ms' },
            flow: UPLOADERS,
            metric: 'latency.p99',
            max: 700,
        },
        {
            id: 'R4',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 75%', en: 'No block runs hotter than 75%' },
            maxUtilization: 0.75,
        },
        {
            id: 'R5',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $30 000 в месяц', en: 'Monthly cost stays under $30,000' },
            maxMonthlyCostUsd: 30000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианная загрузка укладывается в 400 мс', en: 'Median upload stays under 400 ms' },
            flow: UPLOADERS,
            metric: 'latency.p50',
            max: 400,
        },
        {
            id: 'B2',
            kind: 'durability',
            desc: { ru: 'Оригинал хранится минимум в трёх копиях', en: 'The original is kept in at least three copies' },
            flow: UPLOADERS,
            minReplication: 3,
        },
    ],
    scenarios: { required: ['peak', 'az-failure'], bonus: ['cache-flush'] },
    relaxation: {
        peak: { utilizationFactor: 1.2 },
        'az-failure': { latencyFactor: 2.5, utilizationFactor: 1.3 },
        'cache-flush': { latencyFactor: 2, utilizationFactor: 1.3 },
    },
    lockedParams: { [UPLOADERS]: uploaderParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько секунд занимает ресайз одной картинки и сколько таких картинок приходит в секунду?',
                en: 'How many seconds does resizing one picture take, and how many pictures arrive per second?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Если обработка идёт внутри HTTP-запроса, каждая секунда работы держит соединение и поток: при 60 загрузках в секунду вам нужно полторы сотни одновременно занятых обработчиков только на ресайз.',
                en: 'If processing happens inside the HTTP request, every second of work holds a connection and a thread: at 60 uploads per second you need a hundred and fifty busy handlers just for resizing.',
            },
            forRequirement: 'R2',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Отвечайте сразу после записи оригинала, а задание на ресайз кладите в очередь — обработчики разберут её в своём темпе, и их число подбирается отдельно от числа веб-инстансов.',
                en: 'Answer right after the original is stored and drop the resize job into a queue — consumers drain it at their own pace, and their count is tuned separately from the web tier.',
            },
            forRequirement: 'R2',
        },
    ],
    referenceSolutions: [
        {
            id: 'queue-and-workers',
            name: { ru: 'Очередь и постоянный пул обработчиков', en: 'Queue and a standing worker pool' },
            tradeoff: {
                ru: 'Обработчики всегда прогреты и стоят одинаково при любой нагрузке — дёшево на ровном трафике, но ночью половина машин греет воздух.',
                en: 'Workers are always warm and cost the same at any load — cheap on steady traffic, but at night half the fleet heats the air.',
            },
            build: queueAndWorkers,
        },
        {
            id: 'serverless-resize',
            name: { ru: 'Очередь и функции по требованию', en: 'Queue and on-demand functions' },
            tradeoff: {
                ru: 'Платим ровно за секунды работы и не думаем про ёмкость, зато холодные старты добавляют задержку, а на плотном трафике счёт растёт быстрее, чем у своих машин.',
                en: 'You pay for exactly the seconds you use and never size the fleet, but cold starts add latency and at dense traffic the bill outgrows your own machines.',
            },
            build: serverlessResize,
        },
    ],
};
