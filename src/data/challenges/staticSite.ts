import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const VIEWERS = 'viewers';

const viewerParams = {
    dau: 2000000,
    sessionsPerUserDay: 3,
    requestsPerSession: 30,
    avgResponseKb: 120,
    avgRequestKb: 1,
    readWriteMix: 0.99,
    cacheableShare: 0.9,
    peakFactor: 3,
    geoDistribution: 'global',
};

function starter(): SchemeV1 {
    return buildScheme({
        id: 'static-site',
        name: 'Статический сайт с картинками',
        nodes: [{ id: VIEWERS, type: 'client-web', params: viewerParams, position: { x: 0, y: 120 } }],
        links: [],
    });
}

function withCdn(): SchemeV1 {
    return buildScheme({
        id: 'static-site-cdn',
        name: 'CDN поверх объектного хранилища',
        nodes: [
            { id: VIEWERS, type: 'client-web', params: viewerParams, position: { x: 0, y: 120 } },
            { id: 'cdn', type: 'cdn', position: { x: 280, y: 120 } },
            { id: 'objects', type: 's3', params: { avgObjectSizeMb: 0.12 }, position: { x: 560, y: 120 } },
        ],
        links: [
            { from: VIEWERS, to: 'cdn', readShare: 0.99 },
            { from: 'cdn', to: 'objects', readShare: 0.99 },
        ],
    });
}

function originOnly(): SchemeV1 {
    return buildScheme({
        id: 'static-site-origin',
        name: 'Раздача напрямую из хранилища',
        nodes: [
            { id: VIEWERS, type: 'client-web', params: viewerParams, position: { x: 0, y: 120 } },
            { id: 'balancer', type: 'lb-l7', position: { x: 260, y: 120 } },
            { id: 'origin', type: 'service', params: { instances: 12 }, position: { x: 520, y: 120 } },
            { id: 'objects', type: 's3', params: { avgObjectSizeMb: 0.12 }, position: { x: 780, y: 120 } },
        ],
        links: [
            { from: VIEWERS, to: 'balancer', readShare: 0.99 },
            { from: 'balancer', to: 'origin', readShare: 0.99 },
            { from: 'origin', to: 'objects', readShare: 0.99 },
        ],
    });
}

export const staticSite: Challenge = {
    id: 'static-site',
    level: 1,
    estimatedMinutes: 15,
    tags: ['cdn', 'storage', 'cost'],
    title: { ru: 'Статический сайт с картинками', en: 'Static site with images' },
    brief: {
        ru: 'Сайт раздаёт картинки двум миллионам пользователей в сутки. Нужно уложиться в задержку и в бюджет, не потеряв запас по ёмкости на пике.',
        en: 'A site serves images to two million daily users. Meet the latency target and the budget while keeping capacity headroom at peak.',
    },
    given: {
        dau: viewerParams.dau,
        requestsPerUserDay: viewerParams.sessionsPerUserDay * viewerParams.requestsPerSession,
        avgResponseKb: viewerParams.avgResponseKb,
        peakFactor: viewerParams.peakFactor,
    },
    flows: [{ id: VIEWERS, name: { ru: 'Просмотр страницы', en: 'Page view' }, weightInScore: 1 }],
    constraints: { maxNodes: 8, allowedGroups: ['clients', 'edge', 'storage', 'compute', 'cache', 'topology'] },
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: { ru: 'Картинки лежат в объектном хранилище, а не в базе', en: 'Images live in object storage, not in a database' },
            flow: VIEWERS,
            to: { group: 'storage' },
            notVia: [{ group: 'sql' }],
        },
        {
            id: 'R2',
            kind: 'slo',
            desc: { ru: 'p99 просмотра не выше 250 мс', en: 'View p99 stays under 250 ms' },
            flow: VIEWERS,
            metric: 'latency.p99',
            max: 250,
        },
        {
            id: 'R3',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 80%', en: 'No block runs hotter than 80%' },
            maxUtilization: 0.8,
        },
        {
            id: 'R4',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $90 000 в месяц', en: 'Monthly cost stays under $90,000' },
            maxMonthlyCostUsd: 90000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианный просмотр укладывается в 90 мс', en: 'Median view stays under 90 ms' },
            flow: VIEWERS,
            metric: 'latency.p50',
            max: 90,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: { peak: { utilizationFactor: 1.1 }, 'cache-flush': { latencyFactor: 2 } },
    lockedParams: { [VIEWERS]: viewerParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Сколько терабайт в сутки уходит клиентам и откуда именно они читаются?',
                en: 'How many terabytes a day leave for clients, and where exactly are they read from?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Раздача картинок напрямую из хранилища бьёт по задержке: клиент платит RTT до региона, а не до ближайшей точки присутствия.',
                en: 'Serving images straight from storage costs latency: the client pays the region RTT instead of the nearest point of presence.',
            },
            forRequirement: 'R2',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Поставьте CDN между клиентом и объектным хранилищем — при hit ratio около 0.92 до origin доходит меньше десятой части запросов.',
                en: 'Put a CDN between the client and object storage — at a hit ratio near 0.92 fewer than a tenth of requests reach the origin.',
            },
            forRequirement: 'R2',
        },
    ],
    referenceSolutions: [
        {
            id: 'cdn',
            name: { ru: 'CDN поверх объектного хранилища', en: 'CDN over object storage' },
            tradeoff: {
                ru: 'Дешёвая в эксплуатации классика: край держит задержку, origin видит только промахи кэша.',
                en: 'The cheap classic: the edge holds latency down and the origin only sees cache misses.',
            },
            build: withCdn,
        },
        {
            id: 'origin-only',
            name: { ru: 'Только объектное хранилище', en: 'Object storage only' },
            tradeoff: {
                ru: 'Меньше блоков и никакого кэша, но клиент платит полный RTT до региона, а хранилище упирается в лимит запросов на префикс.',
                en: 'Fewer blocks and no cache, but the client pays the full region RTT and storage hits its per-prefix request cap.',
            },
            build: originOnly,
        },
    ],
};
