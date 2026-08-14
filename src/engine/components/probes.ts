import type { ComponentDefinition, PortSpec, Protocol } from '../types/component';
import { bool, choice, defineComponent, num } from './_shared/params';

const ATTACHABLE_PROTOCOLS: Protocol[] = [
    'http',
    'grpc',
    'ws',
    'dns',
    'sql',
    'nosql',
    'redis',
    'search',
    'olap',
    'kafka',
    'amqp',
    'sqs',
    's3',
    'stream',
    'telemetry',
    'internal',
];

const PROBE_PORTS: PortSpec = {
    in: [{ id: 'attach', protocols: ATTACHABLE_PROTOCOLS, role: 'attach' }],
    out: [],
};

const probeRps = defineComponent({
    id: 'probe-rps',
    group: 'probes',
    shape: 'probe',
    wave: 'mvp',
    icon: 'sd-probe-rps',
    ports: PROBE_PORTS,
    defaultParams: {
        splitByOperation: true,
        splitByFlow: false,
        windowSec: 300,
    },
    paramSchema: {
        splitByOperation: bool('behaviour'),
        splitByFlow: bool('behaviour'),
        windowSec: num('behaviour', { unitKey: 'sec', min: 10, max: 86400 }),
    },
    helpId: 'probe-rps',
});

const probeLatency = defineComponent({
    id: 'probe-latency',
    group: 'probes',
    shape: 'probe',
    wave: 'mvp',
    icon: 'sd-probe-latency',
    ports: PROBE_PORTS,
    defaultParams: {
        buckets: 40,
        scale: 'log',
        showQueueWait: true,
    },
    paramSchema: {
        buckets: num('behaviour', { min: 10, max: 200 }),
        scale: choice('behaviour', ['linear', 'log']),
        showQueueWait: bool('behaviour'),
    },
    helpId: 'probe-latency',
});

const probeUtilization = defineComponent({
    id: 'probe-utilization',
    group: 'probes',
    shape: 'probe',
    wave: 'mvp',
    icon: 'sd-probe-utilization',
    ports: PROBE_PORTS,
    defaultParams: {
        warnThreshold: 0.7,
        alarmThreshold: 0.9,
        showBoundBy: true,
    },
    paramSchema: {
        warnThreshold: num('behaviour', { min: 0.1, max: 1, step: 0.05 }),
        alarmThreshold: num('behaviour', { min: 0.1, max: 1, step: 0.05 }),
        showBoundBy: bool('behaviour'),
    },
    helpId: 'probe-utilization',
});

const probeQueue = defineComponent({
    id: 'probe-queue',
    group: 'probes',
    shape: 'probe',
    wave: 'mvp',
    icon: 'sd-probe-queue',
    ports: PROBE_PORTS,
    defaultParams: {
        showTimeToDrain: true,
        lagAlarmSec: 60,
    },
    paramSchema: {
        showTimeToDrain: bool('behaviour'),
        lagAlarmSec: num('behaviour', { unitKey: 'sec', min: 1, max: 86400 }),
    },
    helpId: 'probe-queue',
});

const probeStorage = defineComponent({
    id: 'probe-storage',
    group: 'probes',
    shape: 'probe',
    wave: 'mvp',
    icon: 'sd-probe-storage',
    ports: PROBE_PORTS,
    defaultParams: {
        horizonYears: 3,
        includeReplicas: true,
        includeBackups: true,
    },
    paramSchema: {
        horizonYears: num('behaviour', { min: 1, max: 10 }),
        includeReplicas: bool('behaviour'),
        includeBackups: bool('behaviour'),
    },
    helpId: 'probe-storage',
});

const probeCost = defineComponent({
    id: 'probe-cost',
    group: 'probes',
    shape: 'probe',
    wave: 'mvp',
    icon: 'sd-probe-cost',
    ports: PROBE_PORTS,
    defaultParams: {
        period: 'month',
        breakdown: true,
    },
    paramSchema: {
        period: choice('behaviour', ['hour', 'day', 'month', 'year']),
        breakdown: bool('behaviour'),
    },
    helpId: 'probe-cost',
});

