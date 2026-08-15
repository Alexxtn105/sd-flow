import type { IncidentCase } from '../../engine/practice/types';

export const INCIDENTS: IncidentCase[] = [
    {
        id: 'incident-lost-replica',
        challengeId: 'pastebin',
        solutionId: 'object-store',
        timeLimitMinutes: 10,
        title: { ru: 'Метаданные остались в одной копии', en: 'Metadata is down to a single copy' },
        symptom: {
            ru: 'Ночью проводили работы с базой метаданных. Снаружи всё работает штатно, но проверка отказоустойчивости внезапно перестала проходить.',
            en: 'The metadata database was serviced overnight. From the outside everything works, but the durability check suddenly stopped passing.',
        },
        rootCause: {
            ru: 'У базы метаданных не осталось реплик: копия одна, и потеря узла уносит все ссылки на тексты.',
            en: 'The metadata database has no replicas left: a single copy, and losing the node takes every pointer to the texts with it.',
        },
        faults: [{ kind: 'params', nodeId: 'meta', params: { readReplicas: 0 } }],
    },
    {
        id: 'incident-throttled-kv',
        challengeId: 'url-shortener',
        solutionId: 'managed-kv',
        timeLimitMinutes: 10,
        title: { ru: 'Редиректы отваливаются на пике', en: 'Redirects fail at peak' },
        symptom: {
            ru: 'В час пик редиректы начинают отваливаться по таймауту, в спокойное время всё работает.',
            en: 'At peak hour redirects start timing out; off-peak everything works.',
        },
        rootCause: {
            ru: 'Выделенной пропускной способности хранилища ключ-значение не хватает на пиковый RPS, и запросы встают в очередь.',
            en: 'The key-value store has too little provisioned throughput for the peak RPS, so requests queue up.',
        },
        faults: [
            {
                kind: 'params',
                nodeId: 'links',
                params: { rcu: 2000, wcu: 500, maxRcuPerPartition: 300, maxWcuPerPartition: 100 },
            },
        ],
    },
    {
        id: 'incident-starved-resizer',
        challengeId: 'image-resize',
        solutionId: 'queue-and-workers',
        timeLimitMinutes: 10,
        title: { ru: 'Превью появляются через час', en: 'Thumbnails show up an hour later' },
        symptom: {
            ru: 'Загрузка проходит быстро, но уменьшенные копии появляются спустя час. Очередь растёт весь день.',
            en: 'Uploads are fast, but resized copies appear an hour later. The queue grows all day.',
        },
        rootCause: {
            ru: 'Обработчик остался в одном экземпляре: ёмкость ресайза ниже входящего потока, и очередь копится быстрее, чем разбирается.',
            en: 'The worker was left at a single instance: resize capacity is below the arrival rate, so the backlog outgrows the drain.',
        },
        faults: [{ kind: 'params', nodeId: 'resizer', params: { instances: 1, concurrency: 4 } }],
    },
    {
        id: 'incident-single-gateway',
        challengeId: 'rate-limiter',
        solutionId: 'sharded-buckets',
        timeLimitMinutes: 10,
        title: { ru: 'Шлюз стал узким местом', en: 'The gateway became the bottleneck' },
        symptom: {
            ru: 'На пике API отвечает медленно, хотя и сервисы, и хранилище счётчиков почти простаивают.',
            en: 'At peak the API is slow, though both the services and the counter store are nearly idle.',
        },
        rootCause: {
            ru: 'Шлюз остался в одном экземпляре: его ёмкость по запросам кончается раньше, чем у всего, что стоит за ним.',
            en: 'The gateway was left at a single instance: it runs out of request capacity before anything behind it does.',
        },
        faults: [{ kind: 'params', nodeId: 'gateway', params: { instances: 1 } }],
    },
    {
        id: 'incident-pinned-feed',
        challengeId: 'twitter-feed',
        solutionId: 'fanout-on-write',
        timeLimitMinutes: 10,
        title: { ru: 'Лента не переживает вечерний пик', en: 'The feed does not survive the evening peak' },
        symptom: {
            ru: 'Днём лента открывается мгновенно, вечером — с задержкой в секунды. Число инстансов сервиса ленты при этом не меняется весь день.',
            en: 'By day the feed opens instantly, in the evening it takes seconds. The feed service instance count never changes all day.',
        },
        rootCause: {
            ru: 'У сервиса ленты выключен автоскейлинг и зафиксировано два инстанса: на пике ёмкости не хватает, и запросы уходят в очередь.',
            en: 'The feed service has autoscaling off and two instances pinned: at peak there is not enough capacity and requests pile into the queue.',
        },
        faults: [{ kind: 'params', nodeId: 'feed-api', params: { autoscale: false, instances: 2 } }],
    },
    {
        id: 'incident-duplicate-notifications',
        challengeId: 'notifications',
        solutionId: 'queue-and-workers',
        timeLimitMinutes: 10,
        title: { ru: 'Пользователи получают дубли', en: 'Users get duplicate messages' },
        symptom: {
            ru: 'Часть пользователей получает одно и то же уведомление по нескольку раз. Отправка при этом не падает.',
            en: 'Some users receive the same notification several times. Delivery itself never fails.',
        },
        rootCause: {
            ru: 'Доставка перестала быть идемпотентной, а повторов стало больше: at-least-once без ключа идемпотентности превращается в дубликаты.',
            en: 'Delivery stopped being idempotent while retries grew: at-least-once without an idempotency key turns into duplicates.',
        },
        faults: [
            { kind: 'policy', from: 'outbox', to: 'sender', policy: { idempotent: false, retries: 4 } },
            { kind: 'params', nodeId: 'sender', params: { idempotent: false, retries: 4 } },
        ],
    },
    {
        id: 'incident-downsized-cart',
        challengeId: 'shop-catalog',
        solutionId: 'cart-in-sql',
        timeLimitMinutes: 10,
        title: { ru: 'Корзина отвечает пятисотыми', en: 'The cart returns 500s' },
        symptom: {
            ru: 'Каталог открывается нормально, а корзина в час пик отдаёт ошибки. Схему не меняли — меняли только размер машины под базой корзин.',
            en: 'The catalogue is fine, but the cart errors out at peak. The scheme did not change — only the machine under the cart database did.',
        },
        rootCause: {
            ru: 'База корзин переехала на вчетверо меньшую машину: на пике процессора не хватает, и запросы встают в очередь.',
            en: 'The cart database moved to a machine four times smaller: at peak the CPU runs out and requests queue up.',
        },
        faults: [{ kind: 'params', nodeId: 'carts', params: { cpuCores: 2 } }],
    },
    {
        id: 'incident-overbooking',
        challengeId: 'flash-sale',
        solutionId: 'reserve-in-cache',
        timeLimitMinutes: 10,
        title: { ru: 'Продали больше билетов, чем мест', en: 'More tickets sold than seats' },
        symptom: {
            ru: 'После распродажи оказалось, что билетов продано больше, чем было в наличии. Ошибок при этом не видел никто: ни клиенты, ни мониторинг.',
            en: 'After the sale it turned out more tickets were sold than existed. Nobody saw an error: neither clients nor monitoring.',
        },
        rootCause: {
            ru: 'Резерв мест перестал проверять версию записи: одновременные покупки затирают счётчик друг друга, и овербукинг проходит незаметно.',
            en: 'Seat reservation stopped checking the record version: parallel purchases overwrite each other and overbooking slips through unnoticed.',
        },
        faults: [{ kind: 'params', nodeId: 'seats', params: { concurrencyControl: 'none' } }],
    },
    {
        id: 'incident-no-prefix-cache',
        challengeId: 'autocomplete',
        solutionId: 'in-memory-prefix-index',
        timeLimitMinutes: 10,
        title: { ru: 'Подсказки опаздывают за набором', en: 'Suggestions lag behind typing' },
        symptom: {
            ru: 'Список подсказок приходит уже после того, как пользователь дописал слово. Индекс при этом отвечает штатно.',
            en: 'The suggestion list arrives after the user has finished the word, though the index itself answers normally.',
        },
        rootCause: {
            ru: 'Из схемы пропал кэш горячих префиксов: каждый набор символов уходит в индекс целиком, и на пике хвост задержки вылезает за бюджет.',
            en: 'The hot-prefix cache is gone: every keystroke goes to the index in full and at peak the latency tail blows the budget.',
        },
        faults: [{ kind: 'drop-node', nodeId: 'hot-prefixes' }],
    },
    {
        id: 'incident-starved-ranker',
        challengeId: 'instagram-feed',
        solutionId: 'cached-and-ranked',
        timeLimitMinutes: 10,
        title: { ru: 'Лента открывается вдвое дольше', en: 'The feed takes twice as long' },
        symptom: {
            ru: 'Лента стала открываться заметно дольше. Картинки раздаются как раньше, кэш собранных лент на месте, база постов не жалуется.',
            en: 'The feed became noticeably slower. Images are served as before, the timeline cache is in place, the post store is not complaining.',
        },
        rootCause: {
            ru: 'Ранжирование осталось в одном экземпляре: на пике модель не успевает, и очередь перед ней тянет за собой весь хвост задержки.',
            en: 'Ranking was left at a single instance: at peak the model cannot keep up and the queue in front of it drags the whole latency tail.',
        },
        faults: [{ kind: 'params', nodeId: 'ranker', params: { instances: 1 } }],
    },
];

export function incidentById(id: string): IncidentCase | undefined {
    return INCIDENTS.find((incident) => incident.id === id);
}
