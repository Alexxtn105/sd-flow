import type { ComponentDefinition, PortSpec } from '../types/component';
import { SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explain,
    memoryResidencyBound,
    quotaBound,
    resourceLimit,
    totalCost,
} from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const OBSERVABILITY_PORTS: PortSpec = {
    in: [{ id: 'ingest', protocols: ['telemetry'], role: 'serve' }],
    out: [],
};

const INDEX_FIELD_COST: Record<string, number> = {
    'labels-only': 0.05,
    'full-text': 0.3,
};

const TSDB_INGEST_MBS = 4;

const DOWNSAMPLED_SIZE_SHARE = 0.1;

const DAYS_PER_YEAR = 365;

const IMMUTABLE_WRITE_AMPLIFICATION = 1.2;

const logsDefaults = {
    samplingRate: 1,
    indexMode: 'labels-only',
    indexedFields: 12,
    compressionRatio: 8,
    hotRetentionDays: 7,
    retentionDays: 30,
    replicationFactor: 2,
    maxIngestMbs: 500,
    ingestLagSec: 15,
    queryConcurrency: 10,
    availability: 0.999,
    costPerGbIngest: 0.5,
    costPerGbMonth: 0.03,
};

function logsIndexAmplification(params: typeof logsDefaults): number {
    return 1 + params.indexedFields * (INDEX_FIELD_COST[params.indexMode] ?? 0);
}

const logsModel = defineModel<typeof logsDefaults>({
    serviceSec: (ctx) =>
        (ctx.requestBytes * ctx.params.samplingRate * logsIndexAmplification(ctx.params)) /
        (ctx.params.maxIngestMbs * 1e6),
    resources: (ctx) => [
        bandwidthBound(
            'ingest-bandwidth',
            ctx.params.maxIngestMbs * 8,
            (ctx.requestBytes * ctx.params.samplingRate * ctx.params.replicationFactor) /
                ctx.params.compressionRatio,
        ),
        bandwidthBound(
            'indexing',
            ctx.params.maxIngestMbs * 8,
            ctx.requestBytes * ctx.params.samplingRate * logsIndexAmplification(ctx.params),
        ),
    ],
    storage: (ctx) => {
        const ingestGbDay =
            (ctx.lambda * SECONDS_PER_DAY * ctx.requestBytes * ctx.params.samplingRate) / 1e9;
        const growthGbDay = (ingestGbDay * ctx.params.replicationFactor) / ctx.params.compressionRatio;
        const retainedDays = Math.min(ctx.horizonDays, ctx.params.retentionDays);

        return {
            totalGb: growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'ingestRps × 86400 × lineBytes × samplingRate × RF / compressionRatio / 10⁹',
                    {
                        ingestRps: ctx.lambda,
                        lineBytes: ctx.requestBytes,
                        samplingRate: ctx.params.samplingRate,
                        RF: ctx.params.replicationFactor,
                        compressionRatio: ctx.params.compressionRatio,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × min(horizonDays, retentionDays)',
                    {
                        growthGbDay,
                        horizonDays: ctx.horizonDays,
                        retentionDays: ctx.params.retentionDays,
                    },
                    growthGbDay * retainedDays,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const ingestGbMonth =
            (ctx.lambda * SECONDS_PER_MONTH * ctx.requestBytes * ctx.params.samplingRate) / 1e9;

        return totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: ingestGbMonth * ctx.params.costPerGbIngest,
        });
    },
    availability: (params) => params.availability,
});

