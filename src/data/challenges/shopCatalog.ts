import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const SHOPPERS = 'shoppers';

const shopperParams = {
    dau: 12000000,
    sessionsPerUserDay: 3,
    requestsPerSession: 20,
    avgRequestKb: 1,
    avgResponseKb: 12,
    readWriteMix: 0.9,
    cacheableShare: 0.8,
    peakFactor: 3,
    geoDistribution: 'global',
};

const clientCalls = { requestBytes: 1000, responseBytes: 12000 };
const cardCalls = { requestBytes: 200, responseBytes: 3000 };
const cartCalls = { requestBytes: 800, responseBytes: 2500 };
const catalogShare = 0.88;
const cartShare = 0.12;

function starter(): SchemeV1 {
    return buildScheme({
        id: 'shop-catalog',
        name: 'Каталог и корзина магазина',
        nodes: [{ id: SHOPPERS, type: 'client-web', params: shopperParams, position: { x: 0, y: 200 } }],
        links: [],
    });
}

function cartInSql(): SchemeV1 {
    return buildScheme({
        id: 'shop-catalog-cart-in-sql',
        name: 'Корзина в реляционной базе',
        nodes: [
            { id: SHOPPERS, type: 'client-web', params: shopperParams, position: { x: 0, y: 200 } },
            {
                id: 'edge',
                type: 'lb-l7',
                params: { instances: 3, maxRpsPerInstance: 12000 },
                position: { x: 240, y: 200 },
            },
            {
                id: 'catalog-api',
                type: 'service',
                params: { instances: 8, autoscaleMax: 60, serviceTimeMs: 18 },
                position: { x: 500, y: 100 },
            },
            {
                id: 'cards',
                type: 'redis',
                params: {
                    shards: 3,
                    replicasPerShard: 1,
                    memoryGb: 26,
                    uniqueKeys: 200000000,
                    valueSizeBytes: 3000,
                    ttlSec: 86400,
                },
                position: { x: 780, y: 30 },
            },
            {
                id: 'catalog-db',
                type: 'postgres',
                params: {
                    readReplicas: 3,
                    readFromReplica: 0.7,
                    rowCount: 200000000,
                    rowSizeBytes: 2000,
                    storageGb: 2000,
                },
                position: { x: 780, y: 180 },
            },
            {
                id: 'cart-api',
                type: 'service',
                params: { instances: 2, autoscaleMax: 40, serviceTimeMs: 22 },
                position: { x: 500, y: 340 },
            },
            {
                id: 'carts',
                type: 'postgres',
                params: {
                    readReplicas: 1,
                    readFromReplica: 0,
                    rowCount: 20000000,
                    rowSizeBytes: 600,
                    storageGb: 800,
                    concurrencyControl: 'optimistic',
                },
                position: { x: 780, y: 340 },
            },
        ],
        links: [
            { from: SHOPPERS, to: 'edge', readShare: 0.9, calls: clientCalls },
            { from: 'edge', to: 'catalog-api', weight: catalogShare, readShare: 1, calls: clientCalls },
            { from: 'edge', to: 'cart-api', weight: cartShare, readShare: 0.45, calls: clientCalls },
            { from: 'catalog-api', to: 'cards', readShare: 1, calls: cardCalls },
            { from: 'catalog-api', to: 'catalog-db', readShare: 1, calls: cardCalls },
            { from: 'cart-api', to: 'carts', readShare: 0.45, calls: cartCalls },
        ],
    });
}

