import type { ComponentDefinition, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_MONTH } from '../sim/constants';
import { defineModel, explicitRps, littleLaw, quotaBound, totalCost } from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const PLATFORM_PORTS: PortSpec = {
    in: [{ id: 'in', protocols: ['http', 'grpc'], role: 'serve' }],
    out: [],
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

export const platformComponents: ComponentDefinition[] = [auth, externalApi] as unknown as ComponentDefinition[];