const logs = defineComponent({
    id: 'logs',
    group: 'observability',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-logs',
    ports: OBSERVABILITY_PORTS,
    defaultParams: logsDefaults,
    paramSchema: {
        samplingRate: num('behaviour', { min: 0.001, max: 1, step: 0.001 }),
        indexMode: choice('data', ['labels-only', 'full-text']),
        indexedFields: num('data', { min: 0, max: 1000 }),
        compressionRatio: num('data', { min: 1, max: 50, step: 0.5, realistic: { min: 5, max: 10 } }),
        hotRetentionDays: num('data', { min: 0, max: 3650 }),
        retentionDays: num('data', { min: 1, max: 3650 }),
        replicationFactor: num('reliability', { min: 1, max: 5 }),
        maxIngestMbs: num('capacity', { min: 1, max: 100000 }),
        ingestLagSec: num('performance', { unitKey: 'sec', min: 0, max: 3600 }),
        queryConcurrency: num('capacity', { min: 1, max: 1000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbIngest: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.01 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: logsModel,
    helpId: 'logs',
});

const metricsDefaults = {
    activeSeries: 2000000,
    labelsPerSeries: 8,
    scrapeIntervalSec: 15,
    bytesPerSample: 1.7,
    retentionDays: 400,
    downsampleAfterDays: 30,
    cardinalityAlarm: 5000000,
    memoryPerMillionSeriesGb: 4,
    replicationFactor: 2,
    queryConcurrency: 20,
    availability: 0.999,
    costPerThousandSeries: 0.9,
    costPerGbMonth: 0.03,
};

const metricsModel = defineModel<typeof metricsDefaults>({
    serviceSec: (ctx) =>
        (ctx.requestBytes * ctx.params.replicationFactor) / (TSDB_INGEST_MBS * 1e6),
    resources: (ctx) => {
        const samplesPerRequest = ctx.requestBytes / ctx.params.bytesPerSample;

        return [
            bandwidthBound(
                'sample-ingest',
                TSDB_INGEST_MBS * 8,
                ctx.requestBytes * ctx.params.replicationFactor,
            ),
            memoryResidencyBound(
                'memory',
                (ctx.params.cardinalityAlarm / 1e6) * ctx.params.memoryPerMillionSeriesGb,
                (samplesPerRequest * ctx.params.scrapeIntervalSec * ctx.params.memoryPerMillionSeriesGb) / 1e6,
            ),
        ];
    },
    storage: (ctx) => {
        const samplesPerSec = ctx.params.activeSeries / ctx.params.scrapeIntervalSec;
        const growthGbDay =
            (samplesPerSec * SECONDS_PER_DAY * ctx.params.bytesPerSample * ctx.params.replicationFactor) / 1e9;
        const retainedDays = Math.min(ctx.horizonDays, ctx.params.retentionDays);
        const rawDays = Math.min(retainedDays, ctx.params.downsampleAfterDays);
        const downsampledDays = retainedDays - rawDays;
        const totalGb = growthGbDay * (rawDays + downsampledDays * DOWNSAMPLED_SIZE_SHARE);

        return {
            totalGb,
            growthGbDay,
            memoryGb: (ctx.params.activeSeries / 1e6) * ctx.params.memoryPerMillionSeriesGb,
            explain: [
                explain(
                    'activeSeries / scrapeIntervalSec × 86400 × bytesPerSample × RF / 10⁹',
                    {
                        activeSeries: ctx.params.activeSeries,
                        scrapeIntervalSec: ctx.params.scrapeIntervalSec,
                        bytesPerSample: ctx.params.bytesPerSample,
                        RF: ctx.params.replicationFactor,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × (rawDays + downsampledDays × downsampledSizeShare)',
                    {
                        growthGbDay,
                        rawDays,
                        downsampledDays,
                        downsampledSizeShare: DOWNSAMPLED_SIZE_SHARE,
                    },
                    totalGb,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: (ctx.params.activeSeries / 1000) * ctx.params.costPerThousandSeries,
        }),
    availability: (params) => params.availability,
});

const metrics = defineComponent({
    id: 'metrics',
    group: 'observability',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-metrics',
    ports: OBSERVABILITY_PORTS,
    defaultParams: metricsDefaults,
    paramSchema: {
        activeSeries: num('scale', { min: 1000, max: 1000000000, realistic: { min: 100000, max: 20000000 } }),
        labelsPerSeries: num('data', { min: 1, max: 100 }),
        scrapeIntervalSec: num('behaviour', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 10, max: 60 } }),
        bytesPerSample: num('data', { unitKey: 'bytes', min: 0.5, max: 20, step: 0.1, realistic: { min: 1.7, max: 2 } }),
        retentionDays: num('data', { min: 1, max: 3650 }),
        downsampleAfterDays: num('data', { min: 0, max: 3650 }),
        cardinalityAlarm: num('reliability', { min: 1000, max: 1000000000 }),
        memoryPerMillionSeriesGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 64, step: 0.5 }),
        replicationFactor: num('reliability', { min: 1, max: 5 }),
        queryConcurrency: num('capacity', { min: 1, max: 1000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerThousandSeries: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: metricsModel,
    helpId: 'metrics',
});

const tracesDefaults = {
    samplingRate: 0.1,
    spansPerRequest: 20,
    spanBytes: 800,
    tailSampling: false,
    compressionRatio: 6,
    retentionDays: 7,
    maxIngestMbs: 400,
    maxSpansPerSec: 2000000,
    availability: 0.999,
    costPerGbIngest: 0.4,
    costPerGbMonth: 0.03,
};

function tracesIngestedSpansPerRequest(params: typeof tracesDefaults): number {
    return params.spansPerRequest * (params.tailSampling ? 1 : params.samplingRate);
}

function tracesIngestBytesPerRequest(params: typeof tracesDefaults): number {
    return tracesIngestedSpansPerRequest(params) * params.spanBytes;
}

function tracesStoredBytesPerRequest(params: typeof tracesDefaults): number {
    return (params.spansPerRequest * params.spanBytes * params.samplingRate) / params.compressionRatio;
}

const tracesModel = defineModel<typeof tracesDefaults>({
    serviceSec: (ctx) => tracesIngestBytesPerRequest(ctx.params) / (ctx.params.maxIngestMbs * 1e6),
    resources: (ctx) => [
        bandwidthBound(
            'ingest-bandwidth',
            ctx.params.maxIngestMbs * 8,
            tracesIngestBytesPerRequest(ctx.params),
        ),
        resourceLimit(
            'span-ingest',
            ctx.params.maxSpansPerSec / tracesIngestedSpansPerRequest(ctx.params),
            'maxSpansPerSec / ingestedSpansPerRequest',
            {
                maxSpansPerSec: ctx.params.maxSpansPerSec,
                ingestedSpansPerRequest: tracesIngestedSpansPerRequest(ctx.params),
            },
        ),
    ],
    storage: (ctx) => {
        const growthGbDay =
            (ctx.lambda * SECONDS_PER_DAY * tracesStoredBytesPerRequest(ctx.params)) / 1e9;
        const retainedDays = Math.min(ctx.horizonDays, ctx.params.retentionDays);
        const totalGb = growthGbDay * retainedDays;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'ingestRps × 86400 × spansPerRequest × spanBytes × samplingRate / compressionRatio / 10⁹',
                    {
                        ingestRps: ctx.lambda,
                        spansPerRequest: ctx.params.spansPerRequest,
                        spanBytes: ctx.params.spanBytes,
                        samplingRate: ctx.params.samplingRate,
                        compressionRatio: ctx.params.compressionRatio,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × min(horizonDays, retentionDays)',
                    {
                        growthGbDay,
                        horizonDays: ctx.horizonDays,
                        retentionDays: ctx.params.retentionDays,
                    },
                    totalGb,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const ingestGbMonth =
            (ctx.lambda * SECONDS_PER_MONTH * tracesIngestBytesPerRequest(ctx.params)) / 1e9;

        return totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: ingestGbMonth * ctx.params.costPerGbIngest,
        });
    },
    availability: (params) => params.availability,
});

const traces = defineComponent({
    id: 'traces',
    group: 'observability',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-traces',
    ports: OBSERVABILITY_PORTS,
    defaultParams: tracesDefaults,
    paramSchema: {
        samplingRate: num('behaviour', { min: 0.001, max: 1, step: 0.001, realistic: { min: 0.01, max: 0.2 } }),
        spansPerRequest: num('data', { min: 1, max: 1000, realistic: { min: 5, max: 60 } }),
        spanBytes: num('data', { unitKey: 'bytes', min: 50, max: 100000, realistic: { min: 500, max: 1500 } }),
        tailSampling: bool('behaviour'),
        compressionRatio: num('data', { min: 1, max: 50, step: 0.5, realistic: { min: 4, max: 10 } }),
        retentionDays: num('data', { min: 1, max: 3650, realistic: { min: 3, max: 30 } }),
        maxIngestMbs: num('capacity', { min: 1, max: 100000 }),
        maxSpansPerSec: num('capacity', { min: 1000, max: 1000000000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbIngest: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.01 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: tracesModel,
    helpId: 'traces',
});

const apmDefaults = {
    hostsMonitored: 200,
    customMetrics: 20000,
    logIngestGb: 5000,
    providerLimitRps: 50000,
    maxIngestMbs: 200,
    serviceTimeMs: 5,
    availability: 0.999,
    costPerHostMonth: 31,
    costPerThousandSeries: 5,
    costPerGbIngest: 0.1,
};

const apmModel = defineModel<typeof apmDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => [
        quotaBound('rate-limit', ctx.params.providerLimitRps),
        bandwidthBound('ingest-bandwidth', ctx.params.maxIngestMbs * 8, ctx.requestBytes),
    ],
    cost: (ctx) => {
        const ingestGbMonth = (ctx.lambda * SECONDS_PER_MONTH * ctx.requestBytes) / 1e9;
        const billedIngestGb = Math.max(ctx.params.logIngestGb, ingestGbMonth);

        return totalCost({
            compute: ctx.params.hostsMonitored * ctx.params.costPerHostMonth * ctx.regionCostMultiplier,
            storage: billedIngestGb * ctx.params.costPerGbIngest,
            network: 0,
            requests: (ctx.params.customMetrics / 1000) * ctx.params.costPerThousandSeries,
        });
    },
    availability: (params) => params.availability,
});

const apm = defineComponent({
    id: 'apm',
    group: 'observability',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-apm',
    ports: OBSERVABILITY_PORTS,
    defaultParams: apmDefaults,
    paramSchema: {
        hostsMonitored: num('scale', { min: 1, max: 1000000 }),
        customMetrics: num('scale', { min: 0, max: 100000000 }),
        logIngestGb: num('data', { unitKey: 'gb', min: 0, max: 100000000 }),
        providerLimitRps: num('capacity', { unitKey: 'rps', min: 1, max: 100000000 }),
        maxIngestMbs: num('capacity', { min: 1, max: 100000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerHostMonth: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.01 }),
        costPerThousandSeries: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
        costPerGbIngest: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.01 }),
    },
    model: apmModel,
    helpId: 'apm',
    managed: true,
});

const auditLogDefaults = {
    eventsPerSec: 5000,
    eventBytes: 1200,
    retentionYears: 7,
    immutable: true,
    compressionRatio: 4,
    maxIngestMbs: 200,
    maxOpsPerSec: 200000,
    availability: 0.9999,
    costPerGbMonth: 0.023,
};

function auditIngestBytesPerEvent(params: typeof auditLogDefaults): number {
    return params.eventBytes * (params.immutable ? IMMUTABLE_WRITE_AMPLIFICATION : 1);
}

function auditStoredBytesPerEvent(params: typeof auditLogDefaults): number {
    return auditIngestBytesPerEvent(params) / params.compressionRatio;
}

function auditEventRate(lambda: number, eventsPerSec: number): number {
    return Math.max(lambda, eventsPerSec);
}

const auditLogModel = defineModel<typeof auditLogDefaults>({
    serviceSec: (ctx) => auditIngestBytesPerEvent(ctx.params) / (ctx.params.maxIngestMbs * 1e6),
    resources: (ctx) => [
        bandwidthBound(
            'ingest-bandwidth',
            ctx.params.maxIngestMbs * 8,
            auditIngestBytesPerEvent(ctx.params),
        ),
        quotaBound('ops', ctx.params.maxOpsPerSec),
    ],
    storage: (ctx) => {
        const eventRate = auditEventRate(ctx.lambda, ctx.params.eventsPerSec);
        const growthGbDay =
            (eventRate * SECONDS_PER_DAY * auditStoredBytesPerEvent(ctx.params)) / 1e9;
        const retainedDays = ctx.params.retentionYears * DAYS_PER_YEAR;
        const totalGb = growthGbDay * retainedDays;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'max(ingestRps, eventsPerSec) × 86400 × eventBytes × immutableAmplification / compressionRatio / 10⁹',
                    {
                        ingestRps: ctx.lambda,
                        eventsPerSec: ctx.params.eventsPerSec,
                        eventBytes: ctx.params.eventBytes,
                        immutableAmplification: ctx.params.immutable ? IMMUTABLE_WRITE_AMPLIFICATION : 1,
                        compressionRatio: ctx.params.compressionRatio,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × retentionYears × 365',
                    { growthGbDay, retentionYears: ctx.params.retentionYears },
                    totalGb,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const auditLog = defineComponent({
    id: 'audit-log',
    group: 'observability',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-audit-log',
    ports: OBSERVABILITY_PORTS,
    defaultParams: auditLogDefaults,
    paramSchema: {
        eventsPerSec: num('scale', { min: 0, max: 100000000 }),
        eventBytes: num('data', { unitKey: 'bytes', min: 50, max: 1000000, realistic: { min: 500, max: 4000 } }),
        retentionYears: num('data', { min: 1, max: 30, realistic: { min: 3, max: 10 } }),
        immutable: bool('reliability'),
        compressionRatio: num('data', { min: 1, max: 50, step: 0.5, realistic: { min: 3, max: 8 } }),
        maxIngestMbs: num('capacity', { min: 1, max: 100000 }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 1, max: 100000000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: auditLogModel,
    helpId: 'audit-log',
});

const alertingDefaults = {
    rules: 400,
    evaluationIntervalSec: 30,
    lookbackWindowSec: 300,
    noiseRatio: 0.6,
    firingsPerRuleMonth: 2,
    maxEvaluationsPerSec: 20000000,
    maxIngestMbs: 50,
    serviceTimeMs: 2,
    onCallSeats: 8,
    availability: 0.999,
    costPerSeatMonth: 21,
    costPerNotification: 0.01,
};

function alertingEvaluationsPerSample(params: typeof alertingDefaults): number {
    return (params.rules * params.lookbackWindowSec) / params.evaluationIntervalSec;
}

function alertingPagesPerMonth(params: typeof alertingDefaults): number {
    return params.rules * params.firingsPerRuleMonth * (1 + params.noiseRatio);
}

const alertingModel = defineModel<typeof alertingDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => [
        resourceLimit(
            'rule-evaluation',
            ctx.params.maxEvaluationsPerSec / alertingEvaluationsPerSample(ctx.params),
            'maxEvaluationsPerSec / (rules × lookbackWindowSec / evaluationIntervalSec)',
            {
                maxEvaluationsPerSec: ctx.params.maxEvaluationsPerSec,
                rules: ctx.params.rules,
                lookbackWindowSec: ctx.params.lookbackWindowSec,
                evaluationIntervalSec: ctx.params.evaluationIntervalSec,
            },
        ),
        bandwidthBound('ingest-bandwidth', ctx.params.maxIngestMbs * 8, ctx.requestBytes),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.params.onCallSeats * ctx.params.costPerSeatMonth * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: alertingPagesPerMonth(ctx.params) * ctx.params.costPerNotification,
        }),
    availability: (params) => params.availability,
});

const alerting = defineComponent({
    id: 'alerting',
    group: 'observability',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-metrics',
    ports: OBSERVABILITY_PORTS,
    defaultParams: alertingDefaults,
    paramSchema: {
        rules: num('scale', { min: 1, max: 1000000, realistic: { min: 20, max: 5000 } }),
        evaluationIntervalSec: num('behaviour', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 10, max: 300 } }),
        lookbackWindowSec: num('behaviour', { unitKey: 'sec', min: 1, max: 86400, realistic: { min: 60, max: 3600 } }),
        noiseRatio: num('reliability', { min: 0, max: 1, step: 0.01, realistic: { min: 0, max: 0.5 } }),
        firingsPerRuleMonth: num('behaviour', { min: 0, max: 1000, step: 0.1, realistic: { min: 0.1, max: 10 } }),
        maxEvaluationsPerSec: num('capacity', { min: 1000, max: 10000000000 }),
        maxIngestMbs: num('capacity', { min: 1, max: 100000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        onCallSeats: num('scale', { min: 1, max: 10000, realistic: { min: 3, max: 50 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerSeatMonth: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.01 }),
        costPerNotification: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: alertingModel,
    helpId: 'alerting',
    managed: true,
});

export const observabilityComponents: ComponentDefinition[] = [
    logs,
    metrics,
    traces,
    apm,
    alerting,
    auditLog,
] as unknown as ComponentDefinition[];
