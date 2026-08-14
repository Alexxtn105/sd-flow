import type { ComponentDefinition, PortSpec } from '../types/component';
import { SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explain,
    memoryResidencyBound,
    totalCost,
} from '../sim/resources';
import { choice, defineComponent, num } from './_shared/params';

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

export const observabilityComponents: ComponentDefinition[] = [
    logs,
    metrics,
] as unknown as ComponentDefinition[];
