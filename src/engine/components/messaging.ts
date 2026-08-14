import type { ComponentDefinition } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explain,
    explicitRps,
    littleLaw,
    memoryResidencyBound,
    partitionBound,
    quotaBound,
    resourceLimit,
    totalCost,
    weightedUnitBound,
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

const DLQ_INGEST_RPS = 3000;

const SECONDS_PER_HOUR = 3600;

const SNS_FILTER_MATCH_SHARE: Record<string, number> = {
    none: 1,
    attributes: 0.5,
    body: 0.3,
};

const SNS_RETRY_FAILURE_SHARE = 0.02;

const NATS_RETENTION_SHARE: Record<string, number> = {
    limits: 1,
    interest: 0.3,
    workqueue: 0.05,
};

const NATS_SUBJECT_INDEX_BYTES = 4096;

const KINESIS_EGRESS_MBS_PER_SHARD = 2;

const KINESIS_PAYLOAD_UNIT_BYTES = 25000;

const REDIS_STREAM_ENTRY_OVERHEAD_BYTES = 120;

const REDIS_STREAM_MEMORY_SHARE = 0.75;

const REDIS_STREAM_BUFFER_SEC = 300;

const CDC_SOURCE_THROUGHPUT_FACTOR: Record<string, number> = {
    postgres: 1,
    mysql: 1.2,
    mongodb: 0.8,
    sqlserver: 0.6,
};

const CDC_SNAPSHOT_PENALTY: Record<string, number> = {
    never: 1,
    'schema-only': 0.95,
    initial: 0.7,
    always: 0.4,
};

const CDC_CHANGES_PER_TASK = 12000;

const SCHEDULER_DELAY_MEAN_SHARE: Record<string, number> = {
    flat: 0.5,
    exponential: 0.25,
    'long-tail': 0.7,
};

const SCHEDULED_JOB_OVERHEAD_BYTES = 100;

const SCHEDULER_MEMORY_SHARE = 0.75;

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
    managed: true,
});

const dlqDefaults = {
    maxRetries: 5,
    reprocessMode: 'manual',
    reprocessBatchSize: 50,
    redriveDelaySec: 300,
    alertThresholdMessages: 100,
    notifyOnArrival: true,
    maxDepth: 100000000,
    retentionHours: 336,
    messageSizeKb: 4,
    costPerMillionRequests: 0.4,
};

