import type { PricingProfile } from '../types/component';
import type { NetworkScope } from './types';

export type GeoZone = 'north-america' | 'south-america' | 'europe' | 'africa' | 'asia' | 'oceania';

export const GEO_ZONES: GeoZone[] = [
    'north-america',
    'south-america',
    'europe',
    'africa',
    'asia',
    'oceania',
];

const GEO_RTT_MS: Record<GeoZone, Record<GeoZone, number>> = {
    'north-america': {
        'north-america': 30,
        'south-america': 120,
        europe: 80,
        africa: 170,
        asia: 150,
        oceania: 160,
    },
    'south-america': {
        'north-america': 120,
        'south-america': 30,
        europe: 180,
        africa: 220,
        asia: 300,
        oceania: 280,
    },
    europe: {
        'north-america': 80,
        'south-america': 180,
        europe: 25,
        africa: 90,
        asia: 140,
        oceania: 250,
    },
    africa: {
        'north-america': 170,
        'south-america': 220,
        europe: 90,
        africa: 40,
        asia: 200,
        oceania: 300,
    },
    asia: {
        'north-america': 150,
        'south-america': 300,
        europe: 140,
        africa: 200,
        asia: 40,
        oceania: 110,
    },
    oceania: {
        'north-america': 160,
        'south-america': 280,
        europe: 250,
        africa: 300,
        asia: 110,
        oceania: 30,
    },
};

export function geoRttMs(from: string, to: string): number {
    const source = GEO_RTT_MS[from as GeoZone];
    if (!source) return DEFAULT_RTT_MS['cross-region'];
    const value = source[to as GeoZone];
    return value ?? DEFAULT_RTT_MS['cross-region'];
}

export const DEFAULT_RTT_MS: Record<NetworkScope, number> = {
    local: 0.05,
    'same-az': 0.35,
    'cross-az': 1.2,
    'cross-region': 80,
    internet: 45,
};

export const CLIENT_RTT_MS: Record<string, number> = {
    wifi: 25,
    umts: 120,
    lte: 60,
    nr5g: 20,
};

export const SECONDS_PER_MONTH = 2_628_000;

export const HOURS_PER_MONTH = 730;

export const SECONDS_PER_DAY = 86_400;

export const SECONDS_PER_YEAR = 31_536_000;

export const DAYS_PER_MONTH = 30.44;

export const ARRIVAL_VARIABILITY: Record<string, number> = {
    baseline: 1,
    peak: 1.4,
    spike: 8,
    'cache-flush': 2,
    'az-failure': 2,
    'region-failure': 2,
    'stale-read': 1,
    'write-conflict': 1,
    growth: 1.4,
    'black-friday': 2,
    'db-failover': 2,
    'hot-key': 2,
    'slow-dependency': 1,
    'thundering-herd': 6,
    'retry-storm': 4,
    'poison-message': 1,
};

export const PRICING_PROFILES: Record<string, PricingProfile> = {
    'aws-2026-q2': {
        id: 'aws-2026-q2',
        asOf: '2026-Q2',
        egressPerGb: 0.09,
        crossAzPerGb: 0.01,
        crossRegionPerGb: 0.02,
        requestsPerMillion: 0.4,
        managedMultiplier: 1,
    },
    'gcp-2026-q2': {
        id: 'gcp-2026-q2',
        asOf: '2026-Q2',
        egressPerGb: 0.085,
        crossAzPerGb: 0.01,
        crossRegionPerGb: 0.02,
        requestsPerMillion: 0.4,
        managedMultiplier: 0.95,
    },
    'hetzner-2026-q2': {
        id: 'hetzner-2026-q2',
        asOf: '2026-Q2',
        egressPerGb: 0.001,
        crossAzPerGb: 0,
        crossRegionPerGb: 0.001,
        requestsPerMillion: 0,
        managedMultiplier: 0.45,
    },
    'on-prem': {
        id: 'on-prem',
        asOf: '2026-Q2',
        egressPerGb: 0.02,
        crossAzPerGb: 0,
        crossRegionPerGb: 0.005,
        requestsPerMillion: 0,
        managedMultiplier: 0.6,
    },
};

export const DEFAULT_PRICING = PRICING_PROFILES['aws-2026-q2'];

export function pricingFor(profileId: string): PricingProfile {
    return PRICING_PROFILES[profileId] ?? DEFAULT_PRICING;
}