const probeSlo = defineComponent({
    id: 'probe-slo',
    group: 'probes',
    shape: 'probe',
    wave: 'mvp',
    icon: 'sd-probe-slo',
    ports: PROBE_PORTS,
    defaultParams: {
        targetP99Ms: 300,
        targetAvailability: 0.999,
        errorBudgetDays: 30,
    },
    paramSchema: {
        targetP99Ms: num('behaviour', { unitKey: 'ms', min: 1, max: 60000 }),
        targetAvailability: num('behaviour', { min: 0.9, max: 0.99999, step: 0.0001 }),
        errorBudgetDays: num('behaviour', { min: 1, max: 365 }),
    },
    helpId: 'probe-slo',
});

const probeAvailability = defineComponent({
    id: 'probe-availability',
    group: 'probes',
    shape: 'probe',
    wave: 'v1',
    icon: 'sd-probe-availability',
    ports: PROBE_PORTS,
    defaultParams: {
        targetAvailability: 0.999,
        windowDays: 30,
        showWeakest: true,
    },
    paramSchema: {
        targetAvailability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        windowDays: num('reliability', { min: 1, max: 365 }),
        showWeakest: bool('behaviour'),
    },
    helpId: 'probe-availability',
});

const probeTrafficInspector = defineComponent({
    id: 'probe-traffic-inspector',
    group: 'probes',
    shape: 'probe',
    wave: 'v1',
    icon: 'sd-probe-traffic',
    ports: PROBE_PORTS,
    defaultParams: {
        groupBy: 'operation',
        topN: 5,
        showBytes: true,
        errorAlarmShare: 0.01,
    },
    paramSchema: {
        groupBy: choice('behaviour', ['operation', 'edge', 'flow']),
        topN: num('behaviour', { min: 1, max: 20 }),
        showBytes: bool('behaviour'),
        errorAlarmShare: num('reliability', { min: 0.0001, max: 1, step: 0.0001 }),
    },
    helpId: 'probe-traffic-inspector',
});

const probeHeatmap = defineComponent({
    id: 'probe-heatmap',
    group: 'probes',
    shape: 'probe',
    wave: 'v1',
    icon: 'sd-probe-heatmap',
    ports: PROBE_PORTS,
    defaultParams: {
        metric: 'utilization',
        scope: 'scheme',
        warnThreshold: 0.7,
        alarmThreshold: 0.9,
    },
    paramSchema: {
        metric: choice('behaviour', ['utilization', 'errors']),
        scope: choice('behaviour', ['scheme', 'subtree']),
        warnThreshold: num('behaviour', { min: 0.1, max: 1, step: 0.05 }),
        alarmThreshold: num('behaviour', { min: 0.1, max: 1, step: 0.05 }),
    },
    helpId: 'probe-heatmap',
});

const probeWaterfall = defineComponent({
    id: 'probe-waterfall',
    group: 'probes',
    shape: 'probe',
    wave: 'v1',
    icon: 'sd-probe-waterfall',
    ports: PROBE_PORTS,
    defaultParams: {
        percentile: 'p99',
        topHops: 12,
        showNetwork: true,
        showCacheMiss: true,
    },
    paramSchema: {
        percentile: choice('behaviour', ['p50', 'p95', 'p99']),
        topHops: num('behaviour', { min: 3, max: 40 }),
        showNetwork: bool('behaviour'),
        showCacheMiss: bool('behaviour'),
    },
    helpId: 'probe-waterfall',
});

export const probeComponents: ComponentDefinition[] = [
    probeRps,
    probeLatency,
    probeUtilization,
    probeQueue,
    probeStorage,
    probeCost,
    probeSlo,
    probeAvailability,
    probeTrafficInspector,
    probeHeatmap,
    probeWaterfall,
] as unknown as ComponentDefinition[];