const dlqModel = defineModel<typeof dlqDefaults>({
    serviceSec: () => DLQ_PUBLISH_LATENCY_MS / 1000,
    resources: (ctx) => [
        quotaBound('rate-limit', DLQ_INGEST_RPS),
        resourceLimit(
            'depth',
            ctx.params.maxDepth / (ctx.params.retentionHours * SECONDS_PER_HOUR),
            'maxDepth / (retentionHours × 3600)',
            { maxDepth: ctx.params.maxDepth, retentionHours: ctx.params.retentionHours },
        ),
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
    managed: true,
});

const snsDefaults = {
    subscribers: 6,
    fanout: true,
    filterPolicy: 'none',
    maxRetries: 3,
    messageSizeKb: 4,
    rateLimitRps: 30000,
    networkMbps: 10000,
    publishLatencyMs: 8,
    availability: 0.9995,
    costPerMillionRequests: 0.5,
};

function snsDeliveriesPerPublish(params: typeof snsDefaults): number {
    const matched = params.fanout
        ? params.subscribers * (SNS_FILTER_MATCH_SHARE[params.filterPolicy] ?? 1)
        : 1;

    return Math.max(matched, 1) * (1 + params.maxRetries * SNS_RETRY_FAILURE_SHARE);
}

const snsModel = defineModel<typeof snsDefaults>({
    serviceSec: (ctx) => ctx.params.publishLatencyMs / 1000,
    resources: (ctx) => [
        resourceLimit(
            'fanout',
            ctx.params.rateLimitRps / snsDeliveriesPerPublish(ctx.params),
            'rateLimitRps / deliveriesPerPublish',
            {
                rateLimitRps: ctx.params.rateLimitRps,
                deliveriesPerPublish: snsDeliveriesPerPublish(ctx.params),
            },
        ),
        bandwidthBound(
            'broker-network',
            ctx.params.networkMbps,
            ctx.params.messageSizeKb * 1000 * snsDeliveriesPerPublish(ctx.params),
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests:
                requestsPerMonthMillions(ctx.lambda) *
                (1 + snsDeliveriesPerPublish(ctx.params)) *
                ctx.params.costPerMillionRequests,
        }),
    availability: (params) => params.availability,
});

const sns = defineComponent({
    id: 'sns',
    group: 'messaging',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-fanout',
    ports: {
        in: [{ id: 'publish', protocols: ['http', 'sqs'], role: 'serve' }],
        out: [
            { id: 'fanout', protocols: ['http', 'sqs'], role: 'emit' },
            { id: 'dlq', protocols: ['sqs'], role: 'emit' },
        ],
    },
    defaultParams: snsDefaults,
    paramSchema: {
        subscribers: num('scale', { min: 1, max: 100000, realistic: { min: 2, max: 50 } }),
        fanout: bool('behaviour'),
        filterPolicy: choice('behaviour', ['none', 'attributes', 'body']),
        maxRetries: num('reliability', { min: 0, max: 100 }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 256, step: 0.05 }),
        rateLimitRps: num('capacity', { unitKey: 'rps', min: 100, max: 10000000, realistic: { min: 3000, max: 30000 } }),
        networkMbps: num('capacity', { unitKey: 'mbps', min: 10, max: 100000 }),
        publishLatencyMs: num('performance', { unitKey: 'ms', min: 0.5, max: 10000, step: 0.5 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: snsModel,
    helpId: 'sns',
    managed: true,
});

const natsDefaults = {
    nodes: 3,
    subjects: 200,
    streamRetention: 'limits',
    maxAckPending: 2000,
    maxOpsPerSecPerNode: 150000,
    messageSizeKb: 1,
    retentionHours: 24,
    processingTimeMs: 5,
    publishLatencyMs: 0.5,
    availability: 0.999,
    costPerInstanceHour: 0.15,
};

const natsModel = defineModel<typeof natsDefaults>({
    serviceSec: (ctx) => ctx.params.publishLatencyMs / 1000,
    resources: (ctx) => [
        explicitRps('throughput', ctx.params.nodes, ctx.params.maxOpsPerSecPerNode),
        littleLaw('inflight', ctx.params.maxAckPending, ctx.params.processingTimeMs / 1000),
    ],
    storage: (ctx) => {
        const messageBytes = ctx.params.messageSizeKb * 1000;
        const retainedShare = NATS_RETENTION_SHARE[ctx.params.streamRetention] ?? 1;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * messageBytes * retainedShare) / 1e9;
        const retainedDays = Math.min(ctx.params.retentionHours / 24, ctx.horizonDays);
        const indexGb = (ctx.params.subjects * NATS_SUBJECT_INDEX_BYTES) / 1e9;

        return {
            totalGb: growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: indexGb,
            explain: [
                explain(
                    'writeRps × 86400 × messageBytes × retainedShare / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        messageBytes,
                        retainedShare,
                        streamRetention: ctx.params.streamRetention,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'subjects × subjectIndexBytes / 10⁹',
                    { subjects: ctx.params.subjects, subjectIndexBytes: NATS_SUBJECT_INDEX_BYTES },
                    indexGb,
                    'gb',
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

const nats = defineComponent({
    id: 'nats',
    group: 'messaging',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-queue',
    ports: {
        in: [{ id: 'publish', protocols: ['stream', 'internal'], role: 'serve' }],
        out: [{ id: 'consume', protocols: ['stream', 'internal'], role: 'emit' }],
    },
    defaultParams: natsDefaults,
    paramSchema: {
        nodes: num('topology', { min: 1, max: 100, realistic: { min: 3, max: 9 } }),
        subjects: num('topology', { min: 1, max: 1000000 }),
        streamRetention: choice('data', ['limits', 'interest', 'workqueue']),
        maxAckPending: num('behaviour', { min: 1, max: 1000000, realistic: { min: 1000, max: 20000 } }),
        maxOpsPerSecPerNode: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 50000, max: 300000 } }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        retentionHours: num('data', { min: 1, max: 8760 }),
        processingTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 600000, step: 0.1 }),
        publishLatencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: natsModel,
    helpId: 'nats',
});

const kinesisDefaults = {
    shards: 8,
    mbPerShardIn: 1,
    recordsPerShard: 1000,
    enhancedFanout: false,
    consumerGroups: 2,
    messageSizeKb: 2,
    retentionHours: 24,
    publishLatencyMs: 20,
    availability: 0.9999,
    costPerShardHour: 0.015,
    costPerMillionRequests: 0.014,
};

function kinesisRecordBytes(params: typeof kinesisDefaults): number {
    return params.messageSizeKb * 1000;
}

function kinesisEgressMbps(params: typeof kinesisDefaults): number {
    const dedicatedStreams = params.enhancedFanout ? params.consumerGroups : 1;

    return params.shards * KINESIS_EGRESS_MBS_PER_SHARD * dedicatedStreams * 8;
}

const kinesisModel = defineModel<typeof kinesisDefaults>({
    serviceSec: (ctx) => ctx.params.publishLatencyMs / 1000,
    resources: (ctx) => [
        partitionBound('shard-records', ctx.params.shards, ctx.params.recordsPerShard),
        bandwidthBound(
            'ingest-bandwidth',
            ctx.params.shards * ctx.params.mbPerShardIn * 8,
            kinesisRecordBytes(ctx.params),
        ),
        bandwidthBound(
            'broker-network',
            kinesisEgressMbps(ctx.params),
            kinesisRecordBytes(ctx.params) * ctx.params.consumerGroups,
        ),
    ],
    storage: (ctx) => {
        const recordBytes = kinesisRecordBytes(ctx.params);
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * recordBytes) / 1e9;
        const totalGb = (ctx.writeRps * ctx.params.retentionHours * SECONDS_PER_HOUR * recordBytes) / 1e9;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'writeRps × retentionHours × 3600 × recordBytes / 10⁹',
                    { writeRps: ctx.writeRps, retentionHours: ctx.params.retentionHours, recordBytes },
                    totalGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × recordBytes / 10⁹',
                    { writeRps: ctx.writeRps, recordBytes },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const payloadUnits = Math.max(
            1,
            Math.ceil(kinesisRecordBytes(ctx.params) / KINESIS_PAYLOAD_UNIT_BYTES),
        );

        return totalCost({
            compute:
                ctx.params.shards * ctx.params.costPerShardHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests:
                requestsPerMonthMillions(ctx.lambda) * payloadUnits * ctx.params.costPerMillionRequests,
        });
    },
    availability: (params) => params.availability,
});

const kinesis = defineComponent({
    id: 'kinesis',
    group: 'messaging',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-log-stream',
    ports: {
        in: [{ id: 'produce', protocols: ['stream'], role: 'serve' }],
        out: [{ id: 'consume', protocols: ['stream'], role: 'emit' }],
    },
    defaultParams: kinesisDefaults,
    paramSchema: {
        shards: num('capacity', { min: 1, max: 10000, realistic: { min: 2, max: 500 } }),
        mbPerShardIn: num('capacity', { min: 0.1, max: 16, step: 0.1 }),
        recordsPerShard: num('capacity', { unitKey: 'rps', min: 100, max: 100000 }),
        enhancedFanout: bool('behaviour'),
        consumerGroups: num('scale', { min: 1, max: 20 }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 1024, step: 0.05 }),
        retentionHours: num('data', { min: 24, max: 8760 }),
        publishLatencyMs: num('performance', { unitKey: 'ms', min: 0.5, max: 10000, step: 0.5 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerShardHour: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
    },
    model: kinesisModel,
    helpId: 'kinesis',
    managed: true,
});

const redisStreamsDefaults = {
    shards: 3,
    maxLen: 10000000,
    consumerGroups: 4,
    pendingLimit: 10000,
    memoryGb: 8,
    maxOpsPerSec: 120000,
    messageSizeKb: 1,
    processingTimeMs: 20,
    serviceTimeMs: 0.3,
    availability: 0.999,
    costPerInstanceHour: 0.2,
};

function redisStreamEntryBytes(params: typeof redisStreamsDefaults): number {
    return params.messageSizeKb * 1000 + REDIS_STREAM_ENTRY_OVERHEAD_BYTES;
}

function redisStreamUsableGb(params: typeof redisStreamsDefaults): number {
    return params.shards * params.memoryGb * REDIS_STREAM_MEMORY_SHARE;
}

const redisStreamsModel = defineModel<typeof redisStreamsDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => [
        explicitRps('ops', ctx.params.shards, ctx.params.maxOpsPerSec),
        partitionBound('partitions', ctx.params.shards, ctx.params.maxLen / REDIS_STREAM_BUFFER_SEC),
        littleLaw(
            'inflight',
            ctx.params.pendingLimit * ctx.params.consumerGroups,
            ctx.params.processingTimeMs / 1000,
        ),
        memoryResidencyBound(
            'memory',
            redisStreamUsableGb(ctx.params),
            (redisStreamEntryBytes(ctx.params) * REDIS_STREAM_BUFFER_SEC) / 1e9,
        ),
    ],
    storage: (ctx) => {
        const entryBytes = redisStreamEntryBytes(ctx.params);
        const retainedEntries = Math.min(
            ctx.params.maxLen * ctx.params.shards,
            ctx.writeRps * SECONDS_PER_DAY * ctx.horizonDays,
        );
        const totalGb = (retainedEntries * entryBytes) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * entryBytes) / 1e9;

        return {
            totalGb,
            growthGbDay,
            memoryGb: totalGb,
            explain: [
                explain(
                    'min(maxLen × shards, writeRps × 86400 × horizonDays) × entryBytes / 10⁹',
                    {
                        maxLen: ctx.params.maxLen,
                        shards: ctx.params.shards,
                        writeRps: ctx.writeRps,
                        horizonDays: ctx.horizonDays,
                        entryBytes,
                    },
                    totalGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × entryBytes / 10⁹',
                    { writeRps: ctx.writeRps, entryBytes },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.params.shards * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const redisStreams = defineComponent({
    id: 'redis-streams',
    group: 'messaging',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-log-stream',
    ports: {
        in: [{ id: 'produce', protocols: ['redis'], role: 'serve' }],
        out: [{ id: 'consume', protocols: ['stream'], role: 'emit' }],
    },
    defaultParams: redisStreamsDefaults,
    paramSchema: {
        shards: num('topology', { min: 1, max: 500, realistic: { min: 1, max: 20 } }),
        maxLen: num('capacity', { min: 1000, max: 1000000000, realistic: { min: 100000, max: 50000000 } }),
        consumerGroups: num('scale', { min: 1, max: 1000 }),
        pendingLimit: num('behaviour', { min: 1, max: 10000000, realistic: { min: 1000, max: 100000 } }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.1, max: 4096, step: 0.1 }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 1000, max: 10000000, realistic: { min: 80000, max: 150000 } }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        processingTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 600000, step: 0.1 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: redisStreamsModel,
    helpId: 'redis-streams',
});

const outboxDefaults = {
    instances: 2,
    pollIntervalMs: 100,
    batchSize: 200,
    backlogRows: 50000,
    publishLagMs: 500,
    rowSizeBytes: 512,
    retentionHours: 24,
    costPerInstanceHour: 0.05,
};

function outboxDrainRps(params: typeof outboxDefaults, instances: number): number {
    return (instances * params.batchSize * 1000) / params.pollIntervalMs;
}

const outboxModel = defineModel<typeof outboxDefaults>({
    serviceSec: (ctx) => ctx.params.publishLagMs / 1000,
    resources: (ctx) => [
        resourceLimit(
            'poll-batch',
            outboxDrainRps(ctx.params, ctx.instances),
            'instances × batchSize × 1000 / pollIntervalMs',
            {
                instances: ctx.instances,
                batchSize: ctx.params.batchSize,
                pollIntervalMs: ctx.params.pollIntervalMs,
            },
        ),
        littleLaw('depth', ctx.params.backlogRows, ctx.params.publishLagMs / 1000),
    ],
    storage: (ctx) => {
        const pendingRows = Math.min(
            ctx.writeRps * (ctx.params.publishLagMs / 1000),
            ctx.params.backlogRows,
        );
        const publishedRows = ctx.writeRps * ctx.params.retentionHours * SECONDS_PER_HOUR;
        const totalGb = ((pendingRows + publishedRows) * ctx.params.rowSizeBytes) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * ctx.params.rowSizeBytes) / 1e9;

        return {
            totalGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    '(min(writeRps × publishLagSec, backlogRows) + writeRps × retentionHours × 3600) × rowSizeBytes / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        publishLagSec: ctx.params.publishLagMs / 1000,
                        backlogRows: ctx.params.backlogRows,
                        retentionHours: ctx.params.retentionHours,
                        rowSizeBytes: ctx.params.rowSizeBytes,
                    },
                    totalGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × rowSizeBytes / 10⁹',
                    { writeRps: ctx.writeRps, rowSizeBytes: ctx.params.rowSizeBytes },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
});

const outbox = defineComponent({
    id: 'outbox',
    group: 'messaging',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-outbox',
    ports: {
        in: [{ id: 'in', protocols: ['sql', 'internal'], role: 'serve' }],
        out: [{ id: 'publish', protocols: ['kafka', 'amqp', 'sqs'], role: 'emit' }],
    },
    defaultParams: outboxDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 500 }),
        pollIntervalMs: num('behaviour', { unitKey: 'ms', min: 1, max: 60000, realistic: { min: 50, max: 1000 } }),
        batchSize: num('behaviour', { min: 1, max: 100000, realistic: { min: 100, max: 1000 } }),
        backlogRows: num('capacity', { min: 100, max: 1000000000 }),
        publishLagMs: num('performance', { unitKey: 'ms', min: 1, max: 600000, realistic: { min: 100, max: 5000 } }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
        retentionHours: num('data', { min: 0, max: 8760 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: outboxModel,
    helpId: 'outbox',
});

const cdcDefaults = {
    sourceDb: 'postgres',
    changesPerSec: 20000,
    snapshotMode: 'initial',
    lagMs: 500,
    walRetentionGb: 16,
    instances: 2,
    messageSizeKb: 1,
    publishLatencyMs: 5,
    availability: 0.999,
    costPerInstanceHour: 0.2,
};

function cdcCaptureRps(params: typeof cdcDefaults): number {
    const sourceFactor = CDC_SOURCE_THROUGHPUT_FACTOR[params.sourceDb] ?? 1;
    const snapshotPenalty = CDC_SNAPSHOT_PENALTY[params.snapshotMode] ?? 1;

    return params.changesPerSec * sourceFactor * snapshotPenalty;
}

const cdcModel = defineModel<typeof cdcDefaults>({
    serviceSec: (ctx) => ctx.params.publishLatencyMs / 1000,
    resources: (ctx) => [
        resourceLimit(
            'source',
            cdcCaptureRps(ctx.params),
            'changesPerSec × sourceFactor × snapshotPenalty',
            {
                changesPerSec: ctx.params.changesPerSec,
                sourceFactor: CDC_SOURCE_THROUGHPUT_FACTOR[ctx.params.sourceDb] ?? 1,
                snapshotPenalty: CDC_SNAPSHOT_PENALTY[ctx.params.snapshotMode] ?? 1,
            },
        ),
        explicitRps('workers', ctx.instances, CDC_CHANGES_PER_TASK),
        resourceLimit(
            'depth',
            (ctx.params.walRetentionGb * 1e9) / (ctx.params.messageSizeKb * 1000 * (ctx.params.lagMs / 1000)),
            'walRetentionGb × 10⁹ / (changeBytes × lagSec)',
            {
                walRetentionGb: ctx.params.walRetentionGb,
                changeBytes: ctx.params.messageSizeKb * 1000,
                lagSec: ctx.params.lagMs / 1000,
            },
        ),
    ],
    storage: (ctx) => {
        const changeBytes = ctx.params.messageSizeKb * 1000;
        const unshippedGb = Math.min(
            (ctx.writeRps * (ctx.params.lagMs / 1000) * changeBytes) / 1e9,
            ctx.params.walRetentionGb,
        );
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * changeBytes) / 1e9;

        return {
            totalGb: unshippedGb,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'min(writeRps × lagSec × changeBytes / 10⁹, walRetentionGb)',
                    {
                        writeRps: ctx.writeRps,
                        lagSec: ctx.params.lagMs / 1000,
                        changeBytes,
                        walRetentionGb: ctx.params.walRetentionGb,
                    },
                    unshippedGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × changeBytes / 10⁹',
                    { writeRps: ctx.writeRps, changeBytes },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
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

const cdc = defineComponent({
    id: 'cdc',
    group: 'messaging',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-cdc',
    ports: {
        in: [{ id: 'source', protocols: ['sql', 'nosql'], role: 'consume' }],
        out: [{ id: 'publish', protocols: ['kafka', 'stream'], role: 'emit' }],
    },
    defaultParams: cdcDefaults,
    paramSchema: {
        sourceDb: choice('topology', ['postgres', 'mysql', 'mongodb', 'sqlserver']),
        changesPerSec: num('capacity', { unitKey: 'rps', min: 1, max: 10000000, realistic: { min: 1000, max: 100000 } }),
        snapshotMode: choice('behaviour', ['never', 'schema-only', 'initial', 'always']),
        lagMs: num('performance', { unitKey: 'ms', min: 1, max: 3600000, realistic: { min: 100, max: 10000 } }),
        walRetentionGb: num('capacity', { unitKey: 'gb', min: 1, max: 100000 }),
        instances: num('scale', { min: 1, max: 500 }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        publishLatencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: cdcModel,
    helpId: 'cdc',
});

const schedulerQueueDefaults = {
    delayDistribution: 'flat',
    maxDelayHours: 24,
    pendingJobs: 20000000,
    instances: 2,
    batchSize: 500,
    pollIntervalSec: 1,
    memoryGb: 32,
    messageSizeKb: 2,
    publishLatencyMs: 5,
    availability: 0.999,
    costPerInstanceHour: 0.2,
};

function schedulerAverageDelaySec(params: typeof schedulerQueueDefaults): number {
    return (
        params.maxDelayHours *
        SECONDS_PER_HOUR *
        (SCHEDULER_DELAY_MEAN_SHARE[params.delayDistribution] ?? 0.5)
    );
}

function schedulerJobBytes(params: typeof schedulerQueueDefaults): number {
    return params.messageSizeKb * 1000 + SCHEDULED_JOB_OVERHEAD_BYTES;
}

const schedulerQueueModel = defineModel<typeof schedulerQueueDefaults>({
    serviceSec: (ctx) => ctx.params.publishLatencyMs / 1000,
    resources: (ctx) => [
        resourceLimit(
            'poll-batch',
            (ctx.instances * ctx.params.batchSize) / ctx.params.pollIntervalSec,
            'instances × batchSize / pollIntervalSec',
            {
                instances: ctx.instances,
                batchSize: ctx.params.batchSize,
                pollIntervalSec: ctx.params.pollIntervalSec,
            },
        ),
        littleLaw('depth', ctx.params.pendingJobs, schedulerAverageDelaySec(ctx.params)),
        memoryResidencyBound(
            'memory',
            ctx.params.memoryGb * SCHEDULER_MEMORY_SHARE,
            (schedulerJobBytes(ctx.params) * schedulerAverageDelaySec(ctx.params)) / 1e9,
        ),
    ],
    storage: (ctx) => {
        const jobBytes = schedulerJobBytes(ctx.params);
        const averageDelaySec = schedulerAverageDelaySec(ctx.params);
        const residentJobs = Math.min(ctx.writeRps * averageDelaySec, ctx.params.pendingJobs);
        const totalGb = (residentJobs * jobBytes) / 1e9;
        const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * jobBytes) / 1e9;

        return {
            totalGb,
            growthGbDay,
            memoryGb: totalGb,
            explain: [
                explain(
                    'min(writeRps × averageDelaySec, pendingJobs) × jobBytes / 10⁹',
                    {
                        writeRps: ctx.writeRps,
                        averageDelaySec,
                        delayDistribution: ctx.params.delayDistribution,
                        pendingJobs: ctx.params.pendingJobs,
                        jobBytes,
                    },
                    totalGb,
                    'gb',
                ),
                explain(
                    'writeRps × 86400 × jobBytes / 10⁹',
                    { writeRps: ctx.writeRps, jobBytes },
                    growthGbDay,
                    'gb/day',
                ),
            ],
        };
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

const schedulerQueue = defineComponent({
    id: 'scheduler-queue',
    group: 'messaging',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-scheduler-queue',
    ports: {
        in: [{ id: 'schedule', protocols: ['http', 'internal'], role: 'serve' }],
        out: [{ id: 'due', protocols: ['amqp', 'sqs', 'internal'], role: 'emit' }],
    },
    defaultParams: schedulerQueueDefaults,
    paramSchema: {
        delayDistribution: choice('behaviour', ['flat', 'exponential', 'long-tail']),
        maxDelayHours: num('behaviour', { min: 0.1, max: 8760, step: 0.1, realistic: { min: 1, max: 720 } }),
        pendingJobs: num('capacity', { min: 100, max: 10000000000 }),
        instances: num('scale', { min: 1, max: 500 }),
        batchSize: num('behaviour', { min: 1, max: 100000 }),
        pollIntervalSec: num('behaviour', { unitKey: 'sec', min: 0.1, max: 3600, step: 0.1 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.1, max: 4096, step: 0.1 }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        publishLatencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: schedulerQueueModel,
    helpId: 'scheduler-queue',
});

const PULSAR_OFFLOAD_STREAM_COPIES = 1;

const pulsarDefaults = {
    brokers: 3,
    bookies: 4,
    topics: 20,
    partitions: 12,
    replicationFactor: 3,
    minInsync: 2,
    subscriptionType: 'shared',
    consumerGroups: 4,
    consumersPerGroup: 6,
    messageSizeKb: 4,
    compression: 'lz4',
    batchMs: 10,
    retentionHours: 168,
    tieredStorage: true,
    tieredOffloadHours: 24,
    diskGbPerBookie: 2000,
    throughputMbsPerBroker: 250,
    produceLatencyMs: 5,
    availability: 0.9995,
    costPerInstanceHour: 0.45,
    costPerGbMonth: 0.1,
    costPerGbMonthOffload: 0.023,
};

function pulsarMessageBytes(params: typeof pulsarDefaults): number {
    return (params.messageSizeKb * 1000) / (COMPRESSION_RATIO[params.compression] ?? 1);
}

function pulsarLocalRetentionHours(params: typeof pulsarDefaults): number {
    return params.tieredStorage
        ? Math.min(params.tieredOffloadHours, params.retentionHours)
        : params.retentionHours;
}

function pulsarLocalRetentionShare(params: typeof pulsarDefaults): number {
    return Math.min(1, pulsarLocalRetentionHours(params) / Math.max(params.retentionHours, 1));
}

function pulsarLocalDiskBytes(params: typeof pulsarDefaults): number {
    return params.bookies * params.diskGbPerBookie * 1e9;
}

function pulsarStreamCopies(params: typeof pulsarDefaults): number {
    return (
        params.replicationFactor +
        params.consumerGroups +
        (params.tieredStorage ? PULSAR_OFFLOAD_STREAM_COPIES : 0)
    );
}

const pulsarModel = defineModel<typeof pulsarDefaults>({
    serviceSec: (ctx) => ctx.params.produceLatencyMs / 1000,
    resources: (ctx) => {
        const messageBytes = pulsarMessageBytes(ctx.params);
        const localRetentionSec = pulsarLocalRetentionHours(ctx.params) * SECONDS_PER_HOUR;

        return [
            partitionBound(
                'partitions',
                ctx.params.partitions,
                (PARTITION_THROUGHPUT_MBS * 1e6) / messageBytes,
            ),
            bandwidthBound(
                'broker-network',
                ctx.params.brokers * ctx.params.throughputMbsPerBroker * 8,
                messageBytes * pulsarStreamCopies(ctx.params),
            ),
            weightedUnitBound(
                'retention-disk',
                'bookies × diskGbPerBookie × 10⁹ / (messageBytes × replicationFactor × localRetentionSec × writeShare)',
                {
                    bookies: ctx.params.bookies,
                    diskGbPerBookie: ctx.params.diskGbPerBookie,
                    messageBytes,
                    replicationFactor: ctx.params.replicationFactor,
                    localRetentionSec,
                    tieredStorage: String(ctx.params.tieredStorage),
                    writeShare: ctx.writeShare,
                },
                0,
                (messageBytes * ctx.params.replicationFactor * localRetentionSec) /
                    pulsarLocalDiskBytes(ctx.params),
                ctx.readShare,
                ctx.writeShare,
            ),
        ];
    },
    storage: (ctx) => {
        const messageBytes = pulsarMessageBytes(ctx.params);
        const growthGbDay =
            (ctx.writeRps * SECONDS_PER_DAY * messageBytes * ctx.params.replicationFactor) / 1e9;
        const retainedDays = Math.min(ctx.params.retentionHours / 24, ctx.horizonDays);
        const totalGb = growthGbDay * retainedDays;
        const localShare = pulsarLocalRetentionShare(ctx.params);

        return {
            totalGb,
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
                    totalGb,
                    'gb',
                ),
                explain(
                    'totalGb × localRetentionHours / retentionHours',
                    {
                        totalGb,
                        localRetentionHours: pulsarLocalRetentionHours(ctx.params),
                        retentionHours: ctx.params.retentionHours,
                        tieredStorage: String(ctx.params.tieredStorage),
                    },
                    totalGb * localShare,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) => {
        const localShare = pulsarLocalRetentionShare(ctx.params);

        return totalCost({
            compute:
                (ctx.params.brokers + ctx.params.bookies) *
                ctx.params.costPerInstanceHour *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage:
                ctx.storageGb * localShare * ctx.params.costPerGbMonth +
                ctx.storageGb * (1 - localShare) * ctx.params.costPerGbMonthOffload,
            network: 0,
            requests: 0,
        });
    },
    availability: (params) => params.availability,
});

const pulsar = defineComponent({
    id: 'pulsar',
    group: 'messaging',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-queue',
    ports: {
        in: [{ id: 'produce', protocols: ['kafka'], role: 'serve' }],
        out: [{ id: 'consume', protocols: ['kafka'], role: 'emit' }],
    },
    defaultParams: pulsarDefaults,
    paramSchema: {
        brokers: num('topology', { min: 1, max: 500, realistic: { min: 3, max: 30 } }),
        bookies: num('topology', { min: 1, max: 500, realistic: { min: 3, max: 40 } }),
        topics: num('topology', { min: 1, max: 1000000 }),
        partitions: num('capacity', { min: 1, max: 10000, realistic: { min: 3, max: 200 } }),
        replicationFactor: num('reliability', { min: 1, max: 9, realistic: { min: 2, max: 3 } }),
        minInsync: num('reliability', { min: 1, max: 9 }),
        subscriptionType: choice('consistency', ['exclusive', 'failover', 'shared', 'key-shared']),
        consumerGroups: num('scale', { min: 0, max: 1000 }),
        consumersPerGroup: num('scale', { min: 1, max: 10000 }),
        messageSizeKb: num('data', { unitKey: 'kb', min: 0.05, max: 10240, step: 0.05 }),
        compression: choice('data', ['none', 'gzip', 'snappy', 'lz4', 'zstd']),
        batchMs: num('behaviour', { unitKey: 'ms', min: 0, max: 10000 }),
        retentionHours: num('data', { min: 1, max: 87600, realistic: { min: 24, max: 8760 } }),
        tieredStorage: bool('data'),
        tieredOffloadHours: num('data', { min: 1, max: 8760, realistic: { min: 1, max: 168 } }),
        diskGbPerBookie: num('capacity', { unitKey: 'gb', min: 10, max: 500000 }),
        throughputMbsPerBroker: num('capacity', { min: 1, max: 10000, realistic: { min: 100, max: 500 } }),
        produceLatencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
        costPerGbMonthOffload: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
    },
    model: pulsarModel,
    helpId: 'pulsar',
});

export const messagingComponents: ComponentDefinition[] = [
    kafka,
    rabbitmq,
    sqs,
    sns,
    nats,
    kinesis,
    redisStreams,
    outbox,
    cdc,
    dlq,
    schedulerQueue,
    pulsar,
] as unknown as ComponentDefinition[];
