import type { ComponentDefinition } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explain,
    explicitRps,
    littleLaw,
    partitionBound,
    quotaBound,
    totalCost,
} from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const COMPRESSION_RATIO: Record<string, number> = {
    none: 1,
    gzip: 5,
    snappy: 3,
    lz4: 3,
    zstd: 5,
};

const PARTITION_THROUGHPUT_MBS = 10;

const RABBITMQ_OPS_PER_NODE = 50000;

const QUORUM_QUEUE_REPLICAS = 3;

const QUORUM_QUEUE_PENALTY = 0.5;

const SQS_API_CALLS_PER_MESSAGE = 3;

const DLQ_PUBLISH_LATENCY_MS = 10;

const SECONDS_PER_HOUR = 3600;

function requestsPerMonthMillions(lambda: number): number {
    return (lambda * SECONDS_PER_MONTH) / 1e6;
}

const kafkaDefaults = {
    brokers: 3,
    topics: 20,
    partitions: 12,
    replicationFactor: 3,
    minInsync: 2,
    acks: 'all',
    messageSizeKb: 4,
    batchMs: 10,
    compression: 'lz4',
    retentionHours: 168,
    diskGbPerBroker: 2000,
    throughputMbsPerBroker: 250,
    produceLatencyMs: 5,
    consumerGroups: 4,
    consumersPerGroup: 6,
    orderingScope: 'per-partition',
    availability: 0.9995,
    costPerInstanceHour: 0.45,
    costPerGbMonth: 0.1,
};

function kafkaMessageBytes(params: typeof kafkaDefaults): number {
    return (params.messageSizeKb * 1000) / (COMPRESSION_RATIO[params.compression] ?? 1);
}