function cartInCache(): SchemeV1 {
    return buildScheme({
        id: 'shop-catalog-cart-in-cache',
        name: 'Корзина в кэше',
        nodes: [
            { id: SHOPPERS, type: 'client-web', params: shopperParams, position: { x: 0, y: 200 } },
            {
                id: 'edge',
                type: 'lb-l7',
                params: { instances: 3, maxRpsPerInstance: 12000 },
                position: { x: 240, y: 200 },
            },
            {
                id: 'catalog-api',
                type: 'service',
                params: { instances: 8, autoscaleMax: 60, serviceTimeMs: 18 },
                position: { x: 500, y: 100 },
            },
            {
                id: 'cards',
                type: 'redis',
                params: {
                    shards: 3,
                    replicasPerShard: 1,
                    memoryGb: 26,
                    uniqueKeys: 200000000,
                    valueSizeBytes: 3000,
                    ttlSec: 86400,
                },
                position: { x: 780, y: 30 },
            },
            {
                id: 'catalog-db',
                type: 'postgres',
                params: {
                    readReplicas: 3,
                    readFromReplica: 0.7,
                    rowCount: 200000000,
                    rowSizeBytes: 2000,
                    storageGb: 2000,
                },
                position: { x: 780, y: 180 },
            },
            {
                id: 'cart-api',
                type: 'service',
                params: { instances: 2, autoscaleMax: 40, serviceTimeMs: 22 },
                position: { x: 500, y: 340 },
            },
            {
                id: 'carts',
                type: 'redis',
                params: {
                    shards: 2,
                    replicasPerShard: 1,
                    memoryGb: 16,
                    uniqueKeys: 20000000,
                    valueSizeBytes: 2000,
                    ttlSec: 3600,
                },
                position: { x: 780, y: 340 },
            },
        ],
        links: [
            { from: SHOPPERS, to: 'edge', readShare: 0.9, calls: clientCalls },
            { from: 'edge', to: 'catalog-api', weight: catalogShare, readShare: 1, calls: clientCalls },
            { from: 'edge', to: 'cart-api', weight: cartShare, readShare: 0.45, calls: clientCalls },
            { from: 'catalog-api', to: 'cards', readShare: 1, calls: cardCalls },
            { from: 'catalog-api', to: 'catalog-db', readShare: 1, calls: cardCalls },
            { from: 'cart-api', to: 'carts', readShare: 0.45, calls: cartCalls },
        ],
    });
}

