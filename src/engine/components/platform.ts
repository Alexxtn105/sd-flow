import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import {
    connectionBound,
    defineModel,
    explain,
    explicitRps,
    littleLaw,
    memoryResidencyBound,
    quotaBound,
    resourceLimit,
    totalCost,
    weightedUnitBound,
} from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const PLATFORM_PORTS: PortSpec = {
    in: [{ id: 'in', protocols: ['http', 'grpc'], role: 'serve' }],
    out: [],
};

const DISPATCH_PORTS: PortSpec = {
    in: [{ id: 'in', protocols: ['http', 'grpc'], role: 'serve' }],
    out: [{ id: 'out', protocols: ['http', 'grpc', 'internal'], role: 'call' }],
};

const AUTH_CORES_PER_INSTANCE = 4;

const authDefaults = {
    mode: 'jwt-local-verify',
    verifyMs: 0.05,
    introspectionMs: 6,
    tokenTtlSec: 900,
    refreshTokenTtlSec: 2592000,
    jwksCacheSec: 3600,
    sessionStore: 'redis',
    loginServiceMs: 150,
    mfaShare: 0.25,
    instances: 3,
    maxRpsPerInstance: 3000,
    serviceTimeMs: 4,
    timeoutMs: 2000,
    availability: 0.9995,
    costPerInstanceHour: 0.12,
};

function authTokenCheckMs(params: typeof authDefaults): number {
    return params.mode === 'jwt-local-verify' ? params.verifyMs : params.introspectionMs;
}

function authServiceSec(params: typeof authDefaults, readShare: number, writeShare: number): number {
    const verifySec = (params.serviceTimeMs + authTokenCheckMs(params)) / 1000;
    const loginSec = (params.loginServiceMs * (1 + params.mfaShare)) / 1000;

    return readShare * verifySec + writeShare * loginSec;
}

