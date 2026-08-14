import type { Challenge, LocalizedText } from '../../engine/challenges/types';
import { buildScheme } from '../../services/schemeBuilder';
import type { LinkSpec, NodeSpec } from '../../services/schemeBuilder';

const FLOW = 'advanced-clients';

const clientParams = {
    clients: 200,
    rpsPerClient: 2,
    quotaPerDay: 10000000,
    burstiness: 3,
    authMode: 'jwt-local',
    peakFactor: 3,
    readWriteMix: 0.55,
    avgRequestKb: 2,
    avgResponseKb: 8,
    geoDistribution: 'global',
    retries: 1,
    timeoutMs: 10000,
};

interface AdvancedSpec {
    id: string;
    level: 4 | 5;
    title: LocalizedText;
    brief: LocalizedText;
    lesson: LocalizedText;
    tags: string[];
    specialtyType: string;
    specialtyName: LocalizedText;
    nodes: NodeSpec[];
    links: LinkSpec[];
}

function starter(spec: AdvancedSpec) {
    return buildScheme({
        id: spec.id,
        name: spec.title.ru,
        nodes: [{ id: FLOW, type: 'client-api', params: clientParams, position: { x: 0, y: 180 } }],
        links: [],
    });
}

function reference(spec: AdvancedSpec) {
    return buildScheme({
        id: `${spec.id}-reference`,
        name: spec.specialtyName.ru,
        nodes: [
            { id: FLOW, type: 'client-api', params: clientParams, position: { x: 0, y: 180 } },
            { id: 'gateway', type: 'api-gateway', position: { x: 220, y: 180 } },
            {
                id: 'service',
                type: 'service',
                params: { instances: 6, autoscaleMax: 40, serviceTimeMs: 6 },
                position: { x: 440, y: 180 },
            },
            ...spec.nodes,
        ],
        links: [
            { from: FLOW, to: 'gateway', policy: { idempotent: true } },
            { from: 'gateway', to: 'service', policy: { idempotent: true } },
            ...spec.links,
        ],
    });
}

function challenge(spec: AdvancedSpec): Challenge {
    return {
        id: spec.id,
        level: spec.level,
        estimatedMinutes: spec.level === 4 ? 60 : 90,
        tags: spec.tags,
        title: spec.title,
        brief: spec.brief,
        given: {
            clients: clientParams.clients,
            rpsPerClient: clientParams.rpsPerClient,
            burstiness: clientParams.burstiness,
            peakFactor: clientParams.peakFactor,
        },
        flows: [{ id: FLOW, name: spec.title, weightInScore: 1 }],
        constraints: {
            maxNodes: 14,
            allowedGroups: [
                'clients',
                'edge',
                'compute',
                'sql',
                'nosql',
                'search',
                'olap',
                'cache',
                'messaging',
                'storage',
                'platform',
                'observability',
                'topology',
            ],
        },
        requirements: [
            {
                id: 'R1',
                kind: 'capability',
                desc: spec.lesson,
                flow: FLOW,
                to: { type: spec.specialtyType },
                viaAny: [{ type: 'service' }],
            },
            {
                id: 'R2',
                kind: 'security',
                desc: {
                    ru: 'Трафик проходит через аутентифицированный edge, TLS завершается до бизнес-логики, клиент не ходит в хранилище напрямую',
                    en: 'Traffic crosses an authenticated edge, TLS terminates before business logic, and clients never access storage directly',
                },
                requires: ['auth-on-edge', 'tls-terminate', 'no-direct-client-to-db'],
            },
            {
                id: 'R3',
                kind: 'capacity',
                desc: { ru: 'На базовой нагрузке ни один блок не перегружен', en: 'No block is overloaded at baseline' },
                maxUtilization: 0.95,
            },
        ],
        bonusObjectives: [
            {
                id: 'B1',
                kind: 'slo',
                desc: { ru: 'p99 сквозного запроса ниже 2 секунд', en: 'End-to-end p99 stays below two seconds' },
                flow: FLOW,
                metric: 'latency.p99',
                max: 2000,
            },
        ],
        scenarios: { required: ['peak'], bonus: ['az-failure'] },
        relaxation: {
            peak: { latencyFactor: 2, utilizationFactor: 4 },
            'az-failure': { latencyFactor: 3, utilizationFactor: 4 },
        },
        lockedParams: { [FLOW]: clientParams },
        starter: () => starter(spec),
        hints: [
            {
                level: 1,
                cost: 5,
                text: {
                    ru: 'Сначала отделите синхронный ответ клиенту от фоновой работы и состояния, которое должно пережить повтор.',
                    en: 'First separate the synchronous client response from background work and state that must survive a retry.',
                },
            },
            {
                level: 2,
                cost: 10,
                text: spec.lesson,
                forRequirement: 'R1',
            },
            {
                level: 3,
                cost: 20,
                text: {
                    ru: `В эталоне ключевой строительный блок — «${spec.specialtyName.ru}». Поставьте перед ним API-шлюз и сервис, затем проверьте пик нагрузки.`,
                    en: `The key building block in the reference is “${spec.specialtyName.en}”. Put an API gateway and a service in front of it, then test peak load.`,
                },
                forRequirement: 'R1',
            },
        ],
        referenceSolutions: [
            {
                id: 'reference',
                name: spec.specialtyName,
                tradeoff: {
                    ru: 'Решение явно показывает специализированный механизм и его место в потоке. Цена — дополнительная инфраструктура и отдельный эксплуатационный контур.',
                    en: 'The solution makes the specialized mechanism and its place in the flow explicit. The cost is more infrastructure and another operational surface.',
                },
                build: () => reference(spec),
            },
        ],
    };
}