export const shopCatalog: Challenge = {
    id: 'shop-catalog',
    level: 2,
    estimatedMinutes: 30,
    tags: ['read-heavy', 'cache', 'consistency', 'cost'],
    title: { ru: 'Каталог и корзина магазина', en: 'Shop catalog and cart' },
    brief: {
        ru: 'Двенадцать миллионов покупателей в сутки — около 8 300 запросов в секунду. Почти девять запросов из десяти уходят в каталог, остальные — в корзину. Каталог читают все и почти не меняют, корзину читает и меняет один человек, но с двух вкладок сразу. Это два разных профиля нагрузки в одной схеме.',
        en: 'Twelve million shoppers a day — about 8,300 requests per second. Almost nine requests in ten go to the catalog, the rest to a cart. The catalog is read by everyone and barely ever changes; a cart is read and changed by one person, but from two tabs at once. Two different load profiles in one design.',
    },
    given: {
        dau: shopperParams.dau,
        requestsPerUserDay: shopperParams.sessionsPerUserDay * shopperParams.requestsPerSession,
        avgRps: 8333,
        catalogShare,
        cartShare,
        peakFactor: shopperParams.peakFactor,
    },
    flows: [{ id: SHOPPERS, name: { ru: 'Покупка', en: 'Shopping' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 12,
        allowedGroups: ['clients', 'edge', 'compute', 'cache', 'sql', 'nosql', 'messaging', 'topology'],
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
            desc: { ru: 'p99 страницы не выше 260 мс', en: 'Page p99 stays under 260 ms' },
            flow: SHOPPERS,
            metric: 'latency.p99',
            max: 260,
        },
        {
            id: 'R3',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 75%', en: 'No block runs hotter than 75%' },
            maxUtilization: 0.75,
        },
        {
            id: 'R4',
            kind: 'anomaly',
            desc: {
                ru: 'Две вкладки одного покупателя не затирают правки корзины друг друга',
                en: 'Two tabs of the same shopper do not overwrite each other’s cart edits',
            },
            code: 'lost-update',
            maxRatePerSec: 0,
        },
        {
            id: 'R5',
            kind: 'anomaly',
            desc: {
                ru: 'Положил товар — сразу видишь его в корзине: не больше 0.1% чтений мимо своей записи',
                en: 'Add an item and you see it right away: at most 0.1% of reads miss the shopper’s own write',
            },
            code: 'read-your-writes',
            maxSharePercent: 0.1,
        },
        {
            id: 'R6',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $36 000 в месяц', en: 'Monthly cost stays under $36,000' },
            maxMonthlyCostUsd: 36000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианная страница укладывается в 110 мс', en: 'Median page stays under 110 ms' },
            flow: SHOPPERS,
            metric: 'latency.p50',
            max: 110,
        },
        {
            id: 'B2',
            kind: 'durability',
            desc: {
                ru: 'Данные лежат минимум в двух копиях',
                en: 'Data is kept in at least two copies',
            },
            flow: SHOPPERS,
            minReplication: 2,
        },
    ],
    scenarios: { required: ['peak', 'cache-flush'], bonus: ['az-failure'] },
    relaxation: {
        peak: { utilizationFactor: 1.2 },
        'cache-flush': { latencyFactor: 2.5, utilizationFactor: 1.4 },
        'az-failure': { latencyFactor: 2.5, utilizationFactor: 1.3 },
    },
    lockedParams: { [SHOPPERS]: shopperParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Разделите трафик на два потока и посчитайте каждый отдельно: сколько чтений каталога и сколько изменений корзины приходится на секунду.',
                en: 'Split the traffic into two streams and count each one: how many catalog reads and how many cart changes happen per second.',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Карточка товара одинакова для всех и меняется раз в сутки — её незачем каждый раз доставать из базы. Корзина принадлежит одному человеку, но он меняет её из двух вкладок, и здесь важно, кто выиграет гонку.',
                en: 'A product card is the same for everyone and changes once a day — no need to fetch it from the database every time. A cart belongs to one person, but they change it from two tabs, and here it matters who wins the race.',
            },
            forRequirement: 'R4',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Каталог держите за кэшем с длинным сроком жизни и читайте с реплик — промахов будет пара процентов. Корзину читайте с того же узла, куда пишете, и меняйте через проверку версии: иначе вторая вкладка потихоньку затрёт первую.',
                en: 'Keep the catalog behind a long-lived cache and read it from replicas — misses will be a couple of percent. Read a cart from the same node you write it to and change it through a version check: otherwise the second tab quietly overwrites the first.',
            },
            forRequirement: 'R5',
        },
    ],
    referenceSolutions: [
        {
            id: 'cart-in-sql',
            name: { ru: 'Корзина в реляционной базе', en: 'Cart in a relational database' },
            tradeoff: {
                ru: 'Каталог живёт за кэшем и на репликах, корзина — в базе с проверкой версии и чтением с основного узла. Дороже на один сервер базы, зато корзина не теряет товары и всегда показывает то, что покупатель только что положил.',
                en: 'The catalog lives behind a cache and on replicas, the cart lives in a database with a version check and primary reads. One extra database server, but the cart never loses items and always shows what the shopper just added.',
            },
            build: cartInSql,
        },
        {
            id: 'cart-in-cache',
            name: { ru: 'Корзина в кэше', en: 'Cart in the cache' },
            tradeoff: {
                ru: 'Быстро, дёшево и на одну технологию меньше: обе горячие сущности лежат в памяти. Но у кэша нет контроля конкурентных изменений — две вкладки пишут поверх друг друга, и товар из корзины тихо пропадает.',
                en: 'Fast, cheap and one technology fewer: both hot entities live in memory. But the cache has no concurrency control — two tabs write over each other and an item quietly disappears from the cart.',
            },
            build: cartInCache,
        },
    ],
};
