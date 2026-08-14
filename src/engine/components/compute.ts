import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_MONTH } from '../sim/constants';
import { bandwidthBound, connectionBound, defineModel, littleLaw, totalCost } from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

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

const serviceDefaults = {
    runtime: 'go',
    instances: 3,
    autoscale: true,
    autoscaleMax: 20,
    autoscaleTargetUtilization: 0.65,
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

export const computeComponents: ComponentDefinition[] = [
    service,
    monolith,
    serverless,
    worker,
] as unknown as ComponentDefinition[];
