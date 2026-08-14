import type { ComponentDefinition, PortSpec } from '../types/component';
import { DAYS_PER_MONTH, HOURS_PER_MONTH, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    connectionBound,
    defineModel,
    explicitRps,
    littleLaw,
    memoryResidencyBound,
    partitionBound,
    resourceLimit,
    totalCost,
} from '../sim/resources';
import { bool, choice, defineComponent, num, text } from './_shared/params';

const CALLER_OUT: PortSpec['out'] = [
    {
        id: 'out',
        protocols: [
            'http',
            'grpc',
            'sql',
            'nosql',
            'redis',
            'search',
            'olap',
            'kafka',
            'amqp',
            'sqs',
            's3',
            'internal',
        ],
        role: 'call',
    },
    { id: 'telemetry', protocols: ['telemetry'], role: 'observe' },
];

const SERVER_IN: PortSpec['in'] = [{ id: 'in', protocols: ['http', 'grpc', 'ws', 'internal'], role: 'serve' }];

const QUEUE_CONSUMER_IN: PortSpec['in'] = [
    { id: 'in', protocols: ['kafka', 'amqp', 'sqs', 'stream', 'internal'], role: 'consume' },
];

const TRIGGER_IN: PortSpec['in'] = [{ id: 'trigger', protocols: ['internal', 'http'], role: 'serve' }];

const SECONDS_PER_HOUR = 3600;

const SECONDS_PER_MINUTE = 60;

const PARALLEL_FANOUT_TAIL_GROWTH = 0.5;

const CHECKPOINT_WRITE_GBS_PER_TASK = 0.2;

const EXACTLY_ONCE_OVERHEAD = 1.25;

const WINDOW_STATE_FACTOR: Record<string, number> = {
    tumbling: 1,
    sliding: 3,
    session: 5,
};

const CODEC_CPU_COST: Record<string, number> = {
    h264: 1,
    h265: 2.5,
    av1: 8,
};

const QUANTIZED_SPEEDUP = 1.8;

const GPU_ACTIVATION_MEMORY_SHARE = 0.25;

const MODEL_ACTIVATION_SHARE = 0.05;

const REFRESH_SEGMENT_OVERHEAD_SEC = 0.5;

const serviceDefaults = {
    runtime: 'go',
    instances: 3,
    autoscale: true,
    autoscaleMax: 20,
    autoscaleTargetUtilization: 0.65,
    scaleUpLagSec: 60,
    scaleDownLagSec: 300,
    azSpread: 3,
    serviceTimeMs: 20,
    serviceTimeSigma: 0.6,
    cpuShare: 0.15,
    concurrencyPerInstance: 200,
    cpuCores: 4,
    memoryGb: 8,
    networkMbps: 1000,
    timeoutMs: 1000,
    queueLimit: 1000,
    callMode: 'sequential',
    logLinesPerRequest: 4,
    logBytesPerLine: 400,
    availability: 0.999,
    costPerInstanceHour: 0.17,
};

