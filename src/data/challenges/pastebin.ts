import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const AUTHORS = 'authors';

const authorParams = {
    dau: 3000000,
    sessionsPerUserDay: 2,
    requestsPerSession: 4,
    avgRequestKb: 12,
    avgResponseKb: 24,
    readWriteMix: 0.9,
    cacheableShare: 0.5,
    peakFactor: 3,
    geoDistribution: 'global',
};

const clientCalls = { requestBytes: 12000, responseBytes: 24000 };
const blobCalls = { requestBytes: 12000, responseBytes: 24000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'pastebin',
        name: 'Хранилище текстовых заметок',
        nodes: [{ id: AUTHORS, type: 'client-web', params: authorParams, position: { x: 0, y: 160 } }],
        links: [],
    });
}

function objectStore(): SchemeV1 {
    return buildScheme({
        id: 'pastebin-object-store',
        name: 'Тексты в объектном хранилище',
        nodes: [
            { id: AUTHORS, type: 'client-web', params: authorParams, position: { x: 0, y: 160 } },
            { id: 'gateway', type: 'api-gateway', position: { x: 260, y: 160 } },
            { id: 'paste-api', type: 'service', params: { serviceTimeMs: 10 }, position: { x: 520, y: 160 } },
            {
                id: 'texts',
                type: 's3',
                params: { avgObjectSizeMb: 0.024, objectCount: 200000000, prefixCount: 20, lifecycleDays: 365 },
                position: { x: 800, y: 60 },
            },
            {
                id: 'meta',
                type: 'postgres',
                params: { rowCount: 200000000, rowSizeBytes: 250, storageGb: 1200, readReplicas: 2, readFromReplica: 0.6 },
                position: { x: 800, y: 280 },
            },
        ],
        links: [
            { from: AUTHORS, to: 'gateway', readShare: 0.9, calls: clientCalls },
            { from: 'gateway', to: 'paste-api', readShare: 0.9, calls: clientCalls },
            { from: 'paste-api', to: 'texts', readShare: 0.9, calls: blobCalls },
            { from: 'paste-api', to: 'meta', readShare: 0.9 },
        ],
    });
}

function selfHosted(): SchemeV1 {
    return buildScheme({
        id: 'pastebin-self-hosted',
        name: 'Своё объектное хранилище',
        nodes: [
            { id: AUTHORS, type: 'client-web', params: authorParams, position: { x: 0, y: 160 } },
            { id: 'balancer', type: 'lb-l7', position: { x: 260, y: 160 } },
            { id: 'paste-api', type: 'service', params: { serviceTimeMs: 10 }, position: { x: 520, y: 160 } },
            {
                id: 'texts',
                type: 'minio',
                params: { avgObjectSizeMb: 0.024, objectCount: 200000000, nodes: 8, usableTb: 60 },
                position: { x: 800, y: 60 },
            },
            {
                id: 'meta',
                type: 'postgres',
                params: { rowCount: 200000000, rowSizeBytes: 250, storageGb: 1200, readReplicas: 2, readFromReplica: 0.6 },
                position: { x: 800, y: 280 },
            },
        ],
        links: [
            { from: AUTHORS, to: 'balancer', readShare: 0.9, calls: clientCalls },
            { from: 'balancer', to: 'paste-api', readShare: 0.9, calls: clientCalls },
            { from: 'paste-api', to: 'texts', readShare: 0.9, calls: blobCalls },
            { from: 'paste-api', to: 'meta', readShare: 0.9 },
        ],
    });
}

