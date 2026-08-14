import { buildScheme } from '../../services/schemeBuilder';
import type { Challenge } from '../../engine/challenges/types';
import type { ComponentParams } from '../../engine/types/component';
import type { NodeSpec, LinkSpec } from '../../services/schemeBuilder';
import type { SchemeV1 } from '../../engine/types/scheme';

const PAYERS = 'payers';

const payerParams = {
    dau: 5000000,
    sessionsPerUserDay: 3,
    requestsPerSession: 10,
    avgRequestKb: 2,
    avgResponseKb: 4,
    readWriteMix: 0.5,
    cacheableShare: 0.2,
    peakFactor: 2.5,
    diurnalPattern: 'global',
    geoDistribution: 'global',
    networkRttMs: 55,
};

const databaseParams = {
    readReplicas: 2,
    readFromReplica: 0.08,
    replicaLagMs: 150,
    cpuCores: 24,
    replicaLagSigma: 0.8,
    provisionedIops: 40000,
    rowCount: 400000000,
    storageGb: 4000,
    concurrencyControl: 'optimistic',
    isolationLevel: 'serializable',
    failoverSec: 40,
};

function regionNodes(suffix: string, regionId: string): NodeSpec[] {
    return [
        {
            id: `pay-${suffix}`,
            type: 'service',
            parentId: regionId,
            params: { serviceTimeMs: 16, instances: 6, autoscaleMax: 60 },
            position: { x: 40, y: 70 },
        },
        {
            id: `db-${suffix}`,
            type: 'postgres',
            parentId: regionId,
            params: databaseParams,
            position: { x: 300, y: 70 },
        },
        {
            id: `events-${suffix}`,
            type: 'kafka',
            parentId: regionId,
            params: { partitions: 24, messageSizeKb: 2, retentionHours: 168 },
            position: { x: 40, y: 190 },
        },
        {
            id: `ledger-${suffix}`,
            type: 'worker',
            parentId: regionId,
            params: { instances: 28, concurrency: 24, cpuCores: 4, processingTimeMs: 25, idempotent: true, dlqEnabled: true },
            position: { x: 300, y: 190 },
        },
    ];
}

function regionLinks(suffix: string): LinkSpec[] {
    return [
        { from: 'router', to: `pay-${suffix}`, weight: 1, readShare: 0.5 },
        { from: `pay-${suffix}`, to: `db-${suffix}`, readShare: 0.5 },
        { from: `pay-${suffix}`, to: `events-${suffix}`, calls: { fanout: 0.5 } },
        { from: `events-${suffix}`, to: `ledger-${suffix}` },
        { from: `ledger-${suffix}`, to: `db-${suffix}`, readShare: 0 },
    ];
}

function activeActive(id: string, name: string, policyParams: ComponentParams): SchemeV1 {
    return buildScheme({
        id,
        name,
        nodes: [
            { id: PAYERS, type: 'client-mobile', params: payerParams, position: { x: 0, y: 300 } },
            {
                id: 'policy',
                type: 'multi-region-policy',
                params: {
                    mode: 'active-active',
                    replicationDirection: 'bidirectional',
                    failoverMode: 'auto',
                    failbackPolicy: 'manual',
                    dataResidency: 'strict',
                    rpoTargetSec: 5,
                    rtoTargetSec: 300,
                    ...policyParams,
                },
                position: { x: 280, y: 40 },
            },
            {
                id: 'router',
                type: 'glb',
                params: { routingPolicy: 'geo', stickyRegion: true, failoverSec: 20 },
                position: { x: 280, y: 300 },
            },
            {
                id: 'region-eu',
                type: 'region',
                position: { x: 560, y: 100 },
                size: { width: 560, height: 300 },
                params: { code: 'eu-west-1', geo: 'europe', isPrimary: true, dataResidency: 'gdpr' },
            },
            {
                id: 'region-us',
                type: 'region',
                position: { x: 560, y: 460 },
                size: { width: 560, height: 300 },
                params: { code: 'us-east-1', geo: 'north-america', isPrimary: false, dataResidency: 'gdpr' },
            },
            ...regionNodes('eu', 'region-eu'),
            ...regionNodes('us', 'region-us'),
        ],
        links: [
            { from: PAYERS, to: 'router', readShare: 0.5 },
            ...regionLinks('eu'),
            ...regionLinks('us'),
            { from: 'db-eu', to: 'db-us' },
            { from: 'db-us', to: 'db-eu' },
        ],
    });
}

function starter(): SchemeV1 {
    return buildScheme({
        id: 'multi-region',
        name: 'Мультирегион active-active',
        nodes: [{ id: PAYERS, type: 'client-mobile', params: payerParams, position: { x: 0, y: 300 } }],
        links: [],
    });
}