const kafkaModel = defineModel<typeof kafkaDefaults>({
    serviceSec: (ctx) => ctx.params.produceLatencyMs / 1000,
    resources: (ctx) => [
        partitionBound(
            'partitions',
            ctx.params.partitions,
            (PARTITION_THROUGHPUT_MBS * 1e6) / kafkaMessageBytes(ctx.params),
        ),
        bandwidthBound(
            'broker-network',
            ctx.params.brokers * ctx.params.throughputMbsPerBroker * 8,
            kafkaMessageBytes(ctx.params) * (ctx.params.replicationFactor + ctx.params.consumerGroups),
        ),
    ],
    storage: (ctx) => {
        const messageBytes = kafkaMessageBytes(ctx.params);
        const growthGbDay =
            (ctx.writeRps * SECONDS_PER_DAY * messageBytes * ctx.params.replicationFactor) / 1e9;
        const retainedDays = Math.min(ctx.params.retentionHours / 24, ctx.horizonDays);

        return {
            totalGb: growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'writeRps × 86400 × messageSizeKb × 1000 / compressionRatio × RF / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        messageSizeKb: ctx.params.messageSizeKb,
                        compressionRatio: COMPRESSION_RATIO[ctx.params.compression] ?? 1,
                        RF: ctx.params.replicationFactor,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × min(retentionHours / 24, horizonDays)',
                    {
                        growthGbDay,
                        retentionHours: ctx.params.retentionHours,
                        horizonDays: ctx.horizonDays,
                    },
                    growthGbDay * retainedDays,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.brokers * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const kafka = defineComponent({
    id: 'kafka',
    group: 'messaging',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-log-stream',
    ports: {
        in: [{ id: 'produce', protocols: ['kafka'], role: 'serve' }],
        out: [{ id: 'consume', protocols: ['kafka'], role: 'emit' }],
    },
    defaultParams: kafkaDefaults,
    paramSchema: {
        brokers: num('topology', { min: 1, max: 500, realistic: { min: 3, max: 30 } }),
        topics: num('topology', { min: 1, max: 10000 }),
        partitions: num('capacity', { min: 1, max: 10000, realistic: { min: 3, max: 200 } }),
        replicationFactor: num('reliability', { min: 1, max: 9, realistic: { min: 2, max: 3 } }),
        minInsync: num('reliability', { min: 1, max: 9 }),
        acks: choice('reliability', ['none', 'leader', 'all']),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        batchMs: num('behaviour', { unitKey: 'ms', min: 0, max: 10000 }),
        compression: choice('data', ['none', 'gzip', 'snappy', 'lz4', 'zstd']),
        retentionHours: num('data', { min: 1, max: 8760, realistic: { min: 24, max: 720 } }),
        diskGbPerBroker: num('capacity', { unitKey: 'gb', min: 10, max: 500000 }),
        throughputMbsPerBroker: num('capacity', { min: 1, max: 10000, realistic: { min: 100, max: 500 } }),
        produceLatencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1 }),
        consumerGroups: num('scale', { min: 0, max: 1000 }),
        consumersPerGroup: num('scale', { min: 1, max: 10000 }),
        orderingScope: choice('consistency', ['none', 'per-key', 'per-partition', 'global']),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: kafkaModel,
    helpId: 'kafka',
});

const rabbitmqDefaults = {
    nodes: 3,
    queues: 20,
    quorumQueues: true,
    throughputPerQueue: 20000,
    prefetch: 32,
    ackMode: 'manual',
    messageSizeKb: 2,
    maxQueueDepth: 100000,
    lazyQueues: false,
    ttlSec: 3600,
    priorityLevels: 1,
    dlqEnabled: true,
    publishLatencyMs: 2,
    memoryGb: 16,
    diskGb: 200,
    availability: 0.999,
    costPerInstanceHour: 0.25,
};

function rabbitmqCopies(params: typeof rabbitmqDefaults): number {
    return params.quorumQueues ? Math.min(params.nodes, QUORUM_QUEUE_REPLICAS) : 1;
}

const rabbitmqModel = defineModel<typeof rabbitmqDefaults>({
    serviceSec: (ctx) => ctx.params.publishLatencyMs / 1000,
    resources: (ctx) => [
        partitionBound('queues', ctx.params.queues, ctx.params.throughputPerQueue),
        explicitRps(
            'nodes',
            ctx.params.nodes,
            RABBITMQ_OPS_PER_NODE * (ctx.params.quorumQueues ? QUORUM_QUEUE_PENALTY : 1),
        ),
    ],
    storage: (ctx) => {
        const messageBytes = ctx.params.messageSizeKb * 1000;
        const copies = rabbitmqCopies(ctx.params);
        const backlogMessages = Math.min(
            ctx.writeRps * ctx.params.ttlSec,
            ctx.params.maxQueueDepth * ctx.params.queues,
        );
        const totalGb = (backlogMessages * messageBytes * copies) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * messageBytes * copies) / 1e9;

        return {
            totalGb,
            growthGbDay,
            memoryGb: ctx.params.lazyQueues ? 0 : totalGb,
            explain: [
                explain(
                    'min(writeRps × ttlSec, maxQueueDepth × queues) × messageBytes × copies / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        ttlSec: ctx.params.ttlSec,
                        maxQueueDepth: ctx.params.maxQueueDepth,
                        queues: ctx.params.queues,
                        messageBytes,
                        copies,
                    },
                    totalGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × messageBytes × copies / 10⁹',
                    { writeRps: ctx.writeRps, messageBytes, copies },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.nodes * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const rabbitmq = defineComponent({
    id: 'rabbitmq',
    group: 'messaging',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-queue',
    ports: {
        in: [{ id: 'in', protocols: ['amqp'], role: 'serve' }],
        out: [
            { id: 'consume', protocols: ['amqp'], role: 'emit' },
            { id: 'dlq', protocols: ['amqp'], role: 'emit' },
        ],
    },
    defaultParams: rabbitmqDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 100, realistic: { min: 3, max: 7 } }),
        queues: num('topology', { min: 1, max: 100000 }),
        quorumQueues: bool('reliability'),
        throughputPerQueue: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 20000, max: 50000 } }),
        prefetch: num('behaviour', { min: 1, max: 10000 }),
        ackMode: choice('behaviour', ['auto', 'manual']),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        maxQueueDepth: num('capacity', { min: 100, max: 100000000 }),
        lazyQueues: bool('behaviour'),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 604800 }),
        priorityLevels: num('behaviour', { min: 1, max: 10 }),
        dlqEnabled: bool('reliability'),
        publishLatencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 1024, step: 0.5 }),
        diskGb: num('capacity', { unitKey: 'gb', min: 1, max: 100000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: rabbitmqModel,
    helpId: 'rabbitmq',
});

const sqsDefaults = {
    queueType: 'standard',
    visibilityTimeoutSec: 30,
    maxReceiveCount: 5,
    dlqEnabled: true,
    batchSize: 10,
    messageSizeKb: 8,
    retentionHours: 96,
    longPollingSec: 20,
    delaySec: 0,
    fifoThroughputLimit: 3000,
    maxInflight: 120000,
    publishLatencyMs: 10,
    availability: 0.9999,
    costPerMillionRequests: 0.4,
};

