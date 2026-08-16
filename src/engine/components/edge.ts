import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    connectionBound,
    defineModel,
    explicitRps,
    littleLaw,
    memoryResidencyBound,
    quotaBound,
    resourceLimit,
    totalCost,
} from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const PROXY_IN: PortSpec['in'] = [{ id: 'in', protocols: ['http', 'grpc', 'ws'], role: 'serve' }];

const PROXY_OUT: PortSpec['out'] = [
    { id: 'upstream', protocols: ['http', 'grpc', 'ws', 'internal'], role: 'call' },
];

const ROUTING_POLICY = ['simple', 'latency', 'geo', 'weighted', 'failover'];

const CDN_RPS_PER_POP = 50000;

const CDN_GBPS_PER_POP = 10;

const PROXY_NETWORK_MBPS_PER_INSTANCE = 10000;

const L7_RPS_PER_CORE_TLS = 10000;

const L7_RPS_PER_CORE_PLAIN = 35000;

const KEEP_ALIVE_HANDSHAKE_SHARE = 0.1;

const SECONDS_PER_MINUTE = 60;

const KILOBYTES_PER_GIGABYTE = 1e6;

const WAF_INSPECTION_MS_PER_RULE = 0.004;

const RATE_LIMITER_LOCAL_OPS_PER_CORE = 2000000;

const SLIDING_WINDOW_STORE_OPS = 3;

const VARY_HEADER_KEY_FANOUT = 2;

const WS_PUBSUB_FANOUT_MS = 1.2;

const WS_HEARTBEAT_FRAME_BYTES = 12;

const MTLS_HANDSHAKE_MS = 1.5;

const MESH_TELEMETRY_MS = 0.15;

function requestsPerMonthMillions(lambda: number): number {
    return (lambda * SECONDS_PER_MONTH) / 1e6;
}

const dnsDefaults = {
    ttlSec: 60,
    negativeTtlSec: 30,
    routingPolicy: 'latency',
    geoMapping: 'continent',
    healthCheckSec: 10,
    healthCheckThreshold: 3,
    resolveMs: 18,
    resolverCacheHitRatio: 0.9,
    anycastPops: 30,
    maxQps: 500000,
    availability: 0.99999,
    costPerMillionQueries: 0.4,
};

function authoritativeShare(params: typeof dnsDefaults): number {
    return 1 - params.resolverCacheHitRatio;
}

const dnsModel = defineModel<typeof dnsDefaults>({
    serviceSec: (ctx) => (ctx.params.resolveMs * authoritativeShare(ctx.params)) / 1000,
    resources: (ctx) => [
        resourceLimit(
            'authoritative-qps',
            ctx.params.maxQps / authoritativeShare(ctx.params),
            'maxQps / (1 - resolverCacheHitRatio)',
            {
                maxQps: ctx.params.maxQps,
                resolverCacheHitRatio: ctx.params.resolverCacheHitRatio,
            },
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests:
                requestsPerMonthMillions(ctx.lambda) *
                authoritativeShare(ctx.params) *
                ctx.params.costPerMillionQueries,
        }),
    availability: (params) => params.availability,
});

