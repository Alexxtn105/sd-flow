import type { GolfTask } from '../../engine/practice/types';

export const GOLF_TASKS: GolfTask[] = [
    {
        id: 'golf-url-shortener',
        challengeId: 'url-shortener',
        startFrom: 'managed-kv',
        parUsdMonth: 29000,
        title: { ru: 'Сокращатель ссылок за минимум', en: 'URL shortener on a budget' },
        brief: {
            ru: 'Схема работает и держит SLO, но за неё платят втридорога. Снижайте счёт, не роняя ни одного требования: бюджетное требование снято, счёт и есть результат.',
            en: 'The scheme works and holds its SLO, but costs a fortune. Cut the bill without dropping a single requirement: the budget gate is off, the bill is the score.',
        },
        inflate: [
            { kind: 'params', nodeId: 'gateway', params: { instances: 90, autoscale: false } },
            { kind: 'params', nodeId: 'resolver', params: { instances: 220, autoscale: false } },
        ],
    },
    {
        id: 'golf-image-resize',
        challengeId: 'image-resize',
        startFrom: 'queue-and-workers',
        parUsdMonth: 33000,
        title: { ru: 'Конвейер ресайза за минимум', en: 'Resize pipeline on a budget' },
        brief: {
            ru: 'Конвейер загрузки и ресайза собран с большим запасом. Найдите, где запас лишний, и уберите его, сохранив задержку и загрузку блоков.',
            en: 'The upload and resize pipeline was built with plenty of slack. Find the slack that is not needed and remove it while holding latency and utilisation.',
        },
        inflate: [
            { kind: 'params', nodeId: 'upload-api', params: { instances: 140, autoscale: false } },
            { kind: 'params', nodeId: 'resizer', params: { instances: 600, autoscale: false } },
            { kind: 'params', nodeId: 'jobs', params: { brokers: 24, partitions: 96 } },
        ],
    },
    {
        id: 'golf-shop-catalog',
        challengeId: 'shop-catalog',
        startFrom: 'cart-in-sql',
        parUsdMonth: 34000,
        title: { ru: 'Каталог и корзина за минимум', en: 'Catalogue and cart on a budget' },
        brief: {
            ru: 'Витрину и корзину развернули с четырёхкратным запасом на каждом блоке. Уложитесь в цель по счёту, не нарушив корректность корзины.',
            en: 'The storefront and cart were deployed with a fourfold margin on every block. Hit the cost target without breaking cart correctness.',
        },
        inflate: [
            { kind: 'params', nodeId: 'catalog-api', params: { instances: 220, autoscale: false } },
            { kind: 'params', nodeId: 'cart-api', params: { instances: 140, autoscale: false } },
            { kind: 'params', nodeId: 'cards', params: { shards: 24, memoryGb: 256 } },
            { kind: 'params', nodeId: 'carts', params: { readReplicas: 12, cpuCores: 64 } },
        ],
    },
    {
        id: 'golf-autocomplete',
        challengeId: 'autocomplete',
        startFrom: 'in-memory-prefix-index',
        parUsdMonth: 6800,
        title: { ru: 'Подсказки за минимум', en: 'Autocomplete on a budget' },
        brief: {
            ru: 'Самая жёсткая задача набора: бюджет задержки крошечный, а лишние узлы стоят денег. Резать придётся аккуратно.',
            en: 'The tightest task in the set: the latency budget is tiny and extra nodes cost money. Cut carefully.',
        },
        inflate: [
            { kind: 'params', nodeId: 'suggest', params: { instances: 36, autoscale: false } },
            { kind: 'params', nodeId: 'prefix-index', params: { nodes: 12 } },
            { kind: 'params', nodeId: 'indexer', params: { instances: 16 } },
        ],
    },
    {
        id: 'golf-twitter-feed',
        challengeId: 'twitter-feed',
        startFrom: 'fanout-on-write',
        parUsdMonth: 34000,
        title: { ru: 'Лента за минимум', en: 'Feed on a budget' },
        brief: {
            ru: 'Раскладка по подписчикам работает, но за неё переплачивают на каждом блоке. Снизьте счёт, удержав задержку ленты и свежесть данных.',
            en: 'Fanout works, but every block is overpaid for. Cut the bill while holding feed latency and data freshness.',
        },
        inflate: [
            { kind: 'params', nodeId: 'feed-api', params: { instances: 240, autoscale: false } },
            { kind: 'params', nodeId: 'post-api', params: { instances: 120, autoscale: false } },
            { kind: 'params', nodeId: 'timelines', params: { shards: 32, memoryGb: 256 } },
            { kind: 'params', nodeId: 'spreader', params: { instances: 240, autoscale: false } },
        ],
    },
];

export function golfById(id: string): GolfTask | undefined {
    return GOLF_TASKS.find((task) => task.id === id);
}