const sqsModel = defineModel<typeof sqsDefaults>({
    serviceSec: (ctx) => ctx.params.publishLatencyMs / 1000,
    resources: (ctx) => [
        littleLaw('inflight', ctx.params.maxInflight, ctx.params.visibilityTimeoutSec),
        ctx.params.queueType === 'fifo' ? quotaBound('fifo-quota', ctx.params.fifoThroughputLimit) : null,
    ],
    storage: (ctx) => {
        const messageBytes = ctx.params.messageSizeKb * 1000;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * messageBytes) / 1e9;
        const totalGb = (ctx.writeRps * ctx.params.retentionHours * SECONDS_PER_HOUR * messageBytes) / 1e9;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'writeRps × retentionHours × 3600 × messageBytes / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        retentionHours: ctx.params.retentionHours,
                        messageBytes,
                    },
                    totalGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × messageBytes / 10⁹',
                    { writeRps: ctx.writeRps, messageBytes },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests:
                (requestsPerMonthMillions(ctx.lambda) * SQS_API_CALLS_PER_MESSAGE * ctx.params.costPerMillionRequests) /
                Math.max(ctx.params.batchSize, 1),
        }),
    availability: (params) => params.availability,
});

const sqs = defineComponent({
    id: 'sqs',
    group: 'messaging',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-queue-managed',
    ports: {
        in: [{ id: 'in', protocols: ['sqs'], role: 'serve' }],
        out: [
            { id: 'consume', protocols: ['sqs'], role: 'emit' },
            { id: 'dlq', protocols: ['sqs'], role: 'emit' },
        ],
    },
    defaultParams: sqsDefaults,
    paramSchema: {
        queueType: choice('behaviour', ['standard', 'fifo']),
        visibilityTimeoutSec: num('behaviour', { unitKey: 'sec', min: 0, max: 43200 }),
        maxReceiveCount: num('reliability', { min: 1, max: 1000 }),
        dlqEnabled: bool('reliability'),
        batchSize: num('behaviour', { min: 1, max: 10 }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 256, step: 0.05 }),
        retentionHours: num('data', { min: 1, max: 336 }),
        longPollingSec: num('behaviour', { unitKey: 'sec', min: 0, max: 20 }),
        delaySec: num('behaviour', { unitKey: 'sec', min: 0, max: 900 }),
        fifoThroughputLimit: num('capacity', { unitKey: 'rps', min: 300, max: 70000 }),
        maxInflight: num('capacity', { min: 1000, max: 1000000 }),
        publishLatencyMs: num('performance', { unitKey: 'ms', min: 0.5, max: 10000, step: 0.5 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: sqsModel,
    helpId: 'sqs',
});

const dlqDefaults = {
    maxRetries: 5,
    reprocessMode: 'manual',
    reprocessBatchSize: 50,
    redriveDelaySec: 300,
    alertThresholdMessages: 100,
    notifyOnArrival: true,
    maxDepth: 1000000,
    retentionHours: 336,
    messageSizeKb: 4,
    costPerMillionRequests: 0.4,
};

const dlqModel = defineModel<typeof dlqDefaults>({
    serviceSec: () => DLQ_PUBLISH_LATENCY_MS / 1000,
    resources: (ctx) => [
        littleLaw('depth', ctx.params.maxDepth, ctx.params.retentionHours * SECONDS_PER_HOUR),
    ],
    storage: (ctx) => {
        const messageBytes = ctx.params.messageSizeKb * 1000;
        const retainedMessages = Math.min(
            ctx.writeRps * ctx.params.retentionHours * SECONDS_PER_HOUR,
            ctx.params.maxDepth,
        );
        const totalGb = (retainedMessages * messageBytes) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * messageBytes) / 1e9;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'min(writeRps × retentionHours × 3600, maxDepth) × messageBytes / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        retentionHours: ctx.params.retentionHours,
                        maxDepth: ctx.params.maxDepth,
                        messageBytes,
                    },
                    totalGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × messageBytes / 10⁹',
                    { writeRps: ctx.writeRps, messageBytes },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests: requestsPerMonthMillions(ctx.lambda) * ctx.params.costPerMillionRequests,
        }),
});

const dlq = defineComponent({
    id: 'dlq',
    group: 'messaging',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-dlq',
    ports: {
        in: [{ id: 'in', protocols: ['kafka', 'amqp', 'sqs'], role: 'serve' }],
        out: [{ id: 'reprocess', protocols: ['kafka', 'amqp', 'sqs'], role: 'emit' }],
    },
    defaultParams: dlqDefaults,
    paramSchema: {
        maxRetries: num('reliability', { min: 0, max: 100 }),
        reprocessMode: choice('behaviour', ['manual', 'auto', 'scheduled']),
        reprocessBatchSize: num('behaviour', { min: 1, max: 10000 }),
        redriveDelaySec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        alertThresholdMessages: num('reliability', { min: 1, max: 10000000 }),
        notifyOnArrival: bool('reliability'),
        maxDepth: num('capacity', { min: 100, max: 1000000000 }),
        retentionHours: num('data', { min: 1, max: 8760 }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: dlqModel,
    helpId: 'dlq',
});

export const messagingComponents: ComponentDefinition[] = [
    kafka,
    rabbitmq,
    sqs,
    dlq,
] as unknown as ComponentDefinition[];