const SPECS: AdvancedSpec[] = [
    {
        id: 'payment-system',
        level: 4,
        title: { ru: 'Платёжная система', en: 'Payment system' },
        brief: {
            ru: 'Проведите платёж через несколько шагов так, чтобы повтор запроса не списал деньги дважды, а незавершённый процесс можно было компенсировать.',
            en: 'Run a payment through several steps without charging twice on retry, and make an incomplete workflow compensatable.',
        },
        lesson: {
            ru: 'Платёж проходит через явный оркестратор саги до внешнего провайдера',
            en: 'The payment passes through an explicit saga orchestrator before the external provider',
        },
        tags: ['payments', 'saga', 'idempotency', 'audit'],
        specialtyType: 'saga-orchestrator',
        specialtyName: { ru: 'Сага с внешним провайдером', en: 'Saga with an external provider' },
        nodes: [
            { id: 'saga', type: 'saga-orchestrator', position: { x: 680, y: 180 } },
            {
                id: 'provider',
                type: 'payment-external',
                params: { rateLimitRps: 5000, maxConcurrency: 5000 },
                position: { x: 920, y: 180 },
            },
        ],
        links: [
            { from: 'service', to: 'saga', policy: { idempotent: true } },
            { from: 'saga', to: 'provider', policy: { idempotent: true } },
        ],
    },
    {
        id: 'ad-click-aggregation',
        level: 4,
        title: { ru: 'Агрегация рекламных кликов', en: 'Ad click aggregation' },
        brief: {
            ru: 'Соберите поток кликов в окна, удалите повторы и подготовьте быстрые агрегаты для аналитики.',
            en: 'Window a click stream, remove duplicates, and prepare fast aggregates for analytics.',
        },
        lesson: { ru: 'Клики проходят через потоковый процессор', en: 'Clicks pass through a stream processor' },
        tags: ['streaming', 'windows', 'deduplication', 'olap'],
        specialtyType: 'stream-processor',
        specialtyName: { ru: 'Kafka, окна и OLAP', en: 'Kafka, windows and OLAP' },
        nodes: [
            { id: 'events', type: 'kafka', position: { x: 680, y: 180 } },
            { id: 'windows', type: 'stream-processor', position: { x: 920, y: 180 } },
            { id: 'analytics', type: 'clickhouse', position: { x: 1160, y: 180 } },
        ],
        links: [
            { from: 'service', to: 'events', policy: { idempotent: true } },
            { from: 'events', to: 'windows' },
            { from: 'windows', to: 'analytics', readShare: 0 },
        ],
    },
    {
        id: 'distributed-scheduler',
        level: 4,
        title: { ru: 'Распределённый планировщик', en: 'Distributed scheduler' },
        brief: {
            ru: 'Миллионы заданий должны запускаться близко к назначенному времени, но только один активный исполнитель имеет право забрать каждое.',
            en: 'Millions of jobs must start near their due time, while only one active executor may claim each one.',
        },
        lesson: { ru: 'Задания попадают в специализированную очередь с расписанием', en: 'Jobs enter a dedicated scheduled queue' },
        tags: ['scheduler', 'leases', 'clock-skew', 'at-least-once'],
        specialtyType: 'scheduler-queue',
        specialtyName: { ru: 'Очередь расписаний и воркеры', en: 'Scheduled queue and workers' },
        nodes: [
            {
                id: 'schedule',
                type: 'scheduler-queue',
                params: { maxDelayHours: 1, memoryGb: 64 },
                position: { x: 680, y: 180 },
            },
            {
                id: 'runner',
                type: 'worker',
                params: { instances: 16, concurrency: 64, processingTimeMs: 20, cpuCores: 8 },
                position: { x: 920, y: 180 },
            },
            { id: 'leases', type: 'etcd', position: { x: 1160, y: 180 } },
        ],
        links: [
            { from: 'service', to: 'schedule', policy: { idempotent: true } },
            { from: 'schedule', to: 'runner' },
            { from: 'runner', to: 'leases' },
        ],
    },
    {
        id: 'realtime-leaderboard',
        level: 4,
        title: { ru: 'Лидерборд реального времени', en: 'Real-time leaderboard' },
        brief: {
            ru: 'Обновляйте счёт и отдавайте top-N за миллисекунды, сохраняя пропускную способность при горячих игроках.',
            en: 'Update scores and serve top-N in milliseconds while retaining throughput for hot players.',
        },
        lesson: { ru: 'Счёт хранится в шардированном Redis-хранилище', en: 'Scores live in a sharded Redis data store' },
        tags: ['leaderboard', 'redis', 'sharding', 'hot-key'],
        specialtyType: 'redis-store',
        specialtyName: { ru: 'Шардированный sorted-set', en: 'Sharded sorted set' },
        nodes: [{ id: 'scores', type: 'redis-store', position: { x: 680, y: 180 } }],
        links: [{ from: 'service', to: 'scores', policy: { idempotent: true } }],
    },
    {
        id: 'telemetry-store',
        level: 4,
        title: { ru: 'Хранилище метрик и логов', en: 'Metrics and logs store' },
        brief: {
            ru: 'Соберите высококардинальную телеметрию, ограничьте её стоимость и оставьте путь от алерта до конкретного запроса.',
            en: 'Ingest high-cardinality telemetry, control its cost, and retain a path from an alert to a specific request.',
        },
        lesson: { ru: 'Сервис экспортирует распределённые трассировки', en: 'The service exports distributed traces' },
        tags: ['observability', 'cardinality', 'retention', 'cost'],
        specialtyType: 'traces',
        specialtyName: { ru: 'Метрики, логи и трассы', en: 'Metrics, logs and traces' },
        nodes: [{ id: 'trace-store', type: 'traces', position: { x: 680, y: 180 } }],
        links: [{ from: 'service', to: 'trace-store' }],
    },
    {
        id: 'matching-engine',
        level: 5,
        title: { ru: 'Биржевой матчинг-движок', en: 'Exchange matching engine' },
        brief: {
            ru: 'Упорядочьте заявки детерминированно, обработайте их одним писателем и сохраните журнал для восстановления.',
            en: 'Order commands deterministically, process them with a single writer, and retain a recovery log.',
        },
        lesson: { ru: 'Команды сначала попадают в упорядоченный Redis Stream', en: 'Commands first enter an ordered Redis Stream' },
        tags: ['trading', 'determinism', 'single-writer', 'log'],
        specialtyType: 'redis-streams',
        specialtyName: { ru: 'Упорядоченный журнал заявок', en: 'Ordered command log' },
        nodes: [
            { id: 'commands', type: 'redis-streams', position: { x: 680, y: 180 } },
        ],
        links: [
            { from: 'service', to: 'commands', policy: { idempotent: true } },
        ],
    },
    {
        id: 'object-storage',
        level: 5,
        title: { ru: 'Объектное хранилище', en: 'Object storage' },
        brief: {
            ru: 'Разместите крупные неизменяемые объекты отдельно от метаданных и заложите восстановление после потери дисков.',
            en: 'Keep large immutable objects apart from metadata and plan recovery after disk loss.',
        },
        lesson: { ru: 'Объекты уходят в распределённое S3-совместимое хранилище', en: 'Objects go to distributed S3-compatible storage' },
        tags: ['storage', 'erasure-coding', 'durability', 'metadata'],
        specialtyType: 'minio',
        specialtyName: { ru: 'Erasure-coded объектное хранилище', en: 'Erasure-coded object storage' },
        nodes: [{ id: 'objects', type: 'minio', position: { x: 680, y: 180 } }],
        links: [{ from: 'service', to: 'objects', policy: { idempotent: true } }],
    },
    {
        id: 'global-feed-billion',
        level: 5,
        title: { ru: 'Глобальная лента на миллиард пользователей', en: 'Global feed for one billion users' },
        brief: {
            ru: 'Разнесите публикацию и построение лент, выдержите fanout и храните результат по ключу пользователя.',
            en: 'Separate publishing from feed construction, absorb fanout, and store the result by user key.',
        },
        lesson: { ru: 'Публикации буферизуются в Kafka до fanout-воркеров', en: 'Posts are buffered in Kafka before fanout workers' },
        tags: ['feed', 'fanout', 'kafka', 'cassandra'],
        specialtyType: 'kafka',
        specialtyName: { ru: 'Асинхронный fanout ленты', en: 'Asynchronous feed fanout' },
        nodes: [
            { id: 'posts', type: 'kafka', position: { x: 680, y: 180 } },
            {
                id: 'fanout',
                type: 'worker',
                params: { instances: 16, concurrency: 64, processingTimeMs: 20, cpuCores: 8 },
                position: { x: 920, y: 180 },
            },
            { id: 'feeds', type: 'cassandra', position: { x: 1160, y: 180 } },
        ],
        links: [
            { from: 'service', to: 'posts', policy: { idempotent: true } },
            { from: 'posts', to: 'fanout' },
            { from: 'fanout', to: 'feeds' },
        ],
    },
    {
        id: 'fraud-detection',
        level: 5,
        title: { ru: 'Антифрод в реальном времени', en: 'Real-time fraud detection' },
        brief: {
            ru: 'Оцените транзакцию моделью до подтверждения, ограничив tail latency и предусмотрев деградацию при недоступности GPU.',
            en: 'Score a transaction before approval, bound tail latency, and plan graceful degradation when GPUs are unavailable.',
        },
        lesson: { ru: 'Поток проходит через выделенный ML-инференс', en: 'The flow passes through dedicated ML inference' },
        tags: ['fraud', 'ml', 'latency', 'degradation'],
        specialtyType: 'ml-inference',
        specialtyName: { ru: 'Онлайн ML-инференс', en: 'Online ML inference' },
        nodes: [{ id: 'scoring', type: 'ml-inference', position: { x: 680, y: 180 } }],
        links: [{ from: 'service', to: 'scoring' }],
    },
    {
        id: 'collaborative-editing',
        level: 5,
        title: { ru: 'Совместное редактирование', en: 'Collaborative editing' },
        brief: {
            ru: 'Поддержите долгие двусторонние соединения и общий упорядоченный поток операций без потери изменений.',
            en: 'Support long-lived bidirectional connections and one ordered stream of operations without losing edits.',
        },
        lesson: { ru: 'Клиент подключается через WebSocket-шлюз', en: 'The client connects through a WebSocket gateway' },
        tags: ['websocket', 'collaboration', 'ordering', 'conflicts'],
        specialtyType: 'ws-gateway',
        specialtyName: { ru: 'WebSocket-шлюз и журнал операций', en: 'WebSocket gateway and operation log' },
        nodes: [
            { id: 'socket', type: 'ws-gateway', position: { x: 680, y: 180 } },
            { id: 'operations', type: 'redis-streams', position: { x: 920, y: 180 } },
        ],
        links: [
            { from: 'service', to: 'operations', policy: { idempotent: true } },
            { from: 'operations', to: 'socket' },
        ],
    },
];

export const advancedChallenges = SPECS.map(challenge);
