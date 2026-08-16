import type { InterviewSession } from '../../engine/practice/types';

export const INTERVIEWS: InterviewSession[] = [
    {
        id: 'interview-url-shortener',
        challengeId: 'url-shortener',
        durationMinutes: 45,
        title: { ru: 'Сокращатель ссылок', en: 'URL shortener' },
        brief: {
            ru: 'Сессия на 45 минут. Требования подкидываются по ходу: собирайте схему так, чтобы её было куда расширять.',
            en: 'A 45-minute session. Requirements arrive as you go: build so that there is room to grow.',
        },
        stages: [
            {
                atMinute: 0,
                brief: {
                    ru: 'Начнём с базы: 20 млн пользователей в сутки, короткая ссылка и редирект. Периметр закрыт, p99 редиректа — 150 мс.',
                    en: 'Start with the basics: 20M daily users, a short link and a redirect. Closed perimeter, redirect p99 at 150 ms.',
                },
                requirementIds: ['R1', 'R2', 'R3'],
                extraRequirements: [],
                scale: null,
                given: {},
            },
            {
                atMinute: 20,
                brief: {
                    ru: 'Продукт выстрелил: пользователей стало в десять раз больше. Бюджет подняли до $400 000 в месяц — но не выше.',
                    en: 'The product took off: ten times the users. The budget went up to $400,000 a month — and no further.',
                },
                requirementIds: [],
                extraRequirements: [
                    {
                        id: 'R4',
                        kind: 'budget',
                        desc: { ru: 'Стоимость не выше $400 000 в месяц', en: 'Monthly cost stays under $400,000' },
                        maxMonthlyCostUsd: 400000,
                    },
                ],
                scale: { nodeId: 'users', params: { dau: 200000000 } },
                given: { dau: 200000000, avgRps: 27778 },
            },
            {
                atMinute: 35,
                brief: {
                    ru: 'Последний вопрос: ссылка не должна теряться от потери одного узла хранилища, а сервис обязан пережить отказ региона.',
                    en: 'One last thing: a link must survive losing a storage node, and the service must survive a region failure.',
                },
                requirementIds: ['R5'],
                extraRequirements: [
                    {
                        id: 'R7',
                        kind: 'geo',
                        desc: { ru: 'Схема живёт минимум в двух регионах', en: 'The scheme spans at least two regions' },
                        minRegions: 2,
                    },
                ],
                scale: null,
                given: {},
            },
        ],
    },
    {
        id: 'interview-image-resize',
        challengeId: 'image-resize',
        durationMinutes: 45,
        title: { ru: 'Ресайз картинок', en: 'Image resizing' },
        brief: {
            ru: 'Сессия на 45 минут. Начинаем с конвейера загрузки, дальше растёт нагрузка и появляются требования к надёжности.',
            en: 'A 45-minute session. Start with the upload pipeline, then load grows and reliability requirements appear.',
        },
        stages: [
            {
                atMinute: 0,
                brief: {
                    ru: 'Пользователи загружают фотографии, каждая превращается в несколько размеров. Ответ пользователю не должен ждать ресайза.',
                    en: 'Users upload photos, each becomes several sizes. The user response must not wait for the resize.',
                },
                requirementIds: ['R1', 'R2', 'R3'],
                extraRequirements: [],
                scale: null,
                given: {},
            },
            {
                atMinute: 20,
                brief: {
                    ru: 'Нагрузка выросла в пять раз. Ни один блок не должен быть загружен выше 75%, бюджет — $175 000.',
                    en: 'Load grew fivefold. No block above 75% utilisation, budget $175,000.',
                },
                requirementIds: ['R4'],
                extraRequirements: [
                    {
                        id: 'R5',
                        kind: 'budget',
                        desc: { ru: 'Стоимость не выше $175 000 в месяц', en: 'Monthly cost stays under $175,000' },
                        maxMonthlyCostUsd: 175000,
                    },
                ],
                scale: { nodeId: 'uploaders', params: { dau: 7500000 } },
                given: { dau: 7500000, avgRps: 694 },
            },
            {
                atMinute: 35,
                brief: {
                    ru: 'Прод упал из-за одной машины. Критический путь загрузки не должен иметь единой точки отказа.',
                    en: 'Production went down because of a single machine. The upload path must have no single point of failure.',
                },
                requirementIds: [],
                extraRequirements: [
                    {
                        id: 'R6',
                        kind: 'redundancy',
                        desc: {
                            ru: 'На пути загрузки нет единой точки отказа',
                            en: 'The upload path carries no single point of failure',
                        },
                        flow: 'uploaders',
                        minRedundancy: 2,
                    },
                ],
                scale: null,
                given: {},
            },
        ],
    },
    {
        id: 'interview-shop-catalog',
        challengeId: 'shop-catalog',
        durationMinutes: 45,
        title: { ru: 'Каталог и корзина', en: 'Catalogue and cart' },
        brief: {
            ru: 'Сессия на 45 минут. Сначала читающая витрина, потом рост нагрузки, в конце — корректность корзины.',
            en: 'A 45-minute session. A read-heavy storefront first, then load growth, and finally cart correctness.',
        },
        stages: [
            {
                atMinute: 0,
                brief: {
                    ru: 'Витрина интернет-магазина: 12 млн покупателей в сутки, страница за 260 мс, браузер не ходит в базу напрямую.',
                    en: 'An online store front: 12M daily shoppers, a 260 ms page, and no browser talking to the database.',
                },
                requirementIds: ['R1', 'R2', 'R3'],
                extraRequirements: [],
                scale: null,
                given: {},
            },
            {
                atMinute: 20,
                brief: {
                    ru: 'Начался сезон распродаж: покупателей вчетверо больше. Бюджет — $144 000 в месяц.',
                    en: 'Sale season started: four times the shoppers. The budget is $144,000 a month.',
                },
                requirementIds: [],
                extraRequirements: [
                    {
                        id: 'R6',
                        kind: 'budget',
                        desc: { ru: 'Стоимость не выше $144 000 в месяц', en: 'Monthly cost stays under $144,000' },
                        maxMonthlyCostUsd: 144000,
                    },
                ],
                scale: { nodeId: 'shoppers', params: { dau: 48000000 } },
                given: { dau: 48000000, avgRps: 33333 },
            },
            {
                atMinute: 35,
                brief: {
                    ru: 'Поддержка завалена жалобами: товары исчезают из корзины, а две вкладки затирают правки друг друга.',
                    en: 'Support is flooded: items vanish from carts and two tabs overwrite each other.',
                },
                requirementIds: ['R4', 'R5'],
                extraRequirements: [],
                scale: null,
                given: {},
            },
        ],
    },
    {
        id: 'interview-twitter-feed',
        challengeId: 'twitter-feed',
        durationMinutes: 45,
        title: { ru: 'Лента коротких сообщений', en: 'Short-message feed' },
        brief: {
            ru: 'Сессия на 45 минут. Классическая задача про fanout: сначала чтение, потом масштаб, потом география.',
            en: 'A 45-minute session. The classic fanout problem: reads first, then scale, then geography.',
        },
        stages: [
            {
                atMinute: 0,
                brief: {
                    ru: '30 млн читателей в сутки, лента открывается за 300 мс, ни один блок не загружен выше 75%.',
                    en: '30M daily readers, the feed opens in 300 ms, no block above 75% utilisation.',
                },
                requirementIds: ['R1', 'R2', 'R3'],
                extraRequirements: [],
                scale: null,
                given: {},
            },
            {
                atMinute: 20,
                brief: {
                    ru: 'Аудитория выросла втрое, и сообщение не должно теряться от одной сломанной железки. Бюджет — $120 000.',
                    en: 'The audience tripled, and a message must not be lost to one broken machine. Budget $120,000.',
                },
                requirementIds: ['R4'],
                extraRequirements: [
                    {
                        id: 'R6',
                        kind: 'budget',
                        desc: { ru: 'Стоимость не выше $120 000 в месяц', en: 'Monthly cost stays under $120,000' },
                        maxMonthlyCostUsd: 120000,
                    },
                ],
                scale: { nodeId: 'readers', params: { dau: 90000000 } },
                given: { dau: 90000000, avgRps: 41667 },
            },
            {
                atMinute: 35,
                brief: {
                    ru: 'Половина аудитории теперь за океаном. Держим два региона и не даём ленте устаревать больше чем на 5% чтений.',
                    en: 'Half the audience is now overseas. Hold two regions and keep stale reads under 5%.',
                },
                requirementIds: ['R5'],
                extraRequirements: [
                    {
                        id: 'R7',
                        kind: 'geo',
                        desc: { ru: 'Схема живёт минимум в двух регионах', en: 'The scheme spans at least two regions' },
                        minRegions: 2,
                    },
                ],
                scale: null,
                given: {},
            },
        ],
    },
    {
        id: 'interview-autocomplete',
        challengeId: 'autocomplete',
        durationMinutes: 60,
        title: { ru: 'Поисковые подсказки', en: 'Search autocomplete' },
        brief: {
            ru: 'Сессия на 60 минут. Задача про хвост задержки: бюджет времени крошечный, и дорога до пользователя уже съела половину.',
            en: 'A 60-minute session. A latency-tail problem: the time budget is tiny and the network already ate half of it.',
        },
        stages: [
            {
                atMinute: 0,
                brief: {
                    ru: 'Подсказки в строке поиска: 60 млн пользователей, p99 — 100 мс, из которых 45 мс уже забрала дорога до дата-центра.',
                    en: 'Search-box suggestions: 60M users, p99 at 100 ms, of which 45 ms is already spent on the network.',
                },
                requirementIds: ['R1', 'R2', 'R3'],
                extraRequirements: [],
                scale: null,
                given: {},
            },
            {
                atMinute: 25,
                brief: {
                    ru: 'Пользователей стало вдвое больше, и продукт требует медианы в 70 мс. Бюджет — $24 000.',
                    en: 'Twice the users, and the product wants a 70 ms median. Budget $24,000.',
                },
                requirementIds: ['R4', 'R5'],
                extraRequirements: [
                    {
                        id: 'R6',
                        kind: 'budget',
                        desc: { ru: 'Стоимость не выше $24 000 в месяц', en: 'Monthly cost stays under $24,000' },
                        maxMonthlyCostUsd: 24000,
                    },
                ],
                scale: { nodeId: 'users', params: { dau: 120000000 } },
                given: { dau: 120000000, avgRps: 25000, peakRps: 50000 },
            },
            {
                atMinute: 45,
                brief: {
                    ru: 'Свежесть индекса стала продуктовым требованием: новый запрос должен попадать в подсказки почти сразу, а p95 — держаться в 90 мс.',
                    en: 'Index freshness became a product requirement: a new query must show up almost immediately, and p95 must hold at 90 ms.',
                },
                requirementIds: ['R7'],
                extraRequirements: [
                    {
                        id: 'R8',
                        kind: 'slo',
                        desc: { ru: 'p95 подсказки не выше 90 мс', en: 'Suggestion p95 stays under 90 ms' },
                        flow: 'users',
                        metric: 'latency.p95',
                        max: 90,
                    },
                ],
                scale: null,
                given: {},
            },
        ],
    },
    {
        id: 'interview-flash-sale',
        challengeId: 'flash-sale',
        durationMinutes: 45,
        title: { ru: 'Распродажа билетов', en: 'Flash ticket sale' },
        brief: {
            ru: 'Сессия на 45 минут. Пик в пять раз выше среднего, а корректность важнее скорости: билет нельзя продать дважды.',
            en: 'A 45-minute session. The peak is five times the average, and correctness beats speed: a ticket cannot be sold twice.',
        },
        stages: [
            {
                atMinute: 0,
                brief: {
                    ru: '500 000 билетов уходят за минуты. Покупка укладывается в 250 мс, блоки не выше 80%, билет доезжает до долговечного журнала.',
                    en: '500,000 tickets go in minutes. A purchase fits in 250 ms, blocks stay under 80%, and the ticket reaches a durable journal.',
                },
                requirementIds: ['R1', 'R4', 'R5'],
                extraRequirements: [],
                scale: null,
                given: {},
            },
            {
                atMinute: 20,
                brief: {
                    ru: 'На прошлой распродаже продали больше билетов, чем было мест. Овербукинга быть не должно, и покупатель обязан сразу видеть свой билет.',
                    en: 'The last sale sold more tickets than seats. No overbooking, and the buyer must see their ticket immediately.',
                },
                requirementIds: ['R2', 'R3'],
                extraRequirements: [],
                scale: { nodeId: 'buyers', params: { peakFactor: 6 } },
                given: { peakFactor: 6, peakRps: 25000 },
            },
            {
                atMinute: 35,
                brief: {
                    ru: 'Финансы просят уложиться в $120 000, юристы — хранить проданный билет минимум в трёх копиях.',
                    en: 'Finance wants $120,000, legal wants a sold ticket kept in at least three copies.',
                },
                requirementIds: ['R6'],
                extraRequirements: [
                    {
                        id: 'R7',
                        kind: 'budget',
                        desc: { ru: 'Стоимость не выше $120 000 в месяц', en: 'Monthly cost stays under $120,000' },
                        maxMonthlyCostUsd: 120000,
                    },
                ],
                scale: null,
                given: {},
            },
        ],
    },
];

export function interviewById(id: string): InterviewSession | undefined {
    return INTERVIEWS.find((session) => session.id === id);
}
