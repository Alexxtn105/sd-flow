import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { SchemeV1 } from '../../engine/types/scheme';

const USERS = 'users';

const userParams = {
    dau: 20000000,
    sessionsPerUserDay: 3,
    requestsPerSession: 5,
    avgRequestKb: 1,
    avgResponseKb: 3,
    readWriteMix: 0.8,
    cacheableShare: 0.4,
    peakFactor: 3,
    geoDistribution: 'global',
};

const clientCalls = { requestBytes: 1000, responseBytes: 3000 };
const providerCalls = { requestBytes: 1500, responseBytes: 400 };
const notificationShare = 0.12;
const deadLetterShare = 0.002;

function starter(): SchemeV1 {
    return buildScheme({
        id: 'notifications',
        name: 'Сервис уведомлений',
        nodes: [{ id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 200 } }],
        links: [],
    });
}

function queueAndWorkers(): SchemeV1 {
    return buildScheme({
        id: 'notifications-queue',
        name: 'Очередь, пул отправщиков и разбор ошибок',
        nodes: [
            { id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 200 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: { instances: 5, maxRpsPerInstance: 3000 },
                position: { x: 240, y: 200 },
            },
            {
                id: 'notify-api',
                type: 'service',
                params: { instances: 5, autoscaleMax: 40, serviceTimeMs: 20 },
                position: { x: 500, y: 200 },
            },
            {
                id: 'outbox',
                type: 'sqs',
                params: { messageSizeKb: 2, visibilityTimeoutSec: 30, maxReceiveCount: 5, retentionHours: 96 },
                position: { x: 760, y: 200 },
            },
            {
                id: 'sender',
                type: 'worker',
                params: {
                    instances: 10,
                    concurrency: 32,
                    cpuCores: 2,
                    cpuShare: 0.2,
                    processingTimeMs: 60,
                    retries: 3,
                },
                position: { x: 1020, y: 200 },
            },
            {
                id: 'provider',
                type: 'external-api',
                params: {
                    p50Ms: 120,
                    p99Ms: 800,
                    rateLimitRps: 1600,
                    quotaPerDay: 200000000,
                    costPerCall: 0.00001,
                },
                position: { x: 1280, y: 200 },
            },
            {
                id: 'parked',
                type: 'dlq',
                params: { maxDepth: 5000000, retentionHours: 72, messageSizeKb: 2, maxRetries: 5 },
                position: { x: 760, y: 380 },
            },
        ],
        links: [
            { from: USERS, to: 'gateway', readShare: 0.8, calls: clientCalls },
            { from: 'gateway', to: 'notify-api', readShare: 0.8, calls: clientCalls },
            { from: 'notify-api', to: 'outbox', calls: { fanout: notificationShare, requestBytes: 2000 } },
            { from: 'outbox', to: 'sender' },
            { from: 'outbox', to: 'parked', calls: { fanout: deadLetterShare } },
            { from: 'sender', to: 'provider', readShare: 0, calls: providerCalls },
        ],
    });
}

function directSend(): SchemeV1 {
    return buildScheme({
        id: 'notifications-direct',
        name: 'Отправка прямо из обработчика запроса',
        nodes: [
            { id: USERS, type: 'client-web', params: userParams, position: { x: 0, y: 200 } },
            {
                id: 'gateway',
                type: 'api-gateway',
                params: { instances: 5, maxRpsPerInstance: 3000 },
                position: { x: 240, y: 200 },
            },
            {
                id: 'notify-api',
                type: 'service',
                params: { instances: 5, autoscaleMax: 40, serviceTimeMs: 20 },
                position: { x: 500, y: 200 },
            },
            {
                id: 'provider',
                type: 'external-api',
                params: {
                    p50Ms: 120,
                    p99Ms: 800,
                    rateLimitRps: 1600,
                    quotaPerDay: 200000000,
                    costPerCall: 0.00001,
                },
                position: { x: 760, y: 200 },
            },
        ],
        links: [
            { from: USERS, to: 'gateway', readShare: 0.8, calls: clientCalls },
            { from: 'gateway', to: 'notify-api', readShare: 0.8, calls: clientCalls },
            { from: 'notify-api', to: 'provider', readShare: 0, calls: { ...providerCalls, fanout: notificationShare } },
        ],
    });
}

