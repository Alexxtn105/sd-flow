import type { ComponentDefinition } from '../types/component';
import { bool, choice, defineComponent, num, text } from './_shared/params';

const NO_PORTS = { in: [], out: [] };

const region = defineComponent({
    id: 'region',
    group: 'topology',
    shape: 'container',
    wave: 'mvp',
    icon: 'sd-region',
    ports: NO_PORTS,
    defaultParams: {
        code: 'eu-west-1',
        geo: 'europe',
        isPrimary: true,
        mirrorOf: '',
        dataResidency: 'none',
        availability: 0.9999,
        costMultiplier: 1,
    },
    paramSchema: {
        code: text('topology'),
        geo: choice('topology', ['north-america', 'south-america', 'europe', 'africa', 'asia', 'oceania']),
        isPrimary: bool('topology'),
        mirrorOf: text('topology'),
        dataResidency: choice('topology', ['none', 'gdpr', 'local-only']),
        availability: num('reliability', { min: 0.99, max: 0.999999, step: 0.0001 }),
        costMultiplier: num('cost', { min: 0.5, max: 3, step: 0.05 }),
    },
    helpId: 'region',
});

const az = defineComponent({
    id: 'az',
    group: 'topology',
    shape: 'container',
    wave: 'mvp',
    icon: 'sd-az',
    ports: NO_PORTS,
    defaultParams: {
        code: 'a',
        intraAzLatencyMs: 0.25,
        failureProbability: 0.0001,
    },
    paramSchema: {
        code: text('topology'),
        intraAzLatencyMs: num('performance', { unitKey: 'ms', min: 0.05, max: 5, step: 0.05 }),
        failureProbability: num('reliability', { min: 0, max: 0.1, step: 0.0001 }),
    },
    helpId: 'az',
});

const linkCrossAz = defineComponent({
    id: 'link-cross-az',
    group: 'topology',
    shape: 'link',
    wave: 'mvp',
    icon: 'sd-link',
    ports: NO_PORTS,
    defaultParams: {
        latencyMs: 1,
        bandwidthGbps: 25,
        costPerGb: 0.01,
    },
    paramSchema: {
        latencyMs: num('performance', { unitKey: 'ms', min: 0.1, max: 20, step: 0.1 }),
        bandwidthGbps: num('capacity', { min: 1, max: 400 }),
        costPerGb: num('cost', { unitKey: 'usd', min: 0, max: 1, step: 0.001 }),
    },
    helpId: 'link-cross-az',
});

const linkCrossRegion = defineComponent({
    id: 'link-cross-region',
    group: 'topology',
    shape: 'link',
    wave: 'mvp',
    icon: 'sd-link-region',
    ports: NO_PORTS,
    defaultParams: {
        latencyMs: 80,
        bandwidthGbps: 10,
        costPerGb: 0.02,
        encryption: true,
        dedicatedLink: false,
    },
    paramSchema: {
        latencyMs: num('performance', { unitKey: 'ms', min: 5, max: 400 }),
        bandwidthGbps: num('capacity', { min: 0.1, max: 200, step: 0.1 }),
        costPerGb: num('cost', { unitKey: 'usd', min: 0, max: 1, step: 0.001 }),
        encryption: bool('reliability'),
        dedicatedLink: bool('topology'),
    },
    helpId: 'link-cross-region',
});

const internet = defineComponent({
    id: 'internet',
    group: 'topology',
    shape: 'link',
    wave: 'mvp',
    icon: 'sd-internet',
    ports: NO_PORTS,
    defaultParams: {
        clientRttMs: 40,
        packetLoss: 0.001,
        tlsHandshakeRtt: 2,
    },
    paramSchema: {
        clientRttMs: num('performance', { unitKey: 'ms', min: 1, max: 500 }),
        packetLoss: num('reliability', { min: 0, max: 0.2, step: 0.001 }),
        tlsHandshakeRtt: num('performance', { min: 0, max: 4, step: 1 }),
    },
    helpId: 'internet',
});

const multiRegionPolicy = defineComponent({
    id: 'multi-region-policy',
    group: 'topology',
    shape: 'policy',
    wave: 'mvp',
    icon: 'sd-policy',
    ports: NO_PORTS,
    defaultParams: {
        mode: 'single',
        writeRegion: '',
        replicationDirection: 'one-way',
        conflictResolution: 'lww',
        failoverMode: 'manual',
        failbackPolicy: 'manual',
        dataResidency: 'none',
        rpoTargetSec: 60,
        rtoTargetSec: 900,
    },
    paramSchema: {
        mode: choice('topology', [
            'single',
            'active-passive',
            'active-active',
            'read-local-write-global',
            'sharded-by-geo',
        ]),
        writeRegion: text('topology'),
        replicationDirection: choice('topology', ['one-way', 'bidirectional']),
        conflictResolution: choice('consistency', [
            'lww',
            'vector-clock',
            'crdt',
            'single-writer-per-key',
            'manual',
        ]),
        failoverMode: choice('reliability', ['manual', 'auto']),
        failbackPolicy: choice('reliability', ['manual', 'auto']),
        dataResidency: choice('topology', ['none', 'strict']),
        rpoTargetSec: num('reliability', { unitKey: 'sec', min: 0, max: 86400 }),
        rtoTargetSec: num('reliability', { unitKey: 'sec', min: 0, max: 86400 }),
    },
    helpId: 'multi-region-policy',
});

export const topologyComponents: ComponentDefinition[] = [
    region,
    az,
    linkCrossAz,
    linkCrossRegion,
    internet,
    multiRegionPolicy,
] as unknown as ComponentDefinition[];
