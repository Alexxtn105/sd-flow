import type { ComponentDefinition, PortSpec } from '../types/component';
import { choice, defineComponent, num } from './_shared/params';

const OBSERVABILITY_PORTS: PortSpec = {
    in: [{ id: 'ingest', protocols: ['telemetry'], role: 'serve' }],
    out: [],
};

const logs = defineComponent({
    id: 'logs',
    group: 'observability',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-logs',
    ports: OBSERVABILITY_PORTS,
    defaultParams: {
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
    },
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
    helpId: 'logs',
});

const metrics = defineComponent({
    id: 'metrics',
    group: 'observability',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-metrics',
    ports: OBSERVABILITY_PORTS,
    defaultParams: {
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
    },
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
    helpId: 'metrics',
});

export const observabilityComponents: ComponentDefinition[] = [
    logs,
    metrics,
] as unknown as ComponentDefinition[];