export const notifications: Challenge = {
    id: 'notifications',
    level: 2,
    estimatedMinutes: 30,
    tags: ['async', 'queue', 'external', 'reliability'],
    title: { ru: 'Сервис уведомлений', en: 'Notification service' },
    brief: {
        ru: 'Двадцать миллионов человек в сутки что-то делают в приложении, и примерно каждое восьмое действие рождает уведомление — около 400 отправок в секунду. Отправляет их чужой провайдер: он медленный, у него жёсткий лимит, и он иногда отвечает ошибкой. Пользователь при этом не должен ждать ни его, ни повторов.',
        en: 'Twenty million people a day do things in the app and roughly every eighth action produces a notification — about 400 sends per second. A third-party provider delivers them: it is slow, it has a hard rate limit, and it sometimes fails. Meanwhile the user must wait for neither the provider nor the retries.',
    },
    given: {
        dau: userParams.dau,
        requestsPerUserDay: userParams.sessionsPerUserDay * userParams.requestsPerSession,
        avgRps: 3472,
        notificationShare,
        providerLimitRps: 1600,
        peakFactor: userParams.peakFactor,
    },
    flows: [{ id: USERS, name: { ru: 'Действие с уведомлением', en: 'Action that notifies' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 12,
        allowedGroups: ['clients', 'edge', 'compute', 'messaging', 'platform', 'cache', 'sql', 'nosql', 'topology'],
    },
    requirements: [
        {
            id: 'R1',
            kind: 'capability',
            desc: {
                ru: 'Отправка идёт в фоне: ответ пользователю не ждёт ни провайдера, ни повторов',
                en: 'Delivery happens in the background: the user response waits for neither the provider nor the retries',
            },
            flow: USERS,
            to: { group: 'compute' },
            viaAny: [{ group: 'messaging' }],
            asyncBefore: { type: 'worker' },
        },
        {
            id: 'R2',
            kind: 'slo',
            desc: { ru: 'p99 ответа пользователю не выше 220 мс', en: 'User response p99 stays under 220 ms' },
            flow: USERS,
            metric: 'latency.p99',
            max: 220,
        },
        {
            id: 'R3',
            kind: 'capacity',
            desc: {
                ru: 'Ни один блок не загружен выше 75% — включая лимит внешнего провайдера',
                en: 'No block runs hotter than 75% — including the external provider quota',
            },
            maxUtilization: 0.75,
        },
        {
            id: 'R4',
            kind: 'freshness',
            desc: {
                ru: 'Очередь не копится: отправщики разбирают её быстрее, чем она наполняется',
                en: 'The queue does not pile up: senders drain it faster than it fills',
            },
            maxLagSec: 0.8,
        },
        {
            id: 'R5',
            kind: 'anomaly',
            desc: {
                ru: 'Повторная доставка сообщения не превращается во второе уведомление',
                en: 'A redelivered message does not turn into a second notification',
            },
            code: 'duplicate-processing',
            maxSharePercent: 0.5,
        },
        {
            id: 'R6',
            kind: 'budget',
            desc: { ru: 'Стоимость не выше $52 000 в месяц', en: 'Monthly cost stays under $52,000' },
            maxMonthlyCostUsd: 52000,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'slo',
            desc: { ru: 'Медианный ответ укладывается в 90 мс', en: 'Median response stays under 90 ms' },
            flow: USERS,
            metric: 'latency.p50',
            max: 90,
        },
        {
            id: 'B2',
            kind: 'capacity',
            desc: { ru: 'Самый горячий блок не переваливает за 60%', en: 'The hottest block stays under 60%' },
            maxUtilization: 0.6,
        },
    ],
    scenarios: { required: ['peak', 'az-failure'], bonus: ['cache-flush'] },
    relaxation: {
        peak: { utilizationFactor: 1.2 },
        'az-failure': { latencyFactor: 2.5, utilizationFactor: 1.3 },
        'cache-flush': { latencyFactor: 2, utilizationFactor: 1.3 },
    },
    lockedParams: { [USERS]: userParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Посчитайте две вещи отдельно: сколько времени занимает ваша работа и сколько — работа чужого сервиса, за которую вы не отвечаете.',
                en: 'Count two things separately: how long your own work takes, and how long the work of a third party you do not control takes.',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'У провайдера лимит на секунду. На пике вы приносите втрое больше, чем в среднем: либо буфер держит всплеск, либо вы получаете отказы, которые придётся повторять — а повтор без защиты от дублей превращается в второе письмо.',
                en: 'The provider caps per second. At peak you bring three times the average: either a buffer absorbs the spike or you get rejections you must retry — and a retry without duplicate protection turns into a second message.',
            },
            forRequirement: 'R3',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Отвечайте пользователю сразу после того, как задание принято в очередь. Отправщики читают её своим темпом, число повторов ограничено, а то, что не отправилось после всех попыток, откладывается отдельно и разбирается руками.',
                en: 'Answer the user as soon as the job is accepted into the queue. Senders drain it at their own pace, the retry count is capped, and whatever fails after every attempt is parked aside and handled by hand.',
            },
            forRequirement: 'R1',
        },
    ],
    referenceSolutions: [
        {
            id: 'queue-and-workers',
            name: { ru: 'Очередь, пул отправщиков и разбор ошибок', en: 'Queue, sender pool and a parking lot' },
            tradeoff: {
                ru: 'Ответ пользователю не зависит от чужого сервиса, всплеск съедает очередь, повторы ограничены, а безнадёжные сообщения ложатся отдельно и не крутятся вечно. Цена — три лишних блока и доставка, которая теперь «когда-нибудь скоро», а не «прямо сейчас».',
                en: 'The user response no longer depends on a third party, the queue absorbs the spike, retries are capped and hopeless messages are parked instead of spinning forever. The price is three extra blocks and delivery that is now "soon" rather than "right now".',
            },
            build: queueAndWorkers,
        },
        {
            id: 'direct-send',
            name: { ru: 'Отправка прямо из обработчика запроса', en: 'Sending straight from the request handler' },
            tradeoff: {
                ru: 'Два блока и никакой инфраструктуры, доставка мгновенная и наблюдаемая. Но пользователь ждёт чужой сервис вместе с вами, всплеск упирается в его лимит в ту же секунду, а упавшую отправку некуда положить.',
                en: 'Two blocks and no infrastructure, delivery is instant and observable. But the user waits for the third party together with you, a spike hits its rate limit in the very same second, and a failed send has nowhere to go.',
            },
            build: directSend,
        },
    ],
};
