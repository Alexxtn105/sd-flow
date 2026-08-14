import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const USERS = 'users';

const userParams = {
    dau: 20000000,
    sessionsPerUserDay: 2,
    requestsPerSession: 6,
    avgRequestKb: 1,
    avgResponseKb: 2,
    readWriteMix: 0.98,
    cacheableShare: 0.85,
    peakFactor: 3,
    geoDistribution: 'global',
};

const clientCalls = { requestBytes: 1000, responseBytes: 2000 };

function starter(): SchemeV1 {
    return buildScheme({
        id: 'url-shortener',
        name: 'Сократитель ссылок',
        nodes: [{ id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 160 } }],
        links: [],
    });
}

function cacheAndSql(): SchemeV1 {
    return buildScheme({
        id: 'url-shortener-cache-sql',
        name: 'Кэш перед реляционной базой',
        nodes: [
            { id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 160 } },
            { id: 'gateway', type: 'api-gateway', position: { x: 260, y: 160 } },
            { id: 'resolver', type: 'service', params: { serviceTimeMs: 8 }, position: { x: 520, y: 160 } },
            {
                id: 'hot-links',
                type: 'redis',
                params: { uniqueKeys: 40000000, valueSizeBytes: 256, ttlSec: 600 },
                position: { x: 800, y: 60 },
            },
            {
                id: 'links',
                type: 'postgres',
                params: {
                    rowCount: 400000000,
                    rowSizeBytes: 200,
                    storageGb: 4000,
                    readReplicas: 2,
                    readFromReplica: 0.5,
                    replicationMode: 'sync',
                },
                position: { x: 800, y: 280 },
            },
        ],
        links: [
            { from: USERS, to: 'gateway', readShare: 0.98, calls: clientCalls },
            { from: 'gateway', to: 'resolver', readShare: 0.98, calls: clientCalls },
            { from: 'resolver', to: 'hot-links', readShare: 0.98 },
            { from: 'resolver', to: 'links', readShare: 0.98 },
        ],
    });
}

function managedKeyValue(): SchemeV1 {
    return buildScheme({
        id: 'url-shortener-managed-kv',
        name: 'Управляемое key-value хранилище',
        nodes: [
            { id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 160 } },
            { id: 'gateway', type: 'api-gateway', position: { x: 260, y: 160 } },
            { id: 'resolver', type: 'service', params: { serviceTimeMs: 8 }, position: { x: 520, y: 160 } },
            {
                id: 'links',
                type: 'dynamodb',
                params: { itemSizeKb: 0.3, itemCount: 400000000, gsiCount: 1 },
                position: { x: 800, y: 160 },
            },
        ],
        links: [
            { from: USERS, to: 'gateway', readShare: 0.98, calls: clientCalls },
            { from: 'gateway', to: 'resolver', readShare: 0.98, calls: clientCalls },
            { from: 'resolver', to: 'links', readShare: 0.98 },
        ],
    });
}