const serviceModel = defineModel<typeof serviceDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => {
        const serviceSec = ctx.params.serviceTimeMs / 1000;
        return [
            littleLaw('workers', ctx.instances * ctx.params.concurrencyPerInstance, serviceSec),
            littleLaw('cpu', ctx.instances * ctx.params.cpuCores, serviceSec * ctx.params.cpuShare),
            bandwidthBound(
                'network',
                ctx.params.networkMbps * ctx.instances,
                ctx.requestBytes + ctx.responseBytes,
            ),
        ];
    },
    autoscale: (ctx) => {
        if (!ctx.params.autoscale) return ctx.params.instances;

        const serviceSec = ctx.params.serviceTimeMs / 1000;
        const perInstance = Math.min(
            ctx.params.concurrencyPerInstance / serviceSec,
            ctx.params.cpuCores / (serviceSec * ctx.params.cpuShare),
        );
        const target = Math.max(ctx.params.autoscaleTargetUtilization, 0.05);
        const needed = Math.ceil(ctx.lambda / Math.max(perInstance * target, 1e-9));

        return Math.min(Math.max(needed, ctx.params.instances), ctx.params.autoscaleMax);
    },
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const service = defineComponent({
    id: 'service',
    group: 'compute',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-service',
    ports: { in: SERVER_IN, out: CALLER_OUT },
    defaultParams: serviceDefaults,
    paramSchema: {
        runtime: choice('performance', ['jvm', 'go', 'node', 'python', 'dotnet']),
        instances: num('scale', { min: 1, max: 10000, realistic: { min: 1, max: 500 } }),
        autoscale: bool('scale'),
        autoscaleMax: num('scale', { min: 1, max: 10000 }),
        autoscaleTargetUtilization: num('scale', { min: 0.1, max: 0.95, step: 0.05 }),
        scaleUpLagSec: num('behaviour', { unitKey: 'sec', min: 0, max: 3600 }),
        scaleDownLagSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        azSpread: num('scale', { min: 1, max: 6 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, realistic: { min: 1, max: 500 } }),
        serviceTimeSigma: num('performance', { min: 0.1, max: 2, step: 0.1 }),
        cpuShare: num('performance', { min: 0.01, max: 1, step: 0.01, realistic: { min: 0.05, max: 0.5 } }),
        concurrencyPerInstance: num('capacity', { min: 1, max: 100000 }),
        cpuCores: num('capacity', { min: 0.25, max: 192, step: 0.25 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.125, max: 1024 }),
        networkMbps: num('capacity', { unitKey: 'mbps', min: 10, max: 100000 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        queueLimit: num('behaviour', { min: 0, max: 1000000 }),
        callMode: choice('behaviour', ['sequential', 'parallel']),
        logLinesPerRequest: num('data', { min: 0, max: 1000 }),
        logBytesPerLine: num('data', { unitKey: 'bytes', min: 10, max: 100000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: serviceModel,
    helpId: 'service',
});

const monolithDefaults = {
    runtime: 'jvm',
    instances: 4,
    azSpread: 2,
    moduleCount: 12,
    serviceTimeMs: 45,
    serviceTimeSigma: 0.9,
    cpuShare: 0.25,
    concurrencyPerInstance: 200,
    cpuCores: 8,
    memoryGb: 32,
    sharedDbConnections: 50,
    timeoutMs: 3000,
    queueLimit: 500,
    startupSec: 90,
    logLinesPerRequest: 8,
    logBytesPerLine: 500,
    availability: 0.995,
    costPerInstanceHour: 0.68,
};

const monolithModel = defineModel<typeof monolithDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => {
        const serviceSec = ctx.params.serviceTimeMs / 1000;
        return [
            littleLaw('workers', ctx.instances * ctx.params.concurrencyPerInstance, serviceSec),
            littleLaw('cpu', ctx.instances * ctx.params.cpuCores, serviceSec * ctx.params.cpuShare),
            connectionBound('db-pool', ctx.params.sharedDbConnections * ctx.instances, 1, serviceSec),
        ];
    },
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const monolith = defineComponent({
    id: 'monolith',
    group: 'compute',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-monolith',
    ports: { in: SERVER_IN, out: CALLER_OUT },
    defaultParams: monolithDefaults,
    paramSchema: {
        runtime: choice('performance', ['jvm', 'go', 'node', 'python', 'dotnet']),
        instances: num('scale', { min: 1, max: 500 }),
        azSpread: num('scale', { min: 1, max: 6 }),
        moduleCount: num('scale', { min: 1, max: 200 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 1, max: 60000 }),
        serviceTimeSigma: num('performance', { min: 0.1, max: 2, step: 0.1 }),
        cpuShare: num('performance', { min: 0.01, max: 1, step: 0.01, realistic: { min: 0.1, max: 0.6 } }),
        concurrencyPerInstance: num('capacity', { min: 1, max: 10000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 1, max: 1024 }),
        sharedDbConnections: num('capacity', { min: 1, max: 5000 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        queueLimit: num('behaviour', { min: 0, max: 1000000 }),
        startupSec: num('behaviour', { unitKey: 'sec', min: 1, max: 3600 }),
        logLinesPerRequest: num('data', { min: 0, max: 1000 }),
        logBytesPerLine: num('data', { unitKey: 'bytes', min: 10, max: 100000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: monolithModel,
    helpId: 'monolith',
});

const bffDefaults = {
    instances: 4,
    downstreamCalls: 5,
    callMode: 'parallel',
    aggregationMs: 8,
    partialFailureMode: 'degrade',
    serviceTimeMs: 25,
    serviceTimeSigma: 0.7,
    downstreamCallMs: 40,
    cpuShare: 0.15,
    cpuCores: 4,
    concurrencyPerInstance: 64,
    memoryGb: 8,
    networkMbps: 1000,
    timeoutMs: 800,
    availability: 0.999,
    costPerInstanceHour: 0.17,
};

function bffOwnSec(params: typeof bffDefaults): number {
    return (params.serviceTimeMs + params.aggregationMs) / 1000;
}

function bffFanoutWaitSec(params: typeof bffDefaults): number {
    const callSec = params.downstreamCallMs / 1000;
    const calls = Math.max(params.downstreamCalls, 1);

    return params.callMode === 'parallel'
        ? callSec * (1 + PARALLEL_FANOUT_TAIL_GROWTH * Math.log(calls))
        : callSec * calls;
}

const bffModel = defineModel<typeof bffDefaults>({
    serviceSec: (ctx) => bffOwnSec(ctx.params),
    resources: (ctx) => [
        littleLaw(
            'inflight',
            ctx.instances * ctx.params.concurrencyPerInstance,
            bffOwnSec(ctx.params) + bffFanoutWaitSec(ctx.params),
        ),
        littleLaw('cpu', ctx.instances * ctx.params.cpuCores, bffOwnSec(ctx.params) * ctx.params.cpuShare),
        bandwidthBound(
            'network',
            ctx.params.networkMbps * ctx.instances,
            ctx.requestBytes + ctx.responseBytes,
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const bff = defineComponent({
    id: 'bff',
    group: 'compute',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-bff',
    ports: { in: SERVER_IN, out: CALLER_OUT },
    defaultParams: bffDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 5000, realistic: { min: 2, max: 200 } }),
        downstreamCalls: num('behaviour', { min: 1, max: 200, realistic: { min: 2, max: 12 } }),
        callMode: choice('behaviour', ['sequential', 'parallel']),
        aggregationMs: num('performance', { unitKey: 'ms', min: 0, max: 10000, step: 0.5 }),
        partialFailureMode: choice('behaviour', ['fail-fast', 'degrade']),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, realistic: { min: 1, max: 200 } }),
        serviceTimeSigma: num('performance', { min: 0.1, max: 2, step: 0.1 }),
        downstreamCallMs: num('performance', {
            unitKey: 'ms',
            min: 0.1,
            max: 60000,
            realistic: { min: 2, max: 300 },
        }),
        cpuShare: num('performance', { min: 0.01, max: 1, step: 0.01, realistic: { min: 0.05, max: 0.4 } }),
        cpuCores: num('capacity', { min: 0.25, max: 192, step: 0.25 }),
        concurrencyPerInstance: num('capacity', { min: 1, max: 100000 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.125, max: 1024 }),
        networkMbps: num('capacity', { unitKey: 'mbps', min: 10, max: 100000 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: bffModel,
    helpId: 'bff',
});

const serverlessDefaults = {
    memoryMb: 512,
    serviceTimeMs: 80,
    serviceTimeSigma: 0.8,
    coldStartMs: 400,
    coldStartShare: 0.02,
    provisionedConcurrency: 0,
    maxConcurrency: 1000,
    maxDurationSec: 900,
    timeoutMs: 30000,
    logLinesPerRequest: 3,
    logBytesPerLine: 400,
    costPerGbSecond: 0.0000166667,
    costPerMillionInvocations: 0.2,
};

const serverlessModel = defineModel<typeof serverlessDefaults>({
    serviceSec: (ctx) =>
        (ctx.params.serviceTimeMs + ctx.params.coldStartMs * ctx.params.coldStartShare) / 1000,
    resources: (ctx) => [
        littleLaw('concurrency', ctx.params.maxConcurrency, ctx.params.serviceTimeMs / 1000),
    ],
    cost: (ctx) => {
        const gbSeconds = ctx.lambda * SECONDS_PER_MONTH * (ctx.params.memoryMb / 1024) * (ctx.params.serviceTimeMs / 1000);
        const invocationsMillions = (ctx.lambda * SECONDS_PER_MONTH) / 1e6;
        return totalCost({
            compute: gbSeconds * ctx.params.costPerGbSecond * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
            requests: invocationsMillions * ctx.params.costPerMillionInvocations,
        });
    },
});

const serverless = defineComponent({
    id: 'serverless',
    group: 'compute',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-serverless',
    ports: { in: SERVER_IN, out: CALLER_OUT },
    defaultParams: serverlessDefaults,
    paramSchema: {
        memoryMb: num('capacity', { unitKey: 'mb', min: 128, max: 10240, step: 64 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 1, max: 900000 }),
        serviceTimeSigma: num('performance', { min: 0.1, max: 2, step: 0.1 }),
        coldStartMs: num('performance', { unitKey: 'ms', min: 0, max: 10000 }),
        coldStartShare: num('performance', { min: 0, max: 1, step: 0.01, realistic: { min: 0, max: 0.1 } }),
        provisionedConcurrency: num('scale', { min: 0, max: 10000 }),
        maxConcurrency: num('capacity', { min: 1, max: 100000 }),
        maxDurationSec: num('behaviour', { unitKey: 'sec', min: 1, max: 900 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 900000 }),
        logLinesPerRequest: num('data', { min: 0, max: 1000 }),
        logBytesPerLine: num('data', { unitKey: 'bytes', min: 10, max: 100000 }),
        costPerGbSecond: num('cost', { unitKey: 'usd', min: 0, max: 1, step: 0.0000001 }),
        costPerMillionInvocations: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: serverlessModel,
    helpId: 'serverless',
    managed: true,
});

const workerDefaults = {
    instances: 4,
    concurrency: 16,
    processingTimeMs: 120,
    cpuShare: 0.5,
    cpuCores: 2,
    prefetch: 32,
    batchSize: 1,
    retries: 3,
    dlqEnabled: true,
    idempotent: true,
    memoryGb: 4,
    logLinesPerRequest: 2,
    logBytesPerLine: 400,
    costPerInstanceHour: 0.09,
};

const workerModel = defineModel<typeof workerDefaults>({
    serviceSec: (ctx) => ctx.params.processingTimeMs / 1000 / Math.max(ctx.params.batchSize, 1),
    resources: (ctx) => {
        const batchSec = ctx.params.processingTimeMs / 1000;
        return [
            littleLaw(
                'workers',
                ctx.instances * ctx.params.concurrency * Math.max(ctx.params.batchSize, 1),
                batchSec,
            ),
            littleLaw('cpu', ctx.instances * ctx.params.cpuCores * Math.max(ctx.params.batchSize, 1), batchSec * ctx.params.cpuShare),
        ];
    },
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
});

const worker = defineComponent({
    id: 'worker',
    group: 'compute',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-worker',
    ports: {
        in: [{ id: 'in', protocols: ['kafka', 'amqp', 'sqs', 'internal'], role: 'consume' }],
        out: CALLER_OUT,
    },
    defaultParams: workerDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 5000 }),
        concurrency: num('capacity', { min: 1, max: 10000 }),
        processingTimeMs: num('performance', { unitKey: 'ms', min: 1, max: 600000 }),
        cpuShare: num('performance', { min: 0.01, max: 1, step: 0.01, realistic: { min: 0.2, max: 1 } }),
        cpuCores: num('capacity', { min: 0.25, max: 192, step: 0.25 }),
        prefetch: num('behaviour', { min: 1, max: 10000 }),
        batchSize: num('behaviour', { min: 1, max: 10000 }),
        retries: num('behaviour', { min: 0, max: 20 }),
        dlqEnabled: bool('reliability'),
        idempotent: bool('reliability'),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.125, max: 1024 }),
        logLinesPerRequest: num('data', { min: 0, max: 1000 }),
        logBytesPerLine: num('data', { unitKey: 'bytes', min: 10, max: 100000 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: workerModel,
    helpId: 'worker',
});

const cronDefaults = {
    scheduleCron: '0 * * * *',
    intervalSec: 3600,
    jobDurationSec: 600,
    overlapPolicy: 'skip',
    spikeFactor: 10,
    instances: 2,
    concurrency: 16,
    processingTimeMs: 200,
    retries: 2,
    timeoutMs: 60000,
    availability: 0.999,
    costPerInstanceHour: 0.09,
};

function cronTaskSec(params: typeof cronDefaults): number {
    return params.processingTimeMs / 1000;
}

const cronModel = defineModel<typeof cronDefaults>({
    serviceSec: (ctx) => cronTaskSec(ctx.params),
    resources: (ctx) => {
        const slots = ctx.instances * ctx.params.concurrency;
        const taskSec = cronTaskSec(ctx.params);

        return [
            resourceLimit(
                'concurrency',
                slots / (taskSec * ctx.params.spikeFactor),
                'slots / (taskSec × spikeFactor)',
                { slots, taskSec, spikeFactor: ctx.params.spikeFactor },
            ),
            resourceLimit(
                'job-window',
                (slots * ctx.params.jobDurationSec) / (taskSec * ctx.params.intervalSec),
                'slots × jobDurationSec / (taskSec × intervalSec)',
                {
                    slots,
                    jobDurationSec: ctx.params.jobDurationSec,
                    taskSec,
                    intervalSec: ctx.params.intervalSec,
                },
            ),
        ];
    },
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const cron = defineComponent({
    id: 'cron',
    group: 'compute',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-cron',
    ports: { in: TRIGGER_IN, out: CALLER_OUT },
    defaultParams: cronDefaults,
    paramSchema: {
        scheduleCron: text('behaviour'),
        intervalSec: num('behaviour', { unitKey: 'sec', min: 1, max: 2678400, realistic: { min: 60, max: 86400 } }),
        jobDurationSec: num('behaviour', { unitKey: 'sec', min: 1, max: 86400, realistic: { min: 10, max: 3600 } }),
        overlapPolicy: choice('behaviour', ['skip', 'queue', 'allow']),
        spikeFactor: num('behaviour', { min: 1, max: 1000, step: 0.5, realistic: { min: 2, max: 50 } }),
        instances: num('scale', { min: 1, max: 100 }),
        concurrency: num('capacity', { min: 1, max: 10000 }),
        processingTimeMs: num('performance', { unitKey: 'ms', min: 1, max: 600000 }),
        retries: num('behaviour', { min: 0, max: 20 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 3600000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: cronModel,
    helpId: 'cron',
});

const batchDefaults = {
    datasetGb: 2000,
    throughputMbPerCoreSec: 8,
    cores: 32,
    windowHours: 4,
    shuffleFactor: 2,
    rowSizeBytes: 2000,
    retries: 1,
    availability: 0.99,
    costPerCoreHour: 0.04,
};

function batchRowSec(params: typeof batchDefaults): number {
    return (params.rowSizeBytes * params.shuffleFactor) / (params.throughputMbPerCoreSec * 1e6);
}

const batchModel = defineModel<typeof batchDefaults>({
    serviceSec: (ctx) => batchRowSec(ctx.params),
    resources: (ctx) => [
        littleLaw('cpu', ctx.params.cores, batchRowSec(ctx.params)),
        resourceLimit(
            'job-window',
            (ctx.params.datasetGb * 1e9) /
                ctx.params.rowSizeBytes /
                (ctx.params.windowHours * SECONDS_PER_HOUR),
            'datasetGb × 10⁹ / rowSizeBytes / (windowHours × 3600)',
            {
                datasetGb: ctx.params.datasetGb,
                rowSizeBytes: ctx.params.rowSizeBytes,
                windowHours: ctx.params.windowHours,
            },
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.cores *
                ctx.params.costPerCoreHour *
                ctx.params.windowHours *
                DAYS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const batch = defineComponent({
    id: 'batch',
    group: 'compute',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-batch',
    ports: { in: QUEUE_CONSUMER_IN, out: CALLER_OUT },
    defaultParams: batchDefaults,
    paramSchema: {
        datasetGb: num('data', { unitKey: 'gb', min: 0.1, max: 10000000, realistic: { min: 10, max: 500000 } }),
        throughputMbPerCoreSec: num('performance', { min: 0.1, max: 500, step: 0.1, realistic: { min: 2, max: 50 } }),
        cores: num('capacity', { min: 1, max: 100000, realistic: { min: 8, max: 5000 } }),
        windowHours: num('behaviour', { min: 0.1, max: 168, step: 0.1, realistic: { min: 0.5, max: 12 } }),
        shuffleFactor: num('performance', { min: 1, max: 20, step: 0.1, realistic: { min: 1, max: 5 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 10000000 }),
        retries: num('behaviour', { min: 0, max: 20 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerCoreHour: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
    },
    model: batchModel,
    helpId: 'batch',
});

const streamProcessorDefaults = {
    parallelism: 24,
    partitions: 24,
    recordsPerSecPerTask: 20000,
    stateSizeGb: 120,
    checkpointIntervalSec: 60,
    windowType: 'tumbling',
    exactlyOnce: true,
    watermarkLagSec: 30,
    instances: 4,
    memoryGb: 32,
    availability: 0.999,
    costPerInstanceHour: 0.35,
};

function streamCheckpointOverhead(params: typeof streamProcessorDefaults): number {
    const checkpointSec = params.stateSizeGb / (params.parallelism * CHECKPOINT_WRITE_GBS_PER_TASK);
    const barrierOverhead = params.exactlyOnce ? EXACTLY_ONCE_OVERHEAD : 1;

    return (1 + checkpointSec / params.checkpointIntervalSec) * barrierOverhead;
}

function streamRecordSec(params: typeof streamProcessorDefaults): number {
    return streamCheckpointOverhead(params) / params.recordsPerSecPerTask;
}

function streamStateGbPerRecord(params: typeof streamProcessorDefaults, recordBytes: number): number {
    return (recordBytes * params.watermarkLagSec * (WINDOW_STATE_FACTOR[params.windowType] ?? 1)) / 1e9;
}

const streamProcessorModel = defineModel<typeof streamProcessorDefaults>({
    serviceSec: (ctx) => streamRecordSec(ctx.params),
    resources: (ctx) => [
        partitionBound(
            'partitions',
            Math.min(ctx.params.parallelism, ctx.params.partitions),
            1 / streamRecordSec(ctx.params),
        ),
        memoryResidencyBound(
            'memory',
            ctx.instances * ctx.params.memoryGb,
            streamStateGbPerRecord(ctx.params, ctx.requestBytes),
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const streamProcessor = defineComponent({
    id: 'stream-processor',
    group: 'compute',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-stream-processor',
    ports: { in: QUEUE_CONSUMER_IN, out: CALLER_OUT },
    defaultParams: streamProcessorDefaults,
    paramSchema: {
        parallelism: num('scale', { min: 1, max: 10000, realistic: { min: 2, max: 512 } }),
        partitions: num('topology', { min: 1, max: 10000, realistic: { min: 3, max: 512 } }),
        recordsPerSecPerTask: num('capacity', { min: 1, max: 10000000, realistic: { min: 1000, max: 200000 } }),
        stateSizeGb: num('data', { unitKey: 'gb', min: 0, max: 100000, realistic: { min: 0, max: 5000 } }),
        checkpointIntervalSec: num('behaviour', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 10, max: 300 } }),
        windowType: choice('behaviour', ['tumbling', 'sliding', 'session']),
        exactlyOnce: bool('consistency'),
        watermarkLagSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400, realistic: { min: 1, max: 300 } }),
        instances: num('scale', { min: 1, max: 5000 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 2048 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: streamProcessorModel,
    helpId: 'stream-processor',
});

const transcoderDefaults = {
    instances: 8,
    renditions: 5,
    sourceMinutes: 10,
    speedFactor: 1,
    codec: 'h264',
    hardwareAccel: false,
    gpuCount: 2,
    cpuCores: 16,
    queuePriority: 'fifo',
    maxQueueDepth: 5000,
    networkMbps: 2000,
    availability: 0.99,
    costPerInstanceHour: 0.9,
};

function transcoderJobSec(params: typeof transcoderDefaults): number {
    const codecCost = CODEC_CPU_COST[params.codec] ?? 1;

    return (params.sourceMinutes * SECONDS_PER_MINUTE * params.renditions * codecCost) / params.speedFactor;
}

const transcoderModel = defineModel<typeof transcoderDefaults>({
    serviceSec: (ctx) => transcoderJobSec(ctx.params),
    resources: (ctx) => [
        ctx.params.hardwareAccel
            ? littleLaw('gpu', ctx.instances * ctx.params.gpuCount, transcoderJobSec(ctx.params))
            : littleLaw('cpu', ctx.instances * ctx.params.cpuCores, transcoderJobSec(ctx.params)),
        bandwidthBound(
            'network',
            ctx.params.networkMbps * ctx.instances,
            ctx.requestBytes + ctx.responseBytes,
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const transcoder = defineComponent({
    id: 'transcoder',
    group: 'compute',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-transcoder',
    ports: { in: QUEUE_CONSUMER_IN, out: CALLER_OUT },
    defaultParams: transcoderDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 10000, realistic: { min: 2, max: 500 } }),
        renditions: num('data', { min: 1, max: 20, realistic: { min: 3, max: 8 } }),
        sourceMinutes: num('data', { min: 0.1, max: 1440, step: 0.1, realistic: { min: 1, max: 120 } }),
        speedFactor: num('performance', { min: 0.05, max: 50, step: 0.05, realistic: { min: 0.3, max: 20 } }),
        codec: choice('performance', ['h264', 'h265', 'av1']),
        hardwareAccel: bool('performance'),
        gpuCount: num('capacity', { min: 1, max: 64 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        queuePriority: choice('behaviour', ['fifo', 'weighted', 'strict']),
        maxQueueDepth: num('behaviour', { min: 1, max: 10000000 }),
        networkMbps: num('capacity', { unitKey: 'mbps', min: 10, max: 400000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: transcoderModel,
    helpId: 'transcoder',
});

const mlInferenceDefaults = {
    instances: 2,
    gpuCount: 4,
    gpuType: 'a10g',
    throughputPerGpu: 200,
    batchSize: 8,
    inferenceMs: 30,
    modelSizeGb: 6,
    gpuMemoryGb: 24,
    warmupSec: 60,
    quantized: false,
    timeoutMs: 2000,
    availability: 0.995,
    costPerInstanceHour: 4.2,
};

function mlQuantizationSpeedup(params: typeof mlInferenceDefaults): number {
    return params.quantized ? QUANTIZED_SPEEDUP : 1;
}

function mlBatchSec(params: typeof mlInferenceDefaults): number {
    return params.inferenceMs / 1000 / mlQuantizationSpeedup(params);
}

const mlInferenceModel = defineModel<typeof mlInferenceDefaults>({
    serviceSec: (ctx) => mlBatchSec(ctx.params) / Math.max(ctx.params.batchSize, 1),
    resources: (ctx) => [
        explicitRps(
            'gpu',
            ctx.instances * ctx.params.gpuCount,
            ctx.params.throughputPerGpu * mlQuantizationSpeedup(ctx.params),
        ),
        littleLaw(
            'concurrency',
            ctx.instances * ctx.params.gpuCount * Math.max(ctx.params.batchSize, 1),
            mlBatchSec(ctx.params),
        ),
        memoryResidencyBound(
            'memory',
            ctx.instances * ctx.params.gpuCount * ctx.params.gpuMemoryGb * GPU_ACTIVATION_MEMORY_SHARE,
            ctx.params.modelSizeGb * MODEL_ACTIVATION_SHARE * mlBatchSec(ctx.params),
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const mlInference = defineComponent({
    id: 'ml-inference',
    group: 'compute',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-ml-inference',
    ports: { in: SERVER_IN, out: CALLER_OUT },
    defaultParams: mlInferenceDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 5000, realistic: { min: 1, max: 200 } }),
        gpuCount: num('capacity', { min: 1, max: 64, realistic: { min: 1, max: 8 } }),
        gpuType: choice('capacity', ['t4', 'l4', 'a10g', 'a100', 'h100']),
        throughputPerGpu: num('capacity', { min: 0.1, max: 1000000, step: 0.1, realistic: { min: 5, max: 5000 } }),
        batchSize: num('behaviour', { min: 1, max: 4096 }),
        inferenceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 600000, realistic: { min: 2, max: 2000 } }),
        modelSizeGb: num('capacity', { unitKey: 'gb', min: 0.01, max: 2000, step: 0.01 }),
        gpuMemoryGb: num('capacity', { unitKey: 'gb', min: 1, max: 640 }),
        warmupSec: num('behaviour', { unitKey: 'sec', min: 0, max: 3600 }),
        quantized: bool('performance'),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: mlInferenceModel,
    helpId: 'ml-inference',
});

const searchIndexerDefaults = {
    instances: 4,
    docsPerSec: 2000,
    docSizeKb: 2,
    indexExpansionRatio: 1.4,
    indexLagSec: 30,
    refreshIntervalSec: 5,
    indexServiceMs: 5,
    cpuShare: 0.6,
    cpuCores: 8,
    memoryGb: 16,
    mergeThroughputMbs: 100,
    availability: 0.999,
    costPerInstanceHour: 0.4,
};

function indexerDocumentBytes(params: typeof searchIndexerDefaults): number {
    return params.docSizeKb * 1024 * params.indexExpansionRatio;
}

function indexerServiceSec(params: typeof searchIndexerDefaults): number {
    return (params.indexServiceMs / 1000) * (1 + REFRESH_SEGMENT_OVERHEAD_SEC / params.refreshIntervalSec);
}

const searchIndexerModel = defineModel<typeof searchIndexerDefaults>({
    serviceSec: (ctx) => indexerServiceSec(ctx.params),
    resources: (ctx) => [
        explicitRps('indexing', ctx.instances, ctx.params.docsPerSec),
        littleLaw(
            'cpu',
            ctx.instances * ctx.params.cpuCores,
            indexerServiceSec(ctx.params) * ctx.params.cpuShare,
        ),
        bandwidthBound(
            'throughput',
            ctx.instances * ctx.params.mergeThroughputMbs * 8,
            indexerDocumentBytes(ctx.params),
        ),
        memoryResidencyBound(
            'memory',
            ctx.instances * ctx.params.memoryGb,
            (indexerDocumentBytes(ctx.params) * ctx.params.indexLagSec) / 1e9,
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const searchIndexer = defineComponent({
    id: 'search-indexer',
    group: 'compute',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-search-indexer',
    ports: {
        in: QUEUE_CONSUMER_IN,
        out: [
            { id: 'out', protocols: ['search', 'olap', 'internal'], role: 'call' },
            { id: 'telemetry', protocols: ['telemetry'], role: 'observe' },
        ],
    },
    defaultParams: searchIndexerDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 5000, realistic: { min: 2, max: 200 } }),
        docsPerSec: num('capacity', { min: 1, max: 10000000, realistic: { min: 100, max: 50000 } }),
        docSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        indexExpansionRatio: num('data', { min: 0.5, max: 5, step: 0.1, realistic: { min: 1.1, max: 2 } }),
        indexLagSec: num('behaviour', { unitKey: 'sec', min: 0.1, max: 3600, step: 0.1, realistic: { min: 1, max: 300 } }),
        refreshIntervalSec: num('behaviour', { unitKey: 'sec', min: 0.1, max: 300, step: 0.1 }),
        indexServiceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1 }),
        cpuShare: num('performance', { min: 0.01, max: 1, step: 0.01, realistic: { min: 0.2, max: 1 } }),
        cpuCores: num('capacity', { min: 0.25, max: 192, step: 0.25 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 1024 }),
        mergeThroughputMbs: num('capacity', { min: 1, max: 10000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: searchIndexerModel,
    helpId: 'search-indexer',
});

const edgeFunctionDefaults = {
    popCount: 300,
    isolatesPerPop: 2000,
    cpuCoresPerPop: 2,
    cpuMsPerRequest: 8,
    cpuMsLimit: 50,
    serviceTimeMs: 25,
    coldStartMs: 5,
    coldStartShare: 0.05,
    subrequestsPerInvocation: 1,
    logLinesPerRequest: 2,
    logBytesPerLine: 300,
    costPerMillionRequests: 0.3,
    costPerMillionCpuMs: 0.02,
};

function edgeFunctionCpuSec(params: typeof edgeFunctionDefaults): number {
    return Math.min(params.cpuMsPerRequest, params.cpuMsLimit) / 1000;
}

function edgeFunctionServiceSec(params: typeof edgeFunctionDefaults): number {
    return (params.serviceTimeMs + params.coldStartMs * params.coldStartShare) / 1000;
}

const edgeFunctionModel = defineModel<typeof edgeFunctionDefaults>({
    serviceSec: (ctx) => edgeFunctionServiceSec(ctx.params),
    resources: (ctx) => [
        littleLaw(
            'cpu',
            ctx.params.popCount * ctx.params.cpuCoresPerPop,
            edgeFunctionCpuSec(ctx.params),
        ),
        littleLaw(
            'concurrency',
            ctx.params.popCount * ctx.params.isolatesPerPop,
            edgeFunctionServiceSec(ctx.params),
        ),
    ],
    cost: (ctx) => {
        const requestsMillions = (ctx.lambda * SECONDS_PER_MONTH) / 1e6;
        const cpuMsMillions =
            (ctx.lambda * SECONDS_PER_MONTH * edgeFunctionCpuSec(ctx.params) * 1000) / 1e6;

        return totalCost({
            compute: cpuMsMillions * ctx.params.costPerMillionCpuMs * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
            requests: requestsMillions * ctx.params.costPerMillionRequests,
        });
    },
});

const edgeFunction = defineComponent({
    id: 'edge-function',
    group: 'compute',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-serverless',
    ports: { in: SERVER_IN, out: CALLER_OUT },
    defaultParams: edgeFunctionDefaults,
    paramSchema: {
        popCount: num('scale', { min: 1, max: 1000, realistic: { min: 50, max: 400 } }),
        isolatesPerPop: num('capacity', { min: 1, max: 1000000 }),
        cpuCoresPerPop: num('capacity', { min: 0.25, max: 256, step: 0.25 }),
        cpuMsPerRequest: num('performance', { unitKey: 'ms', min: 0.1, max: 1000, step: 0.1, realistic: { min: 1, max: 30 } }),
        cpuMsLimit: num('capacity', { unitKey: 'ms', min: 1, max: 30000, realistic: { min: 10, max: 50 } }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 30000, step: 0.1 }),
        coldStartMs: num('performance', { unitKey: 'ms', min: 0, max: 1000, realistic: { min: 0, max: 20 } }),
        coldStartShare: num('performance', { min: 0, max: 1, step: 0.01, realistic: { min: 0, max: 0.1 } }),
        subrequestsPerInvocation: num('behaviour', { min: 0, max: 50 }),
        logLinesPerRequest: num('data', { min: 0, max: 1000 }),
        logBytesPerLine: num('data', { unitKey: 'bytes', min: 10, max: 100000 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
        costPerMillionCpuMs: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
    },
    model: edgeFunctionModel,
    helpId: 'edge-function',
    managed: true,
});

const webrtcSfuDefaults = {
    instances: 4,
    participantsPerRoom: 8,
    sessionDurationMin: 25,
    bitrateKbps: 800,
    simulcastLayers: 3,
    cpuPerStream: 0.01,
    cpuCores: 16,
    egressGbps: 10,
    availability: 0.999,
    costPerInstanceHour: 0.6,
};

function sfuSessionSec(params: typeof webrtcSfuDefaults): number {
    return params.sessionDurationMin * SECONDS_PER_MINUTE;
}

function sfuForwardedStreams(params: typeof webrtcSfuDefaults): number {
    return params.participantsPerRoom * (params.participantsPerRoom - 1);
}

function sfuStreamsPerRoom(params: typeof webrtcSfuDefaults): number {
    return params.participantsPerRoom * params.simulcastLayers + sfuForwardedStreams(params);
}

function sfuCpuSecPerSession(params: typeof webrtcSfuDefaults): number {
    return sfuSessionSec(params) * sfuStreamsPerRoom(params) * params.cpuPerStream;
}

function sfuEgressBitsPerSec(params: typeof webrtcSfuDefaults): number {
    return sfuForwardedStreams(params) * params.bitrateKbps * 1000;
}

const webrtcSfuModel = defineModel<typeof webrtcSfuDefaults>({
    serviceSec: (ctx) => sfuSessionSec(ctx.params),
    resources: (ctx) => [
        littleLaw('cpu', ctx.instances * ctx.params.cpuCores, sfuCpuSecPerSession(ctx.params)),
        resourceLimit(
            'media-egress',
            (ctx.instances * ctx.params.egressGbps * 1e9) /
                sfuEgressBitsPerSec(ctx.params) /
                sfuSessionSec(ctx.params),
            'instances × egressGbps × 10⁹ / (forwardedStreams × bitrateKbps × 10³) / sessionSec',
            {
                instances: ctx.instances,
                egressGbps: ctx.params.egressGbps,
                forwardedStreams: sfuForwardedStreams(ctx.params),
                bitrateKbps: ctx.params.bitrateKbps,
                sessionSec: sfuSessionSec(ctx.params),
            },
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const webrtcSfu = defineComponent({
    id: 'webrtc-sfu',
    group: 'compute',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-transcoder',
    ports: { in: SERVER_IN, out: CALLER_OUT },
    defaultParams: webrtcSfuDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 10000, realistic: { min: 2, max: 500 } }),
        participantsPerRoom: num('scale', { min: 2, max: 1000, realistic: { min: 2, max: 50 } }),
        sessionDurationMin: num('behaviour', { min: 0.5, max: 1440, step: 0.5, realistic: { min: 5, max: 120 } }),
        bitrateKbps: num('data', { min: 50, max: 20000, realistic: { min: 300, max: 2500 } }),
        simulcastLayers: num('behaviour', { min: 1, max: 5, realistic: { min: 1, max: 3 } }),
        cpuPerStream: num('performance', { min: 0.001, max: 1, step: 0.001, realistic: { min: 0.005, max: 0.05 } }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        egressGbps: num('capacity', { min: 0.1, max: 400, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: webrtcSfuModel,
    helpId: 'webrtc-sfu',
});

export const computeComponents: ComponentDefinition[] = [
    service,
    monolith,
    bff,
    serverless,
    worker,
    cron,
    batch,
    streamProcessor,
    transcoder,
    mlInference,
    searchIndexer,
    edgeFunction,
    webrtcSfu,
] as unknown as ComponentDefinition[];