const dns = defineComponent({
    id: 'dns',
    group: 'edge',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-dns',
    ports: {
        in: [{ id: 'in', protocols: ['dns'], role: 'serve' }],
        out: [{ id: 'resolve', protocols: ['http', 'grpc', 'ws'], role: 'call' }],
    },
    defaultParams: dnsDefaults,
    paramSchema: {
        ttlSec: num('behaviour', { unitKey: 'sec', min: 1, max: 86400, realistic: { min: 30, max: 300 } }),
        negativeTtlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        routingPolicy: choice('topology', ROUTING_POLICY),
        geoMapping: choice('topology', ['none', 'continent', 'country', 'custom']),
        healthCheckSec: num('reliability', { unitKey: 'sec', min: 1, max: 300 }),
        healthCheckThreshold: num('reliability', { min: 1, max: 10 }),
        resolveMs: num('performance', { unitKey: 'ms', min: 1, max: 500 }),
        resolverCacheHitRatio: num('performance', { min: 0, max: 1, step: 0.01 }),
        anycastPops: num('scale', { min: 1, max: 500 }),
        maxQps: num('capacity', { unitKey: 'rps', min: 100, max: 100000000 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerMillionQueries: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: dnsModel,
    helpId: 'dns',
    managed: true,
});

const cdnDefaults = {
    popCount: 300,
    cacheHitRatio: 0.92,
    ttlSec: 3600,
    staleWhileRevalidateSec: 60,
    originShield: true,
    edgeLatencyMs: 20,
    originLatencyMs: 80,
    avgObjectKb: 120,
    maxObjectSizeMb: 50,
    compression: true,
    rangeRequests: true,
    signedUrls: false,
    availability: 0.9999,
    costPerGbEgress: 0.085,
    costPerMillionRequests: 0.75,
};

const cdnModel = defineModel<typeof cdnDefaults>({
    serviceSec: (ctx) => ctx.params.edgeLatencyMs / 1000,
    resources: (ctx) => [
        explicitRps('pop-rps', ctx.params.popCount, CDN_RPS_PER_POP),
        bandwidthBound(
            'pop-network',
            ctx.params.popCount * CDN_GBPS_PER_POP * 1000,
            ctx.params.avgObjectKb * 1000,
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests: requestsPerMonthMillions(ctx.lambda) * ctx.params.costPerMillionRequests,
        }),
    availability: (params) => params.availability,
});

const cdn = defineComponent({
    id: 'cdn',
    group: 'edge',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-cdn',
    ports: {
        in: [{ id: 'in', protocols: ['http'], role: 'serve' }],
        out: [{ id: 'origin', protocols: ['http', 's3'], role: 'call' }],
    },
    defaultParams: cdnDefaults,
    paramSchema: {
        popCount: num('scale', { min: 1, max: 1000 }),
        cacheHitRatio: num('performance', { min: 0, max: 1, step: 0.01, realistic: { min: 0.7, max: 0.98 } }),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 31536000 }),
        staleWhileRevalidateSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        originShield: bool('behaviour'),
        edgeLatencyMs: num('performance', { unitKey: 'ms', min: 1, max: 200, realistic: { min: 10, max: 30 } }),
        originLatencyMs: num('performance', { unitKey: 'ms', min: 1, max: 10000 }),
        avgObjectKb: num('data', { unitKey: 'kb', min: 0.1, max: 1048576, step: 0.1 }),
        maxObjectSizeMb: num('capacity', { unitKey: 'mb', min: 1, max: 51200 }),
        compression: bool('behaviour'),
        rangeRequests: bool('behaviour'),
        signedUrls: bool('behaviour'),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerGbEgress: num('cost', { unitKey: 'usd', min: 0, max: 5, step: 0.001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: cdnModel,
    managed: true,
    helpId: 'cdn',
});

const glbDefaults = {
    regions: 2,
    routingPolicy: 'latency',
    stickyRegion: false,
    drainOnFailover: true,
    drainTimeoutSec: 60,
    failoverSec: 30,
    healthCheckIntervalSec: 10,
    healthCheckThreshold: 3,
    latencyMs: 0.5,
    maxRps: 1000000,
    availability: 0.99999,
    costPerMillionRequests: 0.6,
};

const glbModel = defineModel<typeof glbDefaults>({
    serviceSec: (ctx) => ctx.params.latencyMs / 1000,
    resources: (ctx) => [quotaBound('global-rps', ctx.params.maxRps)],
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests: requestsPerMonthMillions(ctx.lambda) * ctx.params.costPerMillionRequests,
        }),
    availability: (params) => params.availability,
});

const glb = defineComponent({
    id: 'glb',
    group: 'edge',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-glb',
    ports: { in: PROXY_IN, out: PROXY_OUT },
    defaultParams: glbDefaults,
    paramSchema: {
        regions: num('topology', { min: 1, max: 20 }),
        routingPolicy: choice('topology', ROUTING_POLICY),
        stickyRegion: bool('consistency'),
        drainOnFailover: bool('reliability'),
        drainTimeoutSec: num('reliability', { unitKey: 'sec', min: 0, max: 3600 }),
        failoverSec: num('reliability', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 10, max: 120 } }),
        healthCheckIntervalSec: num('reliability', { unitKey: 'sec', min: 1, max: 300 }),
        healthCheckThreshold: num('reliability', { min: 1, max: 10 }),
        latencyMs: num('performance', { unitKey: 'ms', min: 0, max: 100, step: 0.1 }),
        maxRps: num('capacity', { unitKey: 'rps', min: 100, max: 100000000 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    managed: true,
    model: glbModel,
    helpId: 'glb',
});

const lbL4Defaults = {
    instances: 2,
    azSpread: 2,
    maxConnections: 500000,
    newConnPerSec: 100000,
    throughputGbps: 25,
    algorithm: 'round-robin',
    stickiness: 'none',
    latencyMs: 0.3,
    idleTimeoutSec: 350,
    healthCheck: true,
    healthCheckIntervalSec: 10,
    availability: 0.9999,
    costPerInstanceHour: 0.027,
    costPerGbProcessed: 0.006,
};

const lbL4Model = defineModel<typeof lbL4Defaults>({
    serviceSec: (ctx) => ctx.params.latencyMs / 1000,
    resources: (ctx) => [
        explicitRps('new-connections', ctx.instances, ctx.params.newConnPerSec),
        bandwidthBound(
            'throughput',
            ctx.instances * ctx.params.throughputGbps * 1000,
            ctx.requestBytes + ctx.responseBytes,
        ),
    ],
    cost: (ctx) => {
        const processedGbMonth =
            (ctx.lambda * (ctx.requestBytes + ctx.responseBytes) * SECONDS_PER_MONTH) / 1e9;
        return totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: processedGbMonth * ctx.params.costPerGbProcessed,
            requests: 0,
        });
    },
    availability: (params) => params.availability,
});

const lbL4 = defineComponent({
    id: 'lb-l4',
    group: 'edge',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-lb-l4',
    ports: { in: PROXY_IN, out: PROXY_OUT },
    defaultParams: lbL4Defaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 500 }),
        azSpread: num('scale', { min: 1, max: 6 }),
        maxConnections: num('capacity', { min: 1000, max: 10000000, realistic: { min: 50000, max: 2000000 } }),
        newConnPerSec: num('capacity', { min: 100, max: 5000000 }),
        throughputGbps: num('capacity', { min: 0.1, max: 400, step: 0.1 }),
        algorithm: choice('behaviour', ['round-robin', 'least-conn', 'random-2-choices', 'hash']),
        stickiness: choice('behaviour', ['none', 'source-ip', 'flow-hash']),
        latencyMs: num('performance', { unitKey: 'ms', min: 0, max: 50, step: 0.1 }),
        idleTimeoutSec: num('behaviour', { unitKey: 'sec', min: 1, max: 4000 }),
        healthCheck: bool('reliability'),
        healthCheckIntervalSec: num('reliability', { unitKey: 'sec', min: 1, max: 300 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerGbProcessed: num('cost', { unitKey: 'usd', min: 0, max: 5, step: 0.001 }),
    },
    model: lbL4Model,
    helpId: 'lb-l4',
});