export const pastebin: Challenge = {
    id: 'pastebin',
    level: 1,
    estimatedMinutes: 20,
    tags: ['storage', 'blob', 'capacity', 'cost'],
    title: { ru: 'Хранилище текстовых заметок', en: 'Pastebin' },
    brief: {
        ru: 'Три миллиона человек в сутки кидают друг другу куски текста по 24 КБ: 24 млн обращений, около 280 запросов в секунду, каждый десятый — новая заметка. Вопрос не в нагрузке, а в том, где держать сами тексты.',
        en: 'Three million people a day toss 24 KB chunks of text at each other: 24M requests, about 280 per second, every tenth one a new paste. The load is trivial; the question is where the text itself lives.',
    },
    given: {
        dau: authorParams.dau,
        requestsPerUserDay: authorParams.sessionsPerUserDay * authorParams.requestsPerSession,
        avgRps: 278,
        avgPasteKb: authorParams.avgResponseKb,
        writeShare: 0.1,
        peakFactor: authorParams.peakFactor,
    },
    flows: [{ id: AUTHORS, name: { ru: 'Открыть или создать заметку', en: 'Open or create a paste' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 8,
        allowedGroups: ['clients', 'edge', 'compute', 'storage', 'sql', 'nosql', 'cache', 'topology'],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: {
                ru: 'Сам текст лежит в объектном хранилище, а не строкой в реляционной базе',
                en: 'The text itself lives in object storage, not as a row in a relational database',
            },
            flow: AUTHORS,
            to: { group: 'storage' },
            notVia: [{ group: 'sql' }],
        },
        {
            id: 'R2',
            kind: 'slo',
            desc: { ru: 'p99 открытия заметки не выше 220 мс', en: 'Opening a paste stays under 220 ms at p99' },
            flow: AUTHORS,
            metric: 'latency.p99',
            max: 220,
        },
        {
            id: 'R3',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 70%', en: 'No block runs hotter than 70%' },
            maxUtilization: 0.7,
        },
        {
            id: 'R4',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $8 000 в месяц', en: 'Monthly cost stays under $8,000' },
            maxMonthlyCostUsd: 8000,
        },
        {
            id: 'R5',
            kind: 'durability',
            desc: {
                ru: 'Заметка не пропадает от одной сломанной железки — копий минимум три',
                en: 'A paste does not vanish with one broken box — at least three copies exist',
            },
            flow: AUTHORS,
            minReplication: 3,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медиана открытия укладывается в 130 мс', en: 'Median open stays under 130 ms' },
            flow: AUTHORS,
            metric: 'latency.p50',
            max: 130,
        },
        {
            id: 'B2',
            kind: 'security',
            desc: {
                ru: 'Аутентификация вынесена на вход, а не размазана по сервисам',
                en: 'Authentication happens at the entrance, not scattered across services',
            },
            requires: ['auth-on-edge', 'no-direct-client-to-db'],
        },
    ],
    scenarios: { required: ['peak', 'az-failure'], bonus: ['cache-flush'] },
    relaxation: {
        peak: { utilizationFactor: 1.2 },
        'az-failure': { latencyFactor: 2.5, utilizationFactor: 1.3 },
        'cache-flush': { latencyFactor: 2, utilizationFactor: 1.3 },
    },
    lockedParams: { [AUTHORS]: authorParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Посчитайте, сколько байт в сутки приносят новые заметки и во что это превратится через год.',
                en: 'Count how many bytes a day new pastes bring in, and what that becomes in a year.',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Двадцатичетырёхкилобайтная строка в реляционной базе раздувает индексы и буферный пул, а читается всё равно целиком и по ключу.',
                en: 'A 24 KB string in a relational database bloats indexes and the buffer pool, yet it is still read whole and by key.',
            },
            forRequirement: 'R1',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Разделите данные: тело заметки — в объектное хранилище по ключу, а в базе оставьте только идентификатор, срок жизни и автора.',
                en: 'Split the data: the body goes to object storage under a key, and the database keeps only the id, the TTL and the author.',
            },
            forRequirement: 'R1',
        },
    ],
    referenceSolutions: [
        {
            id: 'object-store',
            name: { ru: 'Облачное объектное хранилище', en: 'Cloud object storage' },
            tradeoff: {
                ru: 'Ёмкость бесконечна, долговечность чужая забота, платим за запросы и гигабайты. Задержка первого байта — десятки миллисекунд.',
                en: 'Capacity is endless, durability is someone else’s job, you pay per request and per gigabyte. First-byte latency is tens of milliseconds.',
            },
            build: objectStore,
        },
        {
            id: 'self-hosted',
            name: { ru: 'Своё хранилище на своих дисках', en: 'Self-hosted object storage' },
            tradeoff: {
                ru: 'Втрое дешевле и заметно быстрее по первому байту, но ёмкость конечна, за расширением следите сами, и один балансировщик вместо шлюза оставляет периметр без аутентификации.',
                en: 'Three times cheaper and noticeably faster on first byte, but capacity is finite, growth is your problem, and a plain balancer instead of a gateway leaves the perimeter without authentication.',
            },
            build: selfHosted,
        },
    ],
};