const authModel = defineModel<typeof authDefaults>({
    serviceSec: (ctx) => authServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => [
        littleLaw(
            'cpu',
            ctx.instances * AUTH_CORES_PER_INSTANCE,
            authServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
        ),
        explicitRps('rps-ceiling', ctx.instances, ctx.params.maxRpsPerInstance),
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

const auth = defineComponent({
    id: 'auth',
    group: 'platform',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-auth',
    ports: PLATFORM_PORTS,
    defaultParams: authDefaults,
    paramSchema: {
        mode: choice('behaviour', ['jwt-local-verify', 'introspection', 'session-lookup']),
        verifyMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        introspectionMs: num('performance', { unitKey: 'ms', min: 0.1, max: 10000, step: 0.1, realistic: { min: 3, max: 10 } }),
        tokenTtlSec: num('behaviour', { unitKey: 'sec', min: 30, max: 2592000 }),
        refreshTokenTtlSec: num('behaviour', { unitKey: 'sec', min: 60, max: 31536000 }),
        jwksCacheSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        sessionStore: choice('topology', ['none', 'redis', 'database', 'cookie-jwt']),
        loginServiceMs: num('performance', { unitKey: 'ms', min: 1, max: 10000 }),
        mfaShare: num('behaviour', { min: 0, max: 1, step: 0.01 }),
        instances: num('scale', { min: 1, max: 1000 }),
        maxRpsPerInstance: num('capacity', { unitKey: 'rps', min: 10, max: 1000000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: authModel,
    helpId: 'auth',
});

const externalApiDefaults = {
    p50Ms: 120,
    p99Ms: 900,
    rateLimitRps: 500,
    quotaPerDay: 5000000,
    timeoutMs: 3000,
    retries: 2,
    retryBackoffMs: 200,
    idempotencyRequired: true,
    circuitBreaker: true,
    circuitBreakerErrorThreshold: 0.5,
    circuitBreakerResetSec: 30,
    errorRate: 0.005,
    availability: 0.999,
    costPerCall: 0.0005,
};

const externalApiModel = defineModel<typeof externalApiDefaults>({
    serviceSec: (ctx) => ctx.params.p50Ms / 1000,
    resources: (ctx) => [
        quotaBound('rate-limit', ctx.params.rateLimitRps),
        quotaBound('daily-quota', ctx.params.quotaPerDay / SECONDS_PER_DAY),
    ],
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests: ctx.lambda * SECONDS_PER_MONTH * ctx.params.costPerCall,
        }),
    availability: (params) => params.availability,
});

const externalApi = defineComponent({
    id: 'external-api',
    group: 'platform',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-external',
    ports: PLATFORM_PORTS,
    defaultParams: externalApiDefaults,
    paramSchema: {
        p50Ms: num('performance', { unitKey: 'ms', min: 1, max: 120000 }),
        p99Ms: num('performance', { unitKey: 'ms', min: 1, max: 300000 }),
        rateLimitRps: num('capacity', { unitKey: 'rps', min: 1, max: 1000000 }),
        quotaPerDay: num('capacity', { min: 1, max: 10000000000 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        retries: num('behaviour', { min: 0, max: 10 }),
        retryBackoffMs: num('behaviour', { unitKey: 'ms', min: 0, max: 60000 }),
        idempotencyRequired: bool('consistency'),
        circuitBreaker: bool('reliability'),
        circuitBreakerErrorThreshold: num('reliability', { min: 0.01, max: 1, step: 0.01 }),
        circuitBreakerResetSec: num('reliability', { unitKey: 'sec', min: 1, max: 3600 }),
        errorRate: num('reliability', { min: 0, max: 1, step: 0.001 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerCall: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.00001 }),
    },
    model: externalApiModel,
    helpId: 'external-api',
    managed: true,
});

const SESSION_VERIFY_CORES_PER_INSTANCE = 4;

const SESSION_BACKEND_OPS_SHARE: Record<string, number> = {
    redis: 1,
    database: 0.08,
};

const sessionStoreDefaults = {
    backend: 'redis',
    sessionSizeKb: 4,
    activeSessions: 20000000,
    ttlSec: 1800,
    verifyMs: 0.05,
    readServiceMs: 0.3,
    writeServiceMs: 0.6,
    instances: 3,
    maxOpsPerSec: 90000,
    memoryGb: 32,
    availability: 0.999,
    costPerInstanceHour: 0.22,
};

function sessionStoreIsStateless(params: typeof sessionStoreDefaults): boolean {
    return params.backend === 'cookie-jwt';
}

function sessionBytes(params: typeof sessionStoreDefaults): number {
    return params.sessionSizeKb * 1000;
}

function sessionStoreBackendShare(params: typeof sessionStoreDefaults): number {
    return SESSION_BACKEND_OPS_SHARE[params.backend] ?? 1;
}

function sessionStoreServiceSec(
    params: typeof sessionStoreDefaults,
    readShare: number,
    writeShare: number,
): number {
    if (sessionStoreIsStateless(params)) return params.verifyMs / 1000;

    return (readShare * params.readServiceMs + writeShare * params.writeServiceMs) / 1000;
}

const sessionStoreModel = defineModel<typeof sessionStoreDefaults>({
    serviceSec: (ctx) => sessionStoreServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) =>
        sessionStoreIsStateless(ctx.params)
            ? [
                  littleLaw(
                      'cpu',
                      ctx.instances * SESSION_VERIFY_CORES_PER_INSTANCE,
                      sessionStoreServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
                  ),
              ]
            : [
                  resourceLimit(
                      'ops',
                      ctx.instances * ctx.params.maxOpsPerSec * sessionStoreBackendShare(ctx.params),
                      'instances × maxOpsPerSec × backendShare',
                      {
                          instances: ctx.instances,
                          maxOpsPerSec: ctx.params.maxOpsPerSec,
                          backendShare: sessionStoreBackendShare(ctx.params),
                      },
                  ),
                  memoryResidencyBound(
                      'memory',
                      ctx.instances * ctx.params.memoryGb,
                      (sessionBytes(ctx.params) * ctx.params.ttlSec * ctx.writeShare) / 1e9,
                  ),
              ],
    storage: (ctx) => {
        const storedSessions = sessionStoreIsStateless(ctx.params)
            ? 0
            : Math.min(ctx.params.activeSessions, ctx.writeRps * ctx.params.ttlSec);
        const residentGb = (storedSessions * sessionBytes(ctx.params)) / 1e9;

        return {
            totalGb: residentGb,
            growthGbDay: 0,
            memoryGb: ctx.params.backend === 'redis' ? residentGb : 0,
            explain: [
                explain(
                    'min(activeSessions, writeRps × ttlSec) × sessionSizeKb × 1000 / 10⁹',
                    {
                        activeSessions: ctx.params.activeSessions,
                        writeRps: ctx.writeRps,
                        ttlSec: ctx.params.ttlSec,
                        sessionSizeKb: ctx.params.sessionSizeKb,
                        backend: ctx.params.backend,
                    },
                    residentGb,
                    'gb',
                ),
            ],
        };
    },
    cost: (ctx) =>
        totalCost({
            compute: sessionStoreIsStateless(ctx.params)
                ? 0
                : ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests: 0,
        }),
    availability: (params) => params.availability,
});

const sessionStore = defineComponent({
    id: 'session-store',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-session',
    ports: PLATFORM_PORTS,
    defaultParams: sessionStoreDefaults,
    paramSchema: {
        backend: choice('topology', ['redis', 'database', 'cookie-jwt']),
        sessionSizeKb: num('data', { unitKey: 'kb', min: 0.1, max: 1024, step: 0.1, realistic: { min: 1, max: 16 } }),
        activeSessions: num('data', { min: 1, max: 10000000000 }),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 60, max: 2592000 }),
        verifyMs: num('performance', { unitKey: 'ms', min: 0.01, max: 100, step: 0.01 }),
        readServiceMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        writeServiceMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        instances: num('scale', { min: 1, max: 1000 }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 1000, max: 10000000 }),
        memoryGb: num('capacity', { unitKey: 'gb', min: 0.1, max: 4096, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: sessionStoreModel,
    helpId: 'session-store',
});

const CONFIG_CORES_PER_INSTANCE = 4;

const CONFIG_CACHED_LOOKUPS_PER_REQUEST = 1;

const configDefaults = {
    pollIntervalSec: 30,
    pushMode: false,
    clientCache: true,
    evaluationsPerRequest: 12,
    evaluationMs: 0.02,
    instances: 2,
    maxOpsPerSec: 6000,
    maxConnections: 20000,
    serviceTimeMs: 0.5,
    availability: 0.999,
    costPerInstanceHour: 0.09,
};

function configLookupsPerRequest(params: typeof configDefaults): number {
    return params.clientCache ? CONFIG_CACHED_LOOKUPS_PER_REQUEST : params.evaluationsPerRequest;
}

function configServiceSec(params: typeof configDefaults): number {
    return (params.serviceTimeMs + params.evaluationMs * configLookupsPerRequest(params)) / 1000;
}

function configConnectionHoldSec(params: typeof configDefaults): number {
    return params.pushMode ? params.pollIntervalSec : configServiceSec(params);
}

const configModel = defineModel<typeof configDefaults>({
    serviceSec: (ctx) => configServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'ops',
            (ctx.instances * ctx.params.maxOpsPerSec) / configLookupsPerRequest(ctx.params),
            'instances × maxOpsPerSec / lookupsPerRequest',
            {
                instances: ctx.instances,
                maxOpsPerSec: ctx.params.maxOpsPerSec,
                lookupsPerRequest: configLookupsPerRequest(ctx.params),
                clientCache: String(ctx.params.clientCache),
            },
        ),
        littleLaw('cpu', ctx.instances * CONFIG_CORES_PER_INSTANCE, configServiceSec(ctx.params)),
        connectionBound(
            'connections',
            ctx.instances * ctx.params.maxConnections,
            1,
            configConnectionHoldSec(ctx.params),
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

const config = defineComponent({
    id: 'config',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-config',
    ports: PLATFORM_PORTS,
    defaultParams: configDefaults,
    paramSchema: {
        pollIntervalSec: num('behaviour', { unitKey: 'sec', min: 1, max: 3600 }),
        pushMode: bool('behaviour'),
        clientCache: bool('behaviour'),
        evaluationsPerRequest: num('behaviour', { min: 1, max: 1000, realistic: { min: 3, max: 40 } }),
        evaluationMs: num('performance', { unitKey: 'ms', min: 0.001, max: 100, step: 0.001 }),
        instances: num('scale', { min: 1, max: 100 }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 100, max: 1000000 }),
        maxConnections: num('capacity', { min: 100, max: 1000000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: configModel,
    helpId: 'config',
});

const DISCOVERY_CORES_PER_INSTANCE = 8;

const DISCOVERY_MIN_LOOKUP_OPS = 1;

const discoveryDefaults = {
    services: 60,
    registeredInstances: 900,
    healthCheckIntervalSec: 10,
    ttlSec: 30,
    resolverCacheHitRatio: 0.9,
    instances: 3,
    maxOpsPerSec: 5000,
    serviceTimeMs: 1.5,
    availability: 0.9995,
    costPerInstanceHour: 0.1,
};

function discoveryBackgroundOps(params: typeof discoveryDefaults): number {
    const heartbeats = params.registeredInstances / params.healthCheckIntervalSec;
    const reResolution = (params.services * params.registeredInstances) / params.ttlSec;

    return heartbeats + reResolution;
}

function discoveryLookupsPerRequest(params: typeof discoveryDefaults): number {
    return 1 - params.resolverCacheHitRatio;
}

function discoveryServiceSec(params: typeof discoveryDefaults): number {
    return (params.serviceTimeMs * discoveryLookupsPerRequest(params)) / 1000;
}

const discoveryModel = defineModel<typeof discoveryDefaults>({
    serviceSec: (ctx) => discoveryServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'ops',
            Math.max(
                ctx.instances * ctx.params.maxOpsPerSec - discoveryBackgroundOps(ctx.params),
                DISCOVERY_MIN_LOOKUP_OPS,
            ) / discoveryLookupsPerRequest(ctx.params),
            'max(instances × maxOpsPerSec − backgroundOps, 1) / (1 − resolverCacheHitRatio)',
            {
                instances: ctx.instances,
                maxOpsPerSec: ctx.params.maxOpsPerSec,
                backgroundOps: discoveryBackgroundOps(ctx.params),
                resolverCacheHitRatio: ctx.params.resolverCacheHitRatio,
            },
        ),
        littleLaw('cpu', ctx.instances * DISCOVERY_CORES_PER_INSTANCE, discoveryServiceSec(ctx.params)),
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

const discovery = defineComponent({
    id: 'discovery',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-discovery',
    ports: PLATFORM_PORTS,
    defaultParams: discoveryDefaults,
    paramSchema: {
        services: num('scale', { min: 1, max: 10000 }),
        registeredInstances: num('scale', { min: 1, max: 1000000 }),
        healthCheckIntervalSec: num('behaviour', { unitKey: 'sec', min: 1, max: 600 }),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 5, max: 60 } }),
        resolverCacheHitRatio: num('performance', { min: 0, max: 0.99, step: 0.01 }),
        instances: num('scale', { min: 1, max: 100 }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 100, max: 1000000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: discoveryModel,
    helpId: 'discovery',
});

const SECRETS_CORES_PER_INSTANCE = 4;

const secretsDefaults = {
    rateLimitRps: 1200,
    ttlSec: 300,
    encryptionMs: 2,
    serviceTimeMs: 4,
    instances: 3,
    availability: 0.9995,
    costPerCall: 0.000003,
    costPerInstanceHour: 0.15,
};

function secretsFetchesPerRequest(params: typeof secretsDefaults): number {
    return 1 / (1 + params.ttlSec);
}

function secretsServiceSec(params: typeof secretsDefaults): number {
    return ((params.serviceTimeMs + params.encryptionMs) * secretsFetchesPerRequest(params)) / 1000;
}

const secretsModel = defineModel<typeof secretsDefaults>({
    serviceSec: (ctx) => secretsServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'rate-limit',
            ctx.params.rateLimitRps * (1 + ctx.params.ttlSec),
            'rateLimitRps × (1 + ttlSec)',
            { rateLimitRps: ctx.params.rateLimitRps, ttlSec: ctx.params.ttlSec },
        ),
        littleLaw('cpu', ctx.instances * SECRETS_CORES_PER_INSTANCE, secretsServiceSec(ctx.params)),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests:
                ctx.lambda * secretsFetchesPerRequest(ctx.params) * SECONDS_PER_MONTH * ctx.params.costPerCall,
        }),
    availability: (params) => params.availability,
});

const secrets = defineComponent({
    id: 'secrets',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-secrets',
    ports: PLATFORM_PORTS,
    defaultParams: secretsDefaults,
    paramSchema: {
        rateLimitRps: num('capacity', { unitKey: 'rps', min: 1, max: 1000000, realistic: { min: 500, max: 10000 } }),
        ttlSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400, realistic: { min: 60, max: 3600 } }),
        encryptionMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        instances: num('scale', { min: 1, max: 100 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerCall: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.000001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: secretsModel,
    helpId: 'secrets',
});

const LOCK_BACKEND_THROUGHPUT_SHARE: Record<string, number> = {
    redis: 1,
    etcd: 0.1,
    zk: 0.08,
};

const SHARED_READ_LOCK_FACTOR = 0.1;

const distLockDefaults = {
    backend: 'redis',
    lockHoldMs: 20,
    contentionRate: 0.05,
    fencingTokens: true,
    maxOpsPerSec: 100000,
    serviceTimeMs: 1,
    instances: 3,
    availability: 0.999,
    costPerInstanceHour: 0.2,
};

function distLockHoldSec(params: typeof distLockDefaults): number {
    return params.lockHoldMs / 1000;
}

function distLockOpsPerLock(params: typeof distLockDefaults): number {
    return params.fencingTokens ? 3 : 2;
}

function distLockBackendShare(params: typeof distLockDefaults): number {
    return LOCK_BACKEND_THROUGHPUT_SHARE[params.backend] ?? 1;
}

function distLockServiceSec(params: typeof distLockDefaults): number {
    return (params.serviceTimeMs + params.contentionRate * params.lockHoldMs) / 1000;
}

const distLockModel = defineModel<typeof distLockDefaults>({
    serviceSec: (ctx) => distLockServiceSec(ctx.params),
    resources: (ctx) => [
        weightedUnitBound(
            'lock-serialization',
            '1 / (contentionRate × lockHoldMs / 1000 × (readShare × sharedLockFactor + writeShare))',
            {
                contentionRate: ctx.params.contentionRate,
                lockHoldMs: ctx.params.lockHoldMs,
                sharedLockFactor: SHARED_READ_LOCK_FACTOR,
                readShare: ctx.readShare,
                writeShare: ctx.writeShare,
            },
            ctx.params.contentionRate * distLockHoldSec(ctx.params) * SHARED_READ_LOCK_FACTOR,
            ctx.params.contentionRate * distLockHoldSec(ctx.params),
            ctx.readShare,
            ctx.writeShare,
        ),
        resourceLimit(
            'ops',
            (ctx.params.maxOpsPerSec * distLockBackendShare(ctx.params)) / distLockOpsPerLock(ctx.params),
            'maxOpsPerSec × backendShare / opsPerLock',
            {
                maxOpsPerSec: ctx.params.maxOpsPerSec,
                backendShare: distLockBackendShare(ctx.params),
                opsPerLock: distLockOpsPerLock(ctx.params),
            },
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

const distLock = defineComponent({
    id: 'dist-lock',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-lock',
    ports: PLATFORM_PORTS,
    defaultParams: distLockDefaults,
    paramSchema: {
        backend: choice('topology', ['redis', 'etcd', 'zk']),
        lockHoldMs: num('behaviour', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1, realistic: { min: 5, max: 200 } }),
        contentionRate: num('behaviour', { min: 0, max: 1, step: 0.01, realistic: { min: 0.01, max: 0.3 } }),
        fencingTokens: bool('consistency'),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 100, max: 10000000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.01, max: 1000, step: 0.01 }),
        instances: num('scale', { min: 1, max: 100 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: distLockModel,
    helpId: 'dist-lock',
});

const ID_GEN_CORES_PER_INSTANCE = 4;

const ID_MONOTONIC_THROUGHPUT_SHARE = 0.25;

const idGenDefaults = {
    strategy: 'snowflake',
    idsPerSec: 250000,
    clockSkewRisk: 0.02,
    monotonic: true,
    instances: 3,
    serviceTimeMs: 0.05,
    availability: 0.9999,
    costPerInstanceHour: 0.08,
};

function idGenGenerators(params: typeof idGenDefaults, instances: number): number {
    return params.strategy === 'ticket-server' ? 1 : instances;
}

function idGenMonotonicShare(params: typeof idGenDefaults): number {
    return params.monotonic ? ID_MONOTONIC_THROUGHPUT_SHARE : 1;
}

function idGenServiceSec(params: typeof idGenDefaults): number {
    return (params.serviceTimeMs * (1 + params.clockSkewRisk)) / 1000;
}

const idGenModel = defineModel<typeof idGenDefaults>({
    serviceSec: (ctx) => idGenServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'ops',
            idGenGenerators(ctx.params, ctx.instances) * ctx.params.idsPerSec * idGenMonotonicShare(ctx.params),
            'generators × idsPerSec × monotonicShare',
            {
                generators: idGenGenerators(ctx.params, ctx.instances),
                idsPerSec: ctx.params.idsPerSec,
                monotonicShare: idGenMonotonicShare(ctx.params),
                strategy: ctx.params.strategy,
            },
        ),
        littleLaw('cpu', ctx.instances * ID_GEN_CORES_PER_INSTANCE, idGenServiceSec(ctx.params)),
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

const idGen = defineComponent({
    id: 'id-gen',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-id-gen',
    ports: PLATFORM_PORTS,
    defaultParams: idGenDefaults,
    paramSchema: {
        strategy: choice('behaviour', ['snowflake', 'uuidv7', 'ticket-server']),
        idsPerSec: num('capacity', { unitKey: 'rps', min: 100, max: 100000000 }),
        clockSkewRisk: num('reliability', { min: 0, max: 1, step: 0.01, realistic: { min: 0, max: 0.1 } }),
        monotonic: bool('consistency'),
        instances: num('scale', { min: 1, max: 1000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.001, max: 100, step: 0.001 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: idGenModel,
    helpId: 'id-gen',
});

const NOTIFICATION_ATTEMPTS: Record<string, number> = {
    none: 1,
    once: 2,
    'exponential-backoff': 3,
};

const notificationDefaults = {
    channels: 2,
    fanoutPerEvent: 20,
    providerLimitRps: 12000,
    delaySec: 5,
    retryPolicy: 'once',
    errorRate: 0.02,
    maxInflight: 100000,
    concurrency: 200,
    instances: 3,
    serviceTimeMs: 20,
    availability: 0.999,
    costPerMessage: 0.0002,
    costPerInstanceHour: 0.15,
};

function notificationAttemptsPerMessage(params: typeof notificationDefaults): number {
    return 1 + ((NOTIFICATION_ATTEMPTS[params.retryPolicy] ?? 1) - 1) * params.errorRate;
}

function notificationMessagesPerEvent(params: typeof notificationDefaults): number {
    return params.fanoutPerEvent * params.channels * notificationAttemptsPerMessage(params);
}

function notificationServiceSec(params: typeof notificationDefaults): number {
    return (notificationMessagesPerEvent(params) * params.serviceTimeMs) / 1000;
}

const notificationModel = defineModel<typeof notificationDefaults>({
    serviceSec: (ctx) => notificationServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'rate-limit',
            ctx.params.providerLimitRps / notificationMessagesPerEvent(ctx.params),
            'providerLimitRps / (fanoutPerEvent × channels × attemptsPerMessage)',
            {
                providerLimitRps: ctx.params.providerLimitRps,
                fanoutPerEvent: ctx.params.fanoutPerEvent,
                channels: ctx.params.channels,
                attemptsPerMessage: notificationAttemptsPerMessage(ctx.params),
            },
        ),
        littleLaw('workers', ctx.instances * ctx.params.concurrency, notificationServiceSec(ctx.params)),
        littleLaw(
            'inflight',
            ctx.params.maxInflight,
            ctx.params.delaySec * notificationMessagesPerEvent(ctx.params),
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests:
                ctx.lambda *
                notificationMessagesPerEvent(ctx.params) *
                SECONDS_PER_MONTH *
                ctx.params.costPerMessage,
        }),
    availability: (params) => params.availability,
});

const notification = defineComponent({
    id: 'notification',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-notification',
    ports: DISPATCH_PORTS,
    defaultParams: notificationDefaults,
    paramSchema: {
        channels: num('behaviour', { min: 1, max: 10 }),
        fanoutPerEvent: num('behaviour', { min: 1, max: 1000000, realistic: { min: 1, max: 1000 } }),
        providerLimitRps: num('capacity', { unitKey: 'rps', min: 1, max: 10000000 }),
        delaySec: num('performance', { unitKey: 'sec', min: 0, max: 3600 }),
        retryPolicy: choice('behaviour', ['none', 'once', 'exponential-backoff']),
        errorRate: num('reliability', { min: 0, max: 1, step: 0.001 }),
        maxInflight: num('capacity', { min: 100, max: 10000000 }),
        concurrency: num('capacity', { min: 1, max: 100000 }),
        instances: num('scale', { min: 1, max: 1000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 1, max: 60000, realistic: { min: 10, max: 500 } }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerMessage: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.00001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: notificationModel,
    helpId: 'notification',
});

const webhookDefaults = {
    subscribers: 20,
    deliveryTimeoutMs: 5000,
    retryBackoffMs: 1000,
    maxRetries: 3,
    slowConsumerShare: 0.05,
    concurrency: 256,
    serviceTimeMs: 80,
    maxOpsPerSec: 5000,
    instances: 3,
    availability: 0.999,
    costPerInstanceHour: 0.15,
};

function webhookAttemptSec(params: typeof webhookDefaults): number {
    const fastSec = (1 - params.slowConsumerShare) * params.serviceTimeMs;
    const slowSec =
        params.slowConsumerShare * (params.deliveryTimeoutMs + params.maxRetries * params.retryBackoffMs);

    return (fastSec + slowSec) / 1000;
}

function webhookServiceSec(params: typeof webhookDefaults): number {
    return params.subscribers * webhookAttemptSec(params);
}

const webhookModel = defineModel<typeof webhookDefaults>({
    serviceSec: (ctx) => webhookServiceSec(ctx.params),
    resources: (ctx) => [
        littleLaw('concurrency', ctx.instances * ctx.params.concurrency, webhookServiceSec(ctx.params)),
        resourceLimit(
            'ops',
            (ctx.instances * ctx.params.maxOpsPerSec) / ctx.params.subscribers,
            'instances × maxOpsPerSec / subscribers',
            {
                instances: ctx.instances,
                maxOpsPerSec: ctx.params.maxOpsPerSec,
                subscribers: ctx.params.subscribers,
            },
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

const webhook = defineComponent({
    id: 'webhook',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-webhook',
    ports: DISPATCH_PORTS,
    defaultParams: webhookDefaults,
    paramSchema: {
        subscribers: num('scale', { min: 1, max: 1000000 }),
        deliveryTimeoutMs: num('behaviour', { unitKey: 'ms', min: 100, max: 300000, realistic: { min: 1000, max: 10000 } }),
        retryBackoffMs: num('behaviour', { unitKey: 'ms', min: 0, max: 60000 }),
        maxRetries: num('behaviour', { min: 0, max: 10 }),
        slowConsumerShare: num('behaviour', { min: 0, max: 1, step: 0.01, realistic: { min: 0.01, max: 0.2 } }),
        concurrency: num('capacity', { min: 1, max: 100000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 1, max: 60000, realistic: { min: 30, max: 500 } }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 100, max: 1000000 }),
        instances: num('scale', { min: 1, max: 1000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: webhookModel,
    helpId: 'webhook',
});

const PAYMENT_STATUS_POLLS_PER_TRANSACTION = 3;

const paymentExternalDefaults = {
    p50Ms: 200,
    p99Ms: 3000,
    rateLimitRps: 300,
    maxConcurrency: 200,
    timeoutMs: 10000,
    idempotencyRequired: true,
    webhookCallback: true,
    errorRate: 0.01,
    availability: 0.999,
    costPerTransaction: 0.029,
};

function paymentCallsPerTransaction(params: typeof paymentExternalDefaults): number {
    return params.webhookCallback ? 1 : PAYMENT_STATUS_POLLS_PER_TRANSACTION;
}

const paymentExternalModel = defineModel<typeof paymentExternalDefaults>({
    serviceSec: (ctx) => (ctx.params.p50Ms * paymentCallsPerTransaction(ctx.params)) / 1000,
    resources: (ctx) => [
        resourceLimit(
            'rate-limit',
            ctx.params.rateLimitRps / paymentCallsPerTransaction(ctx.params),
            'rateLimitRps / callsPerTransaction',
            {
                rateLimitRps: ctx.params.rateLimitRps,
                callsPerTransaction: paymentCallsPerTransaction(ctx.params),
                webhookCallback: String(ctx.params.webhookCallback),
            },
        ),
        littleLaw(
            'concurrency',
            ctx.params.maxConcurrency,
            (ctx.params.p50Ms * paymentCallsPerTransaction(ctx.params)) / 1000,
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: 0,
            storage: 0,
            network: 0,
            requests: ctx.lambda * SECONDS_PER_MONTH * ctx.params.costPerTransaction,
        }),
    availability: (params) => params.availability,
});

const paymentExternal = defineComponent({
    id: 'payment-external',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-payment',
    ports: PLATFORM_PORTS,
    defaultParams: paymentExternalDefaults,
    paramSchema: {
        p50Ms: num('performance', { unitKey: 'ms', min: 1, max: 120000, realistic: { min: 100, max: 600 } }),
        p99Ms: num('performance', { unitKey: 'ms', min: 1, max: 300000, realistic: { min: 800, max: 8000 } }),
        rateLimitRps: num('capacity', { unitKey: 'rps', min: 1, max: 1000000 }),
        maxConcurrency: num('capacity', { min: 1, max: 100000 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 1, max: 300000 }),
        idempotencyRequired: bool('consistency'),
        webhookCallback: bool('behaviour'),
        errorRate: num('reliability', { min: 0, max: 1, step: 0.001 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerTransaction: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
    },
    model: paymentExternalModel,
    helpId: 'payment-external',
    managed: true,
});

const SAGA_TRANSITIONS_PER_STEP = 2;

const SAGA_STATE_STORE_THROUGHPUT_SHARE: Record<string, number> = {
    database: 1,
    redis: 4,
    kafka: 2.5,
};

const sagaOrchestratorDefaults = {
    workflowsPerSec: 2000,
    stepsPerWorkflow: 8,
    stateStore: 'database',
    retentionDays: 30,
    rowSizeBytes: 512,
    maxOpsPerSec: 20000,
    concurrency: 100,
    instances: 3,
    serviceTimeMs: 6,
    availability: 0.999,
    costPerStateTransition: 0.000025,
    costPerGbMonth: 0.1,
    costPerInstanceHour: 0.2,
};

function sagaTransitionsPerWorkflow(params: typeof sagaOrchestratorDefaults): number {
    return params.stepsPerWorkflow * SAGA_TRANSITIONS_PER_STEP;
}

function sagaStateStoreShare(params: typeof sagaOrchestratorDefaults): number {
    return SAGA_STATE_STORE_THROUGHPUT_SHARE[params.stateStore] ?? 1;
}

function sagaServiceSec(params: typeof sagaOrchestratorDefaults): number {
    return (params.stepsPerWorkflow * params.serviceTimeMs) / 1000;
}

const sagaOrchestratorModel = defineModel<typeof sagaOrchestratorDefaults>({
    serviceSec: (ctx) => sagaServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'state-transitions',
            (ctx.params.maxOpsPerSec * sagaStateStoreShare(ctx.params)) / sagaTransitionsPerWorkflow(ctx.params),
            'maxOpsPerSec × stateStoreShare / (stepsPerWorkflow × transitionsPerStep)',
            {
                maxOpsPerSec: ctx.params.maxOpsPerSec,
                stateStoreShare: sagaStateStoreShare(ctx.params),
                stepsPerWorkflow: ctx.params.stepsPerWorkflow,
                transitionsPerStep: SAGA_TRANSITIONS_PER_STEP,
            },
        ),
        quotaBound('quotaRps', ctx.params.workflowsPerSec),
        littleLaw('workers', ctx.instances * ctx.params.concurrency, sagaServiceSec(ctx.params)),
    ],
    storage: (ctx) => {
        const transitions = sagaTransitionsPerWorkflow(ctx.params);
        const growthGbDay = (ctx.lambda * transitions * ctx.params.rowSizeBytes * SECONDS_PER_DAY) / 1e9;
        const retainedDays = Math.min(ctx.params.retentionDays, ctx.horizonDays);

        return {
            totalGb: growthGbDay * retainedDays,
            growthGbDay,
            memoryGb: 0,
            explain: [
                explain(
                    'workflowsRps × stepsPerWorkflow × transitionsPerStep × rowSizeBytes × 86400 / 10⁹',
                    {
                        workflowsRps: ctx.lambda,
                        stepsPerWorkflow: ctx.params.stepsPerWorkflow,
                        transitionsPerStep: SAGA_TRANSITIONS_PER_STEP,
                        rowSizeBytes: ctx.params.rowSizeBytes,
                    },
                    growthGbDay,
                    'gb/day',
                ),
                explain(
                    'growthGbDay × min(retentionDays, horizonDays)',
                    {
                        growthGbDay,
                        retentionDays: ctx.params.retentionDays,
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
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: ctx.storageGb * ctx.params.costPerGbMonth,
            network: 0,
            requests:
                ctx.lambda *
                sagaTransitionsPerWorkflow(ctx.params) *
                SECONDS_PER_MONTH *
                ctx.params.costPerStateTransition,
        }),
    availability: (params) => params.availability,
});

const sagaOrchestrator = defineComponent({
    id: 'saga-orchestrator',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-saga',
    ports: DISPATCH_PORTS,
    defaultParams: sagaOrchestratorDefaults,
    paramSchema: {
        workflowsPerSec: num('capacity', { unitKey: 'rps', min: 1, max: 1000000 }),
        stepsPerWorkflow: num('behaviour', { min: 1, max: 1000, realistic: { min: 3, max: 30 } }),
        stateStore: choice('topology', ['database', 'redis', 'kafka']),
        retentionDays: num('data', { min: 1, max: 3650 }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 16, max: 1048576 }),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 100, max: 10000000 }),
        concurrency: num('capacity', { min: 1, max: 100000 }),
        instances: num('scale', { min: 1, max: 1000 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.1, max: 60000, step: 0.1 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerStateTransition: num('cost', { unitKey: 'usd', min: 0, max: 1, step: 0.000001 }),
        costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: sagaOrchestratorModel,
    helpId: 'saga-orchestrator',
});

const GEO_CELL_EDGE_KM_AT_ROOT = 5000;

const GEO_CELL_SPLIT_PER_LEVEL = 4;

const GEO_BACKEND_THROUGHPUT_SHARE: Record<string, number> = {
    redis: 1,
    database: 0.15,
    search: 0.4,
};

const geoIndexDefaults = {
    precision: 6,
    cellCount: 5000000,
    updatesPerSec: 50000,
    queryRadiusKm: 5,
    backend: 'redis',
    maxOpsPerSec: 200000,
    rowSizeBytes: 256,
    serviceTimeMs: 0.05,
    instances: 3,
    availability: 0.999,
    costPerInstanceHour: 0.25,
};

function geoCellEdgeKm(params: typeof geoIndexDefaults): number {
    return GEO_CELL_EDGE_KM_AT_ROOT / Math.pow(GEO_CELL_SPLIT_PER_LEVEL, params.precision);
}

function geoCellsPerQuery(params: typeof geoIndexDefaults): number {
    const edgeKm = geoCellEdgeKm(params);
    const areaKm2 = Math.PI * params.queryRadiusKm * params.queryRadiusKm;

    return Math.max(Math.ceil(areaKm2 / (edgeKm * edgeKm)), 1);
}

function geoIndexBackendShare(params: typeof geoIndexDefaults): number {
    return GEO_BACKEND_THROUGHPUT_SHARE[params.backend] ?? 1;
}

function geoIndexOpsPerSec(params: typeof geoIndexDefaults, instances: number): number {
    return instances * params.maxOpsPerSec * geoIndexBackendShare(params);
}

function geoIndexServiceSec(
    params: typeof geoIndexDefaults,
    readShare: number,
    writeShare: number,
): number {
    return ((readShare * geoCellsPerQuery(params) + writeShare) * params.serviceTimeMs) / 1000;
}

const geoIndexModel = defineModel<typeof geoIndexDefaults>({
    serviceSec: (ctx) => geoIndexServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
    resources: (ctx) => [
        weightedUnitBound(
            'ops',
            'instances × maxOpsPerSec × backendShare / (readShare × cellsPerQuery + writeShare)',
            {
                instances: ctx.instances,
                maxOpsPerSec: ctx.params.maxOpsPerSec,
                backendShare: geoIndexBackendShare(ctx.params),
                cellsPerQuery: geoCellsPerQuery(ctx.params),
                readShare: ctx.readShare,
                writeShare: ctx.writeShare,
            },
            geoCellsPerQuery(ctx.params) / geoIndexOpsPerSec(ctx.params, ctx.instances),
            1 / geoIndexOpsPerSec(ctx.params, ctx.instances),
            ctx.readShare,
            ctx.writeShare,
        ),
        weightedUnitBound(
            'throughput',
            'updatesPerSec / writeShare',
            { updatesPerSec: ctx.params.updatesPerSec, writeShare: ctx.writeShare },
            0,
            1 / ctx.params.updatesPerSec,
            ctx.readShare,
            ctx.writeShare,
        ),
    ],
    storage: (ctx) => {
        const indexGb = (ctx.params.cellCount * ctx.params.rowSizeBytes) / 1e9;

        return {
            totalGb: indexGb,
            growthGbDay: 0,
            memoryGb: ctx.params.backend === 'redis' ? indexGb : 0,
            explain: [
                explain(
                    'cellCount × rowSizeBytes / 10⁹',
                    {
                        cellCount: ctx.params.cellCount,
                        rowSizeBytes: ctx.params.rowSizeBytes,
                        precision: ctx.params.precision,
                    },
                    indexGb,
                    'gb',
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

const geoIndex = defineComponent({
    id: 'geo-index',
    group: 'platform',
    shape: 'node',
    wave: 'v1',
    icon: 'sd-geo-index',
    ports: PLATFORM_PORTS,
    defaultParams: geoIndexDefaults,
    paramSchema: {
        precision: num('data', { min: 1, max: 12, realistic: { min: 5, max: 9 } }),
        cellCount: num('data', { min: 1, max: 1000000000000 }),
        updatesPerSec: num('capacity', { unitKey: 'rps', min: 1, max: 10000000 }),
        queryRadiusKm: num('behaviour', { min: 0.01, max: 20000, step: 0.01, realistic: { min: 0.5, max: 50 } }),
        backend: choice('topology', ['redis', 'database', 'search']),
        maxOpsPerSec: num('capacity', { unitKey: 'rps', min: 100, max: 10000000 }),
        rowSizeBytes: num('data', { unitKey: 'bytes', min: 16, max: 1048576 }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 0.001, max: 1000, step: 0.001 }),
        instances: num('scale', { min: 1, max: 1000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: geoIndexModel,
    helpId: 'geo-index',
});

const EMAIL_DELIVERY_ATTEMPTS: Record<string, number> = {
    none: 1,
    once: 2,
    'exponential-backoff': 4,
};

const EMAIL_DKIM_SIGN_MS = 1.5;

const emailSmtpDefaults = {
    messagesPerEvent: 1,
    messagesPerSec: 500,
    bounceRate: 0.02,
    retryPolicy: 'exponential-backoff',
    instances: 2,
    concurrency: 60,
    maxConnections: 400,
    serviceTimeMs: 150,
    dkimSigning: true,
    deliveryLagSec: 8,
    maxInflight: 200000,
    availability: 0.999,
    costPerThousand: 0.1,
    costPerInstanceHour: 0.06,
};

function emailAttemptsPerMessage(params: typeof emailSmtpDefaults): number {
    return 1 + ((EMAIL_DELIVERY_ATTEMPTS[params.retryPolicy] ?? 1) - 1) * params.bounceRate;
}

function emailDeliveriesPerEvent(params: typeof emailSmtpDefaults): number {
    return params.messagesPerEvent * emailAttemptsPerMessage(params);
}

function emailMessageSec(params: typeof emailSmtpDefaults): number {
    return (params.serviceTimeMs + (params.dkimSigning ? EMAIL_DKIM_SIGN_MS : 0)) / 1000;
}

function emailServiceSec(params: typeof emailSmtpDefaults): number {
    return emailDeliveriesPerEvent(params) * emailMessageSec(params);
}

const emailSmtpModel = defineModel<typeof emailSmtpDefaults>({
    serviceSec: (ctx) => emailServiceSec(ctx.params),
    resources: (ctx) => [
        resourceLimit(
            'rate-limit',
            ctx.params.messagesPerSec / emailDeliveriesPerEvent(ctx.params),
            'messagesPerSec / (messagesPerEvent × attemptsPerMessage)',
            {
                messagesPerSec: ctx.params.messagesPerSec,
                messagesPerEvent: ctx.params.messagesPerEvent,
                attemptsPerMessage: emailAttemptsPerMessage(ctx.params),
            },
        ),
        littleLaw('workers', ctx.instances * ctx.params.concurrency, emailServiceSec(ctx.params)),
        connectionBound(
            'connections',
            ctx.instances * ctx.params.maxConnections,
            emailDeliveriesPerEvent(ctx.params),
            emailMessageSec(ctx.params),
        ),
        littleLaw(
            'inflight',
            ctx.params.maxInflight,
            ctx.params.deliveryLagSec * emailDeliveriesPerEvent(ctx.params),
        ),
    ],
    cost: (ctx) =>
        totalCost({
            compute: ctx.instances * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
            storage: 0,
            network: 0,
            requests:
                (ctx.lambda * emailDeliveriesPerEvent(ctx.params) * SECONDS_PER_MONTH * ctx.params.costPerThousand) /
                1000,
        }),
    availability: (params) => params.availability,
});

const emailSmtp = defineComponent({
    id: 'email-smtp',
    group: 'platform',
    shape: 'node',
    wave: 'v2',
    icon: 'sd-notification',
    ports: DISPATCH_PORTS,
    defaultParams: emailSmtpDefaults,
    paramSchema: {
        messagesPerEvent: num('behaviour', { min: 1, max: 100000, realistic: { min: 1, max: 100 } }),
        messagesPerSec: num('capacity', { min: 1, max: 1000000, realistic: { min: 50, max: 5000 } }),
        bounceRate: num('reliability', { min: 0, max: 1, step: 0.001, realistic: { min: 0.005, max: 0.05 } }),
        retryPolicy: choice('behaviour', ['none', 'once', 'exponential-backoff']),
        instances: num('scale', { min: 1, max: 1000 }),
        concurrency: num('capacity', { min: 1, max: 100000 }),
        maxConnections: num('capacity', { min: 1, max: 1000000, realistic: { min: 50, max: 5000 } }),
        serviceTimeMs: num('performance', { unitKey: 'ms', min: 1, max: 60000, realistic: { min: 50, max: 500 } }),
        dkimSigning: bool('reliability'),
        deliveryLagSec: num('performance', { unitKey: 'sec', min: 0, max: 3600, realistic: { min: 1, max: 60 } }),
        maxInflight: num('capacity', { min: 100, max: 10000000 }),
        availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
        costPerThousand: num('cost', { unitKey: 'usd', min: 0, max: 100, step: 0.001 }),
        costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    },
    model: emailSmtpModel,
    helpId: 'email-smtp',
});

export const platformComponents: ComponentDefinition[] = [
    auth,
    sessionStore,
    config,
    discovery,
    secrets,
    distLock,
    idGen,
    notification,
    webhook,
    paymentExternal,
    externalApi,
    sagaOrchestrator,
    geoIndex,
    emailSmtp,
] as unknown as ComponentDefinition[];
