import type { ComponentDefinition, PortSpec } from '../types/component';
import { bool, choice, defineComponent, num } from './_shared/params';

const CLIENT_PORTS: PortSpec = {
    in: [],
    out: [{ id: 'out', protocols: ['http', 'grpc', 'ws', 'dns'], role: 'call' }],
};

const GEO_DISTRIBUTION = ['global', 'north-america', 'south-america', 'europe', 'africa', 'asia', 'oceania'];

const DIURNAL_PATTERN = ['flat', 'business', 'evening', 'global'];

const clientWeb = defineComponent({
    id: 'client-web',
    group: 'clients',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-client-web',
    ports: CLIENT_PORTS,
    defaultParams: {
        dau: 2000000,
        sessionsPerUserDay: 3,
        requestsPerSession: 40,
        sessionDurationMin: 9,
        growthPerYear: 0.35,
        peakFactor: 3,
        diurnalPattern: 'business',
        readWriteMix: 0.85,
        cacheableShare: 0.6,
        avgRequestKb: 2,
        avgResponseKb: 45,
        geoDistribution: 'europe',
        keepAlive: true,
        retries: 1,
        timeoutMs: 15000,
    },
    paramSchema: {
        dau: num('scale', { min: 1, max: 5000000000, realistic: { min: 1000, max: 500000000 } }),
        sessionsPerUserDay: num('scale', { min: 0.1, max: 200, step: 0.1 }),
        requestsPerSession: num('scale', { min: 1, max: 10000 }),
        sessionDurationMin: num('behaviour', { min: 0.1, max: 1440, step: 0.1 }),
        growthPerYear: num('scale', { min: -0.5, max: 10, step: 0.05 }),
        peakFactor: num('behaviour', { min: 1, max: 20, step: 0.1, realistic: { min: 1.5, max: 6 } }),
        diurnalPattern: choice('behaviour', DIURNAL_PATTERN),
        readWriteMix: num('behaviour', { min: 0, max: 1, step: 0.01 }),
        cacheableShare: num('behaviour', { min: 0, max: 1, step: 0.01 }),
        avgRequestKb: num('data', { unitKey: 'kb', min: 0.1, max: 10240, step: 0.1 }),
        avgResponseKb: num('data', { unitKey: 'kb', min: 0.1, max: 102400, step: 0.1 }),
        geoDistribution: choice('topology', GEO_DISTRIBUTION),
        keepAlive: bool('behaviour'),
        retries: num('behaviour', { min: 0, max: 10 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 100, max: 300000 }),
    },
    helpId: 'client-web',
});

const clientMobile = defineComponent({
    id: 'client-mobile',
    group: 'clients',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-client-mobile',
    ports: CLIENT_PORTS,
    defaultParams: {
        dau: 3000000,
        sessionsPerUserDay: 6,
        requestsPerSession: 25,
        sessionDurationMin: 4,
        growthPerYear: 0.5,
        peakFactor: 3.5,
        diurnalPattern: 'evening',
        readWriteMix: 0.8,
        cacheableShare: 0.45,
        avgRequestKb: 1.5,
        avgResponseKb: 18,
        geoDistribution: 'global',
        networkProfile: 'lte',
        networkRttMs: 60,
        pollIntervalSec: 30,
        offlineSyncBurst: 25,
        pushEnabled: true,
        retries: 3,
        timeoutMs: 20000,
    },
    paramSchema: {
        dau: num('scale', { min: 1, max: 5000000000, realistic: { min: 1000, max: 500000000 } }),
        sessionsPerUserDay: num('scale', { min: 0.1, max: 200, step: 0.1 }),
        requestsPerSession: num('scale', { min: 1, max: 10000 }),
        sessionDurationMin: num('behaviour', { min: 0.1, max: 1440, step: 0.1 }),
        growthPerYear: num('scale', { min: -0.5, max: 10, step: 0.05 }),
        peakFactor: num('behaviour', { min: 1, max: 20, step: 0.1, realistic: { min: 1.5, max: 6 } }),
        diurnalPattern: choice('behaviour', DIURNAL_PATTERN),
        readWriteMix: num('behaviour', { min: 0, max: 1, step: 0.01 }),
        cacheableShare: num('behaviour', { min: 0, max: 1, step: 0.01 }),
        avgRequestKb: num('data', { unitKey: 'kb', min: 0.1, max: 10240, step: 0.1 }),
        avgResponseKb: num('data', { unitKey: 'kb', min: 0.1, max: 102400, step: 0.1 }),
        geoDistribution: choice('topology', GEO_DISTRIBUTION),
        networkProfile: choice('performance', ['wifi', 'umts', 'lte', 'nr5g']),
        networkRttMs: num('performance', { unitKey: 'ms', min: 5, max: 2000 }),
        pollIntervalSec: num('behaviour', { unitKey: 'sec', min: 0, max: 86400 }),
        offlineSyncBurst: num('behaviour', { min: 0, max: 10000 }),
        pushEnabled: bool('behaviour'),
        retries: num('behaviour', { min: 0, max: 10 }),
        timeoutMs: num('behaviour', { unitKey: 'ms', min: 100, max: 300000 }),
    },
    helpId: 'client-mobile',
});

export const clientComponents: ComponentDefinition[] = [
    clientWeb,
    clientMobile,
] as unknown as ComponentDefinition[];