function lastWriteWins(): SchemeV1 {
    return activeActive('multi-region-lww', 'Active-active с разрешением конфликтов по времени', {
        conflictResolution: 'lww',
    });
}

function singleWriterPerKey(): SchemeV1 {
    return activeActive('multi-region-owner', 'Active-active с владельцем ключа', {
        conflictResolution: 'single-writer-per-key',
        writeRegion: 'owner-of-key',
    });
}

export const multiRegion: Challenge = {
    id: 'multi-region',
    level: 5,
    estimatedMinutes: 90,
    tags: ['multi-region', 'consistency', 'rpo-rto', 'geo', 'conflicts'],
    title: { ru: 'Мультирегион active-active', en: 'Active-active multi-region' },
    brief: {
        ru: 'Платёжный сервис живёт в двух регионах сразу: Европа и Северная Америка, 1 700 запросов в секунду, половина из них — записи. Клиента маршрутизируем в ближайший регион, данные держим в обоих. Дальше начинается интересное: между регионами 80 мс, и пока запись едет через океан, тот же счёт успевают изменить с другой стороны. Задание сдаётся не декларацией «у нас strong consistency», а наблюдаемым поведением: движок считает конфликты записи, потерянные записи, устаревшие чтения и дубли обработки.',
        en: 'A payment service lives in two regions at once: Europe and North America, 1,700 requests per second, half of them writes. Clients are routed to the nearest region and the data is kept in both. That is where it gets interesting: the regions are 80 ms apart, and while a write crosses the ocean the same account gets changed on the other side. This one is graded not by declaring "we have strong consistency" but by observed behaviour: the engine counts write conflicts, lost writes, stale reads and duplicate processing.',
    },
    given: {
        dau: payerParams.dau,
        requestsPerUserDay: payerParams.sessionsPerUserDay * payerParams.requestsPerSession,
        avgRps: 1736,
        writeShare: 0.5,
        regions: 2,
        crossRegionRttMs: 80,
        clientRttMs: payerParams.networkRttMs,
        rpoTargetSec: 5,
        rtoTargetSec: 300,
        peakFactor: payerParams.peakFactor,
    },
    flows: [{ id: PAYERS, name: { ru: 'Платёж', en: 'Payment' }, weightInScore: 1 }],
    constraints: {
        maxNodes: 16,
        allowedGroups: [
            'clients',
            'edge',
            'compute',
            'sql',
            'nosql',
            'cache',
            'messaging',
            'storage',
            'platform',
            'observability',
            'topology',
        ],
    },
    requiredConsistencyModel: 'anomalies',
    requirements: [
        {
            id: 'R1',
            kind: 'anomaly',
            desc: {
                ru: 'Даже при одновременной записи в оба региона конфликтов нет',
                en: 'Even with simultaneous writes to both regions there are no conflicts',
            },
            code: 'write-conflict',
            maxRatePerSec: 0,
            scenario: 'write-conflict',
        },
        {
            id: 'R2',
            kind: 'anomaly',
            desc: {
                ru: 'Ни одна запись не пропадает молча при разрешении конфликта по времени',
                en: 'No write silently disappears under last-write-wins resolution',
            },
            code: 'lost-write-lww',
            maxRatePerSec: 0,
        },
        {
            id: 'R3',
            kind: 'anomaly',
            desc: {
                ru: 'Одновременные списания с одного счёта не теряются',
                en: 'Concurrent debits from the same account are not lost',
            },
            code: 'lost-update',
            maxRatePerSec: 0,
        },
        {
            id: 'R4',
            kind: 'anomaly',
            desc: {
                ru: 'Плательщик видит собственный платёж: не больше 0.2% чтений после записи промахиваются',
                en: 'The payer sees their own payment: no more than 0.2% of read-after-write requests miss',
            },
            code: 'read-your-writes',
            maxSharePercent: 0.2,
        },
        {
            id: 'R5',
            kind: 'rpo-rto',
            desc: {
                ru: 'При потере региона теряется не больше 5 секунд записей, переключение — за 5 минут',
                en: 'Losing a region costs at most 5 seconds of writes and 5 minutes to switch over',
            },
            maxRpoSec: 5,
            maxRtoSec: 300,
        },
        {
            id: 'R6',
            kind: 'geo',
            desc: {
                ru: 'Два региона, объявленная резидентность данных и не больше 80 мс до входной точки',
                en: 'Two regions, declared data residency and no more than 80 ms to the entry point',
            },
            minRegions: 2,
            residency: true,
            maxClientRttMs: 80,
        },
        {
            id: 'R7',
            kind: 'capacity',
            desc: { ru: 'Ни один блок не загружен выше 75%', en: 'No block runs hotter than 75%' },
            maxUtilization: 0.75,
        },
    ],
    bonusObjectives: [
        {
            id: 'B1',
            kind: 'anomaly',
            desc: {
                ru: 'Устаревших чтений не больше 1% — реплики отстают незаметно для пользователя',
                en: 'No more than 1% stale reads — replicas lag imperceptibly',
            },
            code: 'stale-read',
            maxSharePercent: 1,
        },
        {
            id: 'B2',
            kind: 'anomaly',
            desc: {
                ru: 'Повторная доставка не превращается в повторную обработку платежа',
                en: 'Redelivery does not turn into reprocessing a payment',
            },
            code: 'duplicate-processing',
            maxRatePerSec: 0,
        },
    ],
    scenarios: { required: ['region-failure', 'write-conflict', 'peak'], bonus: ['stale-read'] },
    relaxation: {
        peak: { utilizationFactor: 1.2 },
        'region-failure': { latencyFactor: 2, utilizationFactor: 1.3 },
        'write-conflict': { latencyFactor: 1.5, utilizationFactor: 1.2 },
        'stale-read': { latencyFactor: 1.5, utilizationFactor: 1.2 },
    },
    lockedParams: { [PAYERS]: payerParams },
    starter,
    hints: [
        {
            level: 1,
            cost: 5,
            text: {
                ru: 'Что произойдёт со счётом, если его изменят в Европе и в Америке в течение одной и той же сотни миллисекунд — и какое из двух изменений уцелеет?',
                en: 'What happens to an account changed in Europe and in America within the same hundred milliseconds — and which of the two changes survives?',
            },
        },
        {
            level: 2,
            cost: 10,
            text: {
                ru: 'Молчаливый last-write-wins в active-active — это не стратегия, а её отсутствие: половина конфликтов заканчивается потерянной записью. Выбор небольшой: развести ключи по владельцам-регионам, взять CRDT или честно сказать «конфликты разрешает человек».',
                en: 'Silent last-write-wins in active-active is not a strategy but the absence of one: half the conflicts end in a lost write. The choice is small: split keys by owning region, take CRDTs, or honestly say "a human resolves conflicts".',
            },
            forRequirement: 'R2',
        },
        {
            level: 3,
            cost: 20,
            text: {
                ru: 'Назначьте каждому ключу регион-владельца (conflictResolution = single-writer-per-key) — записи одного счёта идут в один регион и конфликтовать становится не с чем. Резидентность объявите в политике мультирегиона, а лаг реплики держите не ниже половины межрегионального RTT — иначе движок поймает вас на физике.',
                en: 'Give every key an owning region (conflictResolution = single-writer-per-key) — writes for one account go to one region and there is nothing left to conflict with. Declare residency in the multi-region policy and keep the replica lag no lower than half the cross-region RTT, otherwise the engine will catch you on physics.',
            },
            forRequirement: 'R1',
        },
    ],
    referenceSolutions: [
        {
            id: 'last-write-wins',
            name: { ru: 'Active-active с разрешением по времени', en: 'Active-active with last-write-wins' },
            tradeoff: {
                ru: 'Самая дешёвая в реализации схема: пишем где угодно, побеждает более поздняя отметка времени. Ровно поэтому часть платежей исчезает без следа — и никакой алерт об этом не расскажет.',
                en: 'The cheapest scheme to build: write anywhere, the later timestamp wins. Which is exactly why some payments vanish without a trace — and no alert will tell you about it.',
            },
            build: lastWriteWins,
        },
        {
            id: 'single-writer-per-key',
            name: { ru: 'Active-active с владельцем ключа', en: 'Active-active with a key owner' },
            tradeoff: {
                ru: 'Каждый счёт имеет регион-владельца, поэтому конкурирующих записей не возникает вовсе. Платите за это маршрутизацией по ключу, двукратным запасом мощности в каждом регионе и тем, что при потере региона его ключи ждут переназначения владельца. Линтер при этом справедливо ворчит: строгая резидентность и репликация через океан друг другу противоречат — придётся выбрать, что важнее.',
                en: 'Every account has an owning region, so competing writes never appear. You pay for it with key-based routing, twice the capacity in every region, and the fact that losing a region leaves its keys waiting for a new owner. The linter grumbles for good reason: strict residency and replication across the ocean contradict each other, and you have to pick which one matters more.',
            },
            build: singleWriterPerKey,
        },
    ],
};