export const urlShortener: Challenge = {
    id: 'url-shortener',
    level: 1,
    estimatedMinutes: 20,
    tags: ['read-heavy', 'cache', 'storage', 'cost'],
    title: { ru: 'Сократитель ссылок', en: 'URL shortener' },
    brief: {
        ru: 'Двадцать миллионов человек в сутки жмут короткие ссылки: 240 млн переходов, 2 800 запросов в секунду, из них 98% — чтение. Схема должна отдавать редирект быстро, переживать пик втрое и не разориться на запросах.',
        en: 'Twenty million people a day click short links: 240M redirects, 2,800 requests per second, 98% of them reads. The design must answer fast, survive a 3x peak and not go broke on request costs.',
    },
    given: {
        dau: userParams.dau,
        requestsPerUserDay: userParams.sessionsPerUserDay * userParams.requestsPerSession,
        avgRps: 2778,
        readShare: userParams.readWriteMix,
        peakFactor: userParams.peakFactor,
    },
    flows: [{ id: USERS, name: { ru: 'Переход по ссылке', en: 'Follow a link' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 8,
        allowedGroups: ['clients', 'edge', 'compute', 'cache', 'sql', 'nosql', 'topology'],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'security',
            desc: {
                ru: 'Периметр закрыт: браузер не ходит в хранилище напрямую, TLS рвётся на входе',
                en: 'The perimeter holds: the browser never talks to storage directly, TLS terminates at the edge',
            },
            requires: ['no-direct-client-to-db', 'tls-terminate'],
        },
        {
            id: 'R2',
            kind: 'slo',
            desc: { ru: 'p99 редиректа не выше 150 мс', en: 'Redirect p99 stays under 150 ms' },
            flow: USERS,
            metric: 'latency.p99',
            max: 150,
        },
        {
            id: 'R3',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 75%', en: 'No block runs hotter than 75%' },
            maxUtilization: 0.75,
        },
        {
            id: 'R4',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $40 000 в месяц', en: 'Monthly cost stays under $40,000' },
            maxMonthlyCostUsd: 40000,
        },
        {
            id: 'R5',
            kind: 'durability',
            desc: {
                ru: 'Ссылка переживает потерю одного узла хранилища — копий минимум две',
                en: 'A link survives losing one storage node — at least two copies exist',
            },
            flow: USERS,
            minReplication: 2,
        },
        {
            id: 'R6',
            kind: 'storage',
            desc: { ru: 'Места хватает на три года роста с запасом 20%', en: 'Capacity covers three years of growth with 20% headroom' },
            horizonYears: 3,
            headroom: 1.2,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианный редирект укладывается в 70 мс', en: 'Median redirect stays under 70 ms' },
            flow: USERS,
            metric: 'latency.p50',
            max: 70,
        },
        {
            id: 'B2',
            kind: 'budget',
            desc: { ru: 'Уложиться в $12 000 в месяц', en: 'Stay under $12,000 a month' },
            maxMonthlyCostUsd: 12000,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.15 },
        'cache-flush': { latencyFactor: 2, utilizationFactor: 1.3 },
        'az-failure': { latencyFactor: 2.5, utilizationFactor: 1.3 },
    },
    lockedParams: { [USERS]: userParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько на самом деле весит одна короткая ссылка и сколько их накопится за три года?',
                en: 'How much does one short link actually weigh, and how many pile up over three years?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: '98% трафика — это чтение одного и того же маленького ключа. Такой профиль почти целиком снимается памятью, а до диска доходят единицы процентов.',
                en: '98% of the traffic is reading the same tiny key. That profile is absorbed by memory almost entirely; only a few percent reach the disk.',
            },
            forRequirement: 'R2',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Поставьте кэш рядом с сервисом резолвинга и оставьте базе только промахи и записи — либо возьмите управляемое key-value хранилище и платите за запросы, а не за инстансы.',
                en: 'Put a cache next to the resolver and leave the database only misses and writes — or take a managed key-value store and pay per request instead of per instance.',
            },
            forRequirement: 'R3',
        },
    ],
    referenceSolutions: [
        {
            id: 'cache-and-sql',
            name: { ru: 'Кэш перед реляционной базой', en: 'Cache in front of a relational database' },
            tradeoff: {
                ru: 'Понятная классика: горячие ключи живут в памяти, база хранит истину и растёт предсказуемо. Платим за инстансы и следим за объёмом диска сами.',
                en: 'The familiar classic: hot keys live in memory, the database holds the truth and grows predictably. You pay per instance and watch disk size yourself.',
            },
            build: cacheAndSql,
        },
        {
            id: 'managed-kv',
            name: { ru: 'Управляемое key-value хранилище', en: 'Managed key-value store' },
            tradeoff: {
                ru: 'Меньше блоков и никакой заботы о ёмкости, но каждый запрос стоит денег, а задержка чтения выше, чем у памяти.',
                en: 'Fewer blocks and no capacity planning, but every request costs money and read latency is higher than memory.',
            },
            build: managedKeyValue,
        },
    ],
};
