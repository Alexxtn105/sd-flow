import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_MONTH } from '../sim/constants';
import {
    bandwidthBound,
    defineModel,
    explicitRps,
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
            network: ctx.egressGbMonth * ctx.params.costPerGbEgress,
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
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
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
            network: ctx.egressGbMonth * ctx.pricing.egressPerGb,
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

export const edgeComponents: ComponentDefinition[] = [
    dns,
    cdn,
    glb,
    lbL4,
    lbL7,
    apiGateway,
] as unknown as ComponentDefinition[];