const lbL7Defaults = {
    instances: 3,
    azSpread: 3,
    maxRpsPerInstance: 25000,
    maxConnections: 100000,
    cpuCores: 4,
    tlsTerminate: true,
    tlsHandshakeMs: 1.2,
    keepAlive: true,
    http2: true,
    compression: true,
    latencyMs: 1,
    timeoutMs: 30000,
    retryPolicy: 'idempotent-only',
    healthCheck: true,
    connectionDrainSec: 30,
    availability: 0.9999,
    costPerInstanceHour: 0.09,
};

function l7ServiceSec(params: typeof lbL7Defaults): number {
    const handshakeShare = params.keepAlive ? KEEP_ALIVE_HANDSHAKE_SHARE : 1;
    const handshakeMs = params.tlsTerminate ? params.tlsHandshakeMs * handshakeShare : 0;
    return (params.latencyMs + handshakeMs) / 1000;
}

const lbL7Model = defineModel<typeof lbL7Defaults>({
    serviceSec: (ctx) => l7ServiceSec(ctx.params),
    resources: (ctx) => [
        explicitRps('proxy-rps', ctx.instances, ctx.params.maxRpsPerInstance),
        explicitRps(
            'cpu',
            ctx.instances * ctx.params.cpuCores,
            ctx.params.tlsTerminate ? L7_RPS_PER_CORE_TLS : L7_RPS_PER_CORE_PLAIN,
        ),
        bandwidthBound(
            'network',
            ctx.instances * PROXY_NETWORK_MBPS_PER_INSTANCE,
            ctx.requestBytes + ctx.responseBytes,
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

const lbL7 = defineComponent({
    id: 'lb-l7',
    group: 'edge',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-lb-l7',
    ports: { in: PROXY_IN, out: PROXY_OUT },
    defaultParams: lbL7Defaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 500 }),
        azSpread: num('scale', { min: 1, max: 6 }),
        maxRpsPerInstance: num('capacity', { unitKey: 'rps', min: 100, max: 1000000, realistic: { min: 5000, max: 60000 } }),
        maxConnections: num('capacity', { min: 100, max: 5000000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        tlsTerminate: bool('behaviour'),
        tlsHandshakeMs: num('performance', { unitKey: 'ms', min: 0, max: 50, step: 0.1 }),
        keepAlive: bool('behaviour'),
        http2: bool('behaviour'),
        compression: bool('behaviour'),
        latencyMs: num('performance', { unitKey: 'ms', min: 0, max: 100, step: 0.1 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        retryPolicy: choice('behaviour', ['none', 'once', 'idempotent-only', 'exponential-backoff']),
        healthCheck: bool('reliability'),
        connectionDrainSec: num('reliability', { unitKey: 'sec', min: 0, max: 3600 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: lbL7Model,
    helpId: 'lb-l7',
});

const apiGatewayDefaults = {
    instances: 3,
    azSpread: 3,
    maxRpsPerInstance: 10000,
    serviceTimeMs: 3,
    authMode: 'jwt-local',
    authLatencyMs: 0.5,
    rateLimitRpsPerClient: 1000,
    quotaPerDay: 5000000,
    requestTransform: true,
    responseCacheEnabled: false,
    responseCacheTtlSec: 30,
    payloadLimitMb: 10,
    timeoutMs: 29000,
    logLinesPerRequest: 2,
    logBytesPerLine: 500,
    availability: 0.9995,
    costPerMillionRequests: 3.5,
};

const apiGatewayModel = defineModel<typeof apiGatewayDefaults>({
    serviceSec: (ctx) =>
        (ctx.params.serviceTimeMs + (ctx.params.authMode === 'none' ? 0 : ctx.params.authLatencyMs)) / 1000,
    resources: (ctx) => [
        explicitRps('gateway-rps', ctx.instances, ctx.params.maxRpsPerInstance),
        bandwidthBound(
            'network',
            ctx.instances * PROXY_NETWORK_MBPS_PER_INSTANCE,
            ctx.requestBytes + ctx.responseBytes,
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests: requestsPerMonthMillions(ctx.lambda) * ctx.params.costPerMillionRequests,
        }),
    availability: (params) => params.availability,
});

const apiGateway = defineComponent({
    id: 'api-gateway',
    group: 'edge',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-gateway',
    ports: {
        in: PROXY_IN,
        out: [...PROXY_OUT, { id: 'telemetry', protocols: ['telemetry'], role: 'observe' }],
    },
    defaultParams: apiGatewayDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 500 }),
        azSpread: num('scale', { min: 1, max: 6 }),
        maxRpsPerInstance: num('capacity', { unitKey: 'rps', min: 100, max: 1000000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1 }),
        authMode: choice('behaviour', ['none', 'jwt-local', 'introspection']),
        authLatencyMs: num('performance', { unitKey: 'ms', min: 0, max: 1000, step: 0.05 }),
        rateLimitRpsPerClient: num('behaviour', { unitKey: 'rps', min: 1, max: 1000000 }),
        quotaPerDay: num('behaviour', { min: 1, max: 10000000000 }),
        requestTransform: bool('behaviour'),
        responseCacheEnabled: bool('behaviour'),
        responseCacheTtlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        payloadLimitMb: num('capacity', { unitKey: 'mb', min: 0.1, max: 1024, step: 0.1 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        logLinesPerRequest: num('data', { min: 0, max: 1000 }),
        logBytesPerLine: num('data', { unitKey: 'bytes', min: 10, max: 100000 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: apiGatewayModel,
    helpId: 'api-gateway',
});

const wafDefaults = {
    instances: 4,
    azSpread: 3,
    cpuCores: 8,
    rulesCount: 250,
    inspectionMs: 1.2,
    falsePositiveRate: 0.001,
    rateLimitRps: 500000,
    botScore: 0.6,
    availability: 0.9999,
    costPerInstanceHour: 0.14,
    costPerMillionRequests: 0.6,
};

function wafInspectionSec(params: typeof wafDefaults): number {
    return (params.inspectionMs + params.rulesCount * WAF_INSPECTION_MS_PER_RULE) / 1000;
}

const wafModel = defineModel<typeof wafDefaults>({
    serviceSec: (ctx) => wafInspectionSec(ctx.params),
    resources: (ctx) => [
        littleLaw('cpu', ctx.instances * ctx.params.cpuCores, wafInspectionSec(ctx.params)),
        quotaBound('rate-limit', ctx.params.rateLimitRps),
        bandwidthBound(
            'network',
            ctx.instances * PROXY_NETWORK_MBPS_PER_INSTANCE,
            ctx.requestBytes + ctx.responseBytes,
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: requestsPerMonthMillions(ctx.lambda) * ctx.params.costPerMillionRequests,
        }),
    availability: (params) => params.availability,
});

const waf = defineComponent({
    id: 'waf',
    group: 'edge',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-waf',
    ports: { in: PROXY_IN, out: PROXY_OUT },
    defaultParams: wafDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 500 }),
        azSpread: num('scale', { min: 1, max: 6 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        rulesCount: num('behaviour', { min: 0, max: 5000, realistic: { min: 100, max: 800 } }),
        inspectionMs: num('performance', { unitKey: 'ms', min: 0.05, max: 100, step: 0.05, realistic: { min: 0.5, max: 5 } }),
        falsePositiveRate: num('reliability', { min: 0, max: 0.2, step: 0.0001, realistic: { min: 0.0001, max: 0.01 } }),
        rateLimitRps: num('capacity', { unitKey: 'rps', min: 100, max: 100000000 }),
        botScore: num('behaviour', { min: 0, max: 1, step: 0.05 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        costPerMillionRequests: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.01 }),
    },
    model: wafModel,
    helpId: 'waf',
});

const RATE_LIMITER_ALGORITHM = ['token-bucket', 'leaky-bucket', 'sliding-window', 'gcra'];

const rateLimiterDefaults = {
    instances: 3,
    concurrencyPerInstance: 256,
    cpuCores: 4,
    algorithm: 'token-bucket',
    rateLimitRps: 2000,
    burst: 200,
    scope: 'per-user',
    backingStore: 'redis',
    limitCheckPerRequest: 1,
    maxOpsPerSec: 120000,
    networkRttMs: 0.4,
    serviceTimeMs: 0.05,
    rejectMode: 'http-429',
    availability: 0.999,
    costPerInstanceHour: 0.09,
};

function rateLimiterStoreOpsPerRequest(params: typeof rateLimiterDefaults): number {
    const opsPerCheck = params.algorithm === 'sliding-window' ? SLIDING_WINDOW_STORE_OPS : 1;
    return params.limitCheckPerRequest * opsPerCheck;
}

function rateLimiterStoreOpsPerSec(params: typeof rateLimiterDefaults, instances: number): number {
    return params.backingStore === 'redis'
        ? params.maxOpsPerSec
        : instances * params.cpuCores * RATE_LIMITER_LOCAL_OPS_PER_CORE;
}

function rateLimiterServiceSec(params: typeof rateLimiterDefaults): number {
    const storeMs =
        params.backingStore === 'redis' ? params.networkRttMs * rateLimiterStoreOpsPerRequest(params) : 0;
    return (params.serviceTimeMs + storeMs) / 1000;
}

const rateLimiterModel = defineModel<typeof rateLimiterDefaults>({
    serviceSec: (ctx) => rateLimiterServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'counter-store',
            rateLimiterStoreOpsPerSec(ctx.params, ctx.instances) / rateLimiterStoreOpsPerRequest(ctx.params),
            'storeOpsPerSec / storeOpsPerRequest',
            {
                backingStore: ctx.params.backingStore,
                storeOpsPerSec: rateLimiterStoreOpsPerSec(ctx.params, ctx.instances),
                storeOpsPerRequest: rateLimiterStoreOpsPerRequest(ctx.params),
            },
        ),
        littleLaw(
            'concurrency',
            ctx.instances * ctx.params.concurrencyPerInstance,
            rateLimiterServiceSec(ctx.params),
        ),
        ctx.params.scope === 'global' ? quotaBound('rate-limit', ctx.params.rateLimitRps) : null,
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

const rateLimiter = defineComponent({
    id: 'rate-limiter',
    group: 'edge',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-rate-limiter',
    ports: { in: PROXY_IN, out: PROXY_OUT },
    defaultParams: rateLimiterDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 500 }),
        concurrencyPerInstance: num('capacity', { min: 1, max: 100000 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        algorithm: choice('behaviour', RATE_LIMITER_ALGORITHM),
        rateLimitRps: num('capacity', { unitKey: 'rps', min: 1, max: 10000000 }),
        burst: num('behaviour', { min: 0, max: 1000000 }),
        scope: choice('behaviour', ['global', 'per-user', 'per-ip', 'per-key']),
        backingStore: choice('topology', ['local', 'redis']),
        limitCheckPerRequest: num('behaviour', { min: 1, max: 20 }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 1000, max: 10000000, realistic: { min: 80000, max: 150000 } }),
        networkRttMs: num('performance', { unitKey: 'ms', min: 0.05, max: 100, step: 0.05, realistic: { min: 0.2, max: 2 } }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 100, step: 0.01 }),
        rejectMode: choice('behaviour', ['http-429', 'queue', 'shed']),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: rateLimiterModel,
    helpId: 'rate-limiter',
});

const reverseCacheDefaults = {
    instances: 3,
    azSpread: 3,
    cacheSizeGb: 50,
    ttlSec: 600,
    staleWhileRevalidateSec: 30,
    varyHeaders: 2,
    purgeApi: true,
    avgObjectKb: 120,
    uniqueKeys: 5000000,
    zipfAlpha: 1,
    maxRpsPerInstance: 30000,
    serviceTimeMs: 0.8,
    cpuCores: 4,
    networkMbps: 10000,
    availability: 0.999,
    costPerInstanceHour: 0.12,
    hitRatioMode: 'manual',
    hitRatioOverride: 0.85,
};

function reverseCacheEntryBytes(params: typeof reverseCacheDefaults): number {
    return params.avgObjectKb * 1000;
}

function reverseCacheUniqueKeys(params: typeof reverseCacheDefaults): number {
    return params.uniqueKeys * Math.pow(VARY_HEADER_KEY_FANOUT, params.varyHeaders);
}

function reverseCacheServableTtlSec(params: typeof reverseCacheDefaults): number {
    return params.ttlSec + params.staleWhileRevalidateSec;
}

function reverseCacheCapacityBytes(params: typeof reverseCacheDefaults, instances: number): number {
    return instances * params.cacheSizeGb * 1e9;
}

function reverseCacheFillShare(params: typeof reverseCacheDefaults, writeShare: number): number {
    return Math.min(1, 1 - params.hitRatioOverride + writeShare);
}

const reverseCacheModel = defineModel<typeof reverseCacheDefaults>({
    serviceSec: (ctx) => ctx.params.serviceTimeMs / 1000,
    resources: (ctx) => [
        memoryResidencyBound(
            'memory',
            reverseCacheCapacityBytes(ctx.params, ctx.instances) / 1e9,
            (reverseCacheEntryBytes(ctx.params) *
                reverseCacheServableTtlSec(ctx.params) *
                reverseCacheFillShare(ctx.params, ctx.writeShare)) /
                1e9,
        ),
        littleLaw('cpu', ctx.instances * ctx.params.cpuCores, ctx.params.serviceTimeMs / 1000),
        explicitRps('proxy-rps', ctx.instances, ctx.params.maxRpsPerInstance),
        bandwidthBound(
            'network',
            ctx.instances * ctx.params.networkMbps,
            ctx.requestBytes + ctx.responseBytes,
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
    cache: (ctx) => ({
        uniqueKeys: reverseCacheUniqueKeys(ctx.params),
        zipfAlpha: ctx.params.zipfAlpha,
        entryBytes: reverseCacheEntryBytes(ctx.params),
        capacityBytes: reverseCacheCapacityBytes(ctx.params, ctx.instances),
        ttlSec: reverseCacheServableTtlSec(ctx.params),
    }),
});

const reverseCache = defineComponent({
    id: 'reverse-cache',
    group: 'edge',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-reverse-cache',
    ports: { in: PROXY_IN, out: PROXY_OUT },
    defaultParams: reverseCacheDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 500 }),
        azSpread: num('scale', { min: 1, max: 6 }),
        cacheSizeGb: num('capacity', { unitKey: 'gb', min: 0.1, max: 10000, step: 0.1 }),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 2592000 }),
        staleWhileRevalidateSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        varyHeaders: num('behaviour', { min: 0, max: 12, realistic: { min: 0, max: 3 } }),
        purgeApi: bool('behaviour'),
        avgObjectKb: num('data', { unitKey: 'kb', min: 0.1, max: 1048576, step: 0.1 }),
        uniqueKeys: num('data', { min: 1, max: 1e12 }),
        zipfAlpha: num('behaviour', { min: 0.3, max: 2.5, step: 0.1, realistic: { min: 0.6, max: 1.4 } }),
        maxRpsPerInstance: num('capacity', { unitKey: 'rps', min: 100, max: 1000000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        cpuCores: num('capacity', { min: 1, max: 192 }),
        networkMbps: num('capacity', { unitKey: 'mbps', min: 10, max: 100000 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
        hitRatioMode: choice('performance', ['auto', 'manual']),
        hitRatioOverride: num('performance', { min: 0, max: 1, step: 0.01 }),
    },
    model: reverseCacheModel,
    helpId: 'reverse-cache',
});

const wsGatewayDefaults = {
    instances: 6,
    azSpread: 3,
    concurrentConnections: 400000,
    connectionsPerInstance: 100000,
    memoryPerConnKb: 120,
    memoryGb: 8,
    messagesPerConnMin: 6,
    messageBytes: 400,
    heartbeatSec: 30,
    fanoutMode: 'pub-sub',
    serviceTimeMs: 0.4,
    idleTimeoutSec: 120,
    networkMbps: 10000,
    availability: 0.999,
    costPerInstanceHour: 0.15,
};

function wsMessagesPerConnSec(params: typeof wsGatewayDefaults): number {
    return params.messagesPerConnMin / SECONDS_PER_MINUTE;
}

function wsFleetConnections(params: typeof wsGatewayDefaults, instances: number): number {
    return instances * params.connectionsPerInstance;
}

function wsMemoryConnections(params: typeof wsGatewayDefaults, instances: number): number {
    return (instances * params.memoryGb * KILOBYTES_PER_GIGABYTE) / params.memoryPerConnKb;
}

function wsServiceSec(params: typeof wsGatewayDefaults): number {
    return (params.serviceTimeMs + (params.fanoutMode === 'pub-sub' ? WS_PUBSUB_FANOUT_MS : 0)) / 1000;
}

function wsWireBytesPerMessage(params: typeof wsGatewayDefaults): number {
    const heartbeatsPerMessage =
        params.heartbeatSec > 0 && params.messagesPerConnMin > 0
            ? SECONDS_PER_MINUTE / (params.messagesPerConnMin * params.heartbeatSec)
            : 0;
    return params.messageBytes + heartbeatsPerMessage * WS_HEARTBEAT_FRAME_BYTES;
}

const wsGatewayModel = defineModel<typeof wsGatewayDefaults>({
    serviceSec: (ctx) => wsServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'connections',
            wsFleetConnections(ctx.params, ctx.instances) * wsMessagesPerConnSec(ctx.params),
            'instances × connectionsPerInstance × messagesPerConnMin / 60',
            {
                instances: ctx.instances,
                connectionsPerInstance: ctx.params.connectionsPerInstance,
                messagesPerConnMin: ctx.params.messagesPerConnMin,
            },
        ),
        resourceLimit(
            'memory',
            wsMemoryConnections(ctx.params, ctx.instances) * wsMessagesPerConnSec(ctx.params),
            'instances × memoryGb × 10⁶ / memoryPerConnKb × messagesPerConnMin / 60',
            {
                instances: ctx.instances,
                memoryGb: ctx.params.memoryGb,
                memoryPerConnKb: ctx.params.memoryPerConnKb,
                messagesPerConnMin: ctx.params.messagesPerConnMin,
            },
        ),
        bandwidthBound(
            'network',
            ctx.instances * ctx.params.networkMbps,
            wsWireBytesPerMessage(ctx.params),
        ),
    ],
    autoscale: (ctx) =>
        Math.max(
            ctx.params.instances,
            Math.ceil(ctx.params.concurrentConnections / Math.max(ctx.params.connectionsPerInstance, 1)),
        ),
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const wsGateway = defineComponent({
    id: 'ws-gateway',
    group: 'edge',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-ws-gateway',
    ports: {
        in: [
            { id: 'in', protocols: ['ws', 'http'], role: 'serve' },
            { id: 'fanout', protocols: ['kafka', 'amqp', 'redis', 'stream'], role: 'consume' },
        ],
        out: PROXY_OUT,
    },
    defaultParams: wsGatewayDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 5000 }),
        azSpread: num('scale', { min: 1, max: 6 }),
        concurrentConnections: num('capacity', { min: 1, max: 100000000, realistic: { min: 10000, max: 5000000 } }),
        connectionsPerInstance: num('capacity', { min: 100, max: 1000000, realistic: { min: 50000, max: 200000 } }),
        memoryPerConnKb: num('data', { unitKey: 'kb', min: 1, max: 4096, realistic: { min: 20, max: 200 } }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.5, max: 1024 }),
        messagesPerConnMin: num('behaviour', { min: 0, max: 10000, step: 0.1, realistic: { min: 1, max: 60 } }),
        messageBytes: num('data', { unitKey: 'bytes', min: 10, max: 1048576 }),
        heartbeatSec: num('behaviour', { unitKey: 'sec', min: 0, max: 600, realistic: { min: 15, max: 60 } }),
        fanoutMode: choice('topology', ['direct', 'pub-sub']),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        idleTimeoutSec: num('behaviour', { unitKey: 'sec', min: 1, max: 4000 }),
        networkMbps: num('capacity', { unitKey: 'mbps', min: 10, max: 100000 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: wsGatewayModel,
    helpId: 'ws-gateway',
});

const serviceMeshDefaults = {
    instances: 10,
    cpuCores: 4,
    hopsPerRequest: 2,
    latencyOverheadMs: 0.7,
    cpuOverheadPercent: 12,
    mtls: true,
    retryPolicy: 'idempotent-only',
    circuitBreaker: true,
    circuitBreakerErrorThreshold: 0.5,
    observabilityExport: true,
    networkMbps: 10000,
    availability: 0.9995,
    costPerInstanceHour: 0.17,
};

function meshHopSec(params: typeof serviceMeshDefaults): number {
    const handshakeMs = params.mtls ? MTLS_HANDSHAKE_MS * KEEP_ALIVE_HANDSHAKE_SHARE : 0;
    const telemetryMs = params.observabilityExport ? MESH_TELEMETRY_MS : 0;
    return (params.latencyOverheadMs + handshakeMs + telemetryMs) / 1000;
}

function meshServiceSec(params: typeof serviceMeshDefaults): number {
    return params.hopsPerRequest * meshHopSec(params);
}

function meshSidecarCores(params: typeof serviceMeshDefaults, instances: number): number {
    return (instances * params.cpuCores * params.cpuOverheadPercent) / 100;
}

const serviceMeshModel = defineModel<typeof serviceMeshDefaults>({
    serviceSec: (ctx) => meshServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'cpu',
            meshSidecarCores(ctx.params, ctx.instances) / meshServiceSec(ctx.params),
            'instances × cpuCores × cpuOverheadPercent / 100 / (hopsPerRequest × hopSec)',
            {
                instances: ctx.instances,
                cpuCores: ctx.params.cpuCores,
                cpuOverheadPercent: ctx.params.cpuOverheadPercent,
                hopsPerRequest: ctx.params.hopsPerRequest,
                hopSec: meshHopSec(ctx.params),
            },
        ),
        bandwidthBound(
            'network',
            ctx.instances * ctx.params.networkMbps,
            ctx.params.hopsPerRequest * (ctx.requestBytes + ctx.responseBytes),
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute:
                ctx.instances *
                ctx.params.costPerInstanceHour *
                (ctx.params.cpuOverheadPercent / 100) *
                HOURS_PER_MONTH *
                ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const serviceMesh = defineComponent({
    id: 'service-mesh',
    group: 'edge',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-service-mesh',
    ports: {
        in: PROXY_IN,
        out: [...PROXY_OUT, { id: 'telemetry', protocols: ['telemetry'], role: 'observe' }],
    },
    defaultParams: serviceMeshDefaults,
    paramSchema: {
        instances: num('scale', { min: 1, max: 10000 }),
        cpuCores: num('capacity', { min: 0.25, max: 192, step: 0.25 }),
        hopsPerRequest: num('topology', { min: 1, max: 10, realistic: { min: 2, max: 4 } }),
        latencyOverheadMs: num('performance', { unitKey: 'ms', min: 0.05, max: 50, step: 0.05, realistic: { min: 0.5, max: 2 } }),
        cpuOverheadPercent: num('capacity', { unitKey: 'percent', min: 1, max: 100, realistic: { min: 5, max: 30 } }),
        mtls: bool('reliability'),
        retryPolicy: choice('behaviour', ['none', 'once', 'idempotent-only', 'exponential-backoff']),
        circuitBreaker: bool('reliability'),
        circuitBreakerErrorThreshold: num('reliability', { min: 0.01, max: 1, step: 0.01 }),
        observabilityExport: bool('behaviour'),
        networkMbps: num('capacity', { unitKey: 'mbps', min: 10, max: 100000 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: serviceMeshModel,
    helpId: 'service-mesh',
});

const natEgressDefaults = {
    gateways: 2,
    publicIps: 1,
    portsPerIp: 64000,
    connectionsPerRequest: 0.2,
    portHoldSec: 30,
    throughputGbps: 45,
    latencyMs: 0.1,
    idleTimeoutSec: 350,
    availability: 0.9995,
    costPerGatewayHour: 0.045,
    costPerGb: 0.045,
};

function natEgressPorts(params: typeof natEgressDefaults): number {
    return params.gateways * params.publicIps * params.portsPerIp;
}

const natEgressModel = defineModel<typeof natEgressDefaults>({
    serviceSec: (ctx) => ctx.params.latencyMs / 1000,
    resources: (ctx) => [
        connectionBound(
            'ports',
            natEgressPorts(ctx.params),
            ctx.params.connectionsPerRequest,
            ctx.params.portHoldSec,
        ),
        bandwidthBound(
            'throughput',
            ctx.params.gateways * ctx.params.throughputGbps * 1000,
            ctx.requestBytes + ctx.responseBytes,
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.params.gateways * ctx.params.costPerGatewayHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: ctx.egressGbMonth * ctx.params.costPerGb,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const natEgress = defineComponent({
    id: 'nat-egress',
    group: 'edge',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-nat-egress',
    ports: { in: PROXY_IN, out: PROXY_OUT },
    defaultParams: natEgressDefaults,
    paramSchema: {
        gateways: num('scale', { min: 1, max: 50 }),
        publicIps: num('scale', { min: 1, max: 256 }),
        portsPerIp: num('capacity', { min: 1000, max: 65535, realistic: { min: 55000, max: 64512 } }),
        connectionsPerRequest: num('behaviour', { min: 0.001, max: 10, step: 0.001, realistic: { min: 0.05, max: 1 } }),
        portHoldSec: num('behaviour', { unitKey: 'sec', min: 1, max: 600, realistic: { min: 15, max: 120 } }),
        throughputGbps: num('capacity', { min: 0.1, max: 400, step: 0.1 }),
        latencyMs: num('performance', { unitKey: 'ms', min: 0, max: 50, step: 0.1 }),
        idleTimeoutSec: num('behaviour', { unitKey: 'sec', min: 1, max: 4000 }),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costPerGatewayHour: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
        costPerGb: num('cost', { unitKey: 'usd', min: 0, max: 5, step: 0.001 }),
    },
    model: natEgressModel,
    helpId: 'nat-egress',
    managed: true,
});

export const edgeComponents: ComponentDefinition[] = [
    dns,
    cdn,
    waf,
    glb,
    lbL4,
    lbL7,
    apiGateway,
    rateLimiter,
    reverseCache,
    wsGateway,
    serviceMesh,
    natEgress,
] as unknown as ComponentDefinition[];
