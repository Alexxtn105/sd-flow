import { buildScheme } from '../services/schemeBuilder';
import type { LocalizedText } from '../engine/challenges/types';
import type { SchemeV1 } from '../engine/types/scheme';

export interface DemoScheme {
    id: string;
    name: LocalizedText;
    build: () => SchemeV1;
}

function videoPlatform(): SchemeV1 {
    return buildScheme({
        id: 'demo-video',
        name: 'Видеоплатформа',
        nodes: [
            {
                id: 'viewers',
                type: 'client-web',
                position: { x: 0, y: 220 },
                params: {
                    dau: 1000000000,
                    sessionsPerUserDay: 2,
                    requestsPerSession: 33,
                    readWriteMix: 0.98,
                    avgRequestKb: 1,
                    avgResponseKb: 1700,
                    peakFactor: 2.5,
                },
            },
            {
                id: 'cdn',
                type: 'cdn',
                position: { x: 280, y: 60 },
                params: { avgObjectKb: 1700, popCount: 1400, cacheHitRatio: 0.95 },
            },
            {
                id: 'blobs',
                type: 's3',
                position: { x: 560, y: 60 },
                params: { prefixCount: 400, avgObjectSizeMb: 1.7, objectCount: 2000000000 },
            },
            {
                id: 'balancer',
                type: 'lb-l7',
                position: { x: 280, y: 360 },
                params: { instances: 8, networkMbps: 25000 },
            },
            { id: 'api', type: 'service', position: { x: 560, y: 360 }, params: { autoscaleMax: 200 } },
            { id: 'cache', type: 'redis', position: { x: 840, y: 260 }, params: { shards: 12, memoryGb: 64 } },
            {
                id: 'meta',
                type: 'postgres',
                position: { x: 840, y: 420 },
                params: { provisionedIops: 40000, readReplicas: 4, readFromReplica: 0.6, rowCount: 8000000000 },
            },
            { id: 'events', type: 'kafka', position: { x: 840, y: 580 } },
            {
                id: 'transcoder',
                type: 'worker',
                position: { x: 1120, y: 580 },
                params: { instances: 2000, concurrency: 4, processingTimeMs: 4000, cpuCores: 8 },
            },
        ],
        links: [
            { from: 'viewers', to: 'cdn', weight: 9, calls: { requestBytes: 1000, responseBytes: 1700000 } },
            { from: 'viewers', to: 'balancer', weight: 1, calls: { requestBytes: 2000, responseBytes: 20000 } },
            { from: 'cdn', to: 'blobs', readShare: 1, calls: { requestBytes: 1000, responseBytes: 1700000 } },
            { from: 'balancer', to: 'api', calls: { requestBytes: 2000, responseBytes: 20000 } },
            { from: 'api', to: 'cache' },
            { from: 'api', to: 'meta' },
            { from: 'api', to: 'events', calls: { fanout: 0.02 } },
            { from: 'events', to: 'transcoder' },
        ],
    });
}

function twoRegionPayments(): SchemeV1 {
    return buildScheme({
        id: 'demo-payments',
        name: 'Платежи в двух регионах',
        nodes: [
            {
                id: 'clients',
                type: 'client-mobile',
                position: { x: 0, y: 260 },
                params: {
                    dau: 5000000,
                    sessionsPerUserDay: 3,
                    requestsPerSession: 10,
                    readWriteMix: 0.5,
                    avgRequestKb: 2,
                    avgResponseKb: 4,
                },
            },
            {
                id: 'policy',
                type: 'multi-region-policy',
                position: { x: 260, y: 40 },
                params: {
                    mode: 'active-active',
                    replicationDirection: 'bidirectional',
                    conflictResolution: 'lww',
                    failoverMode: 'auto',
                    rpoTargetSec: 30,
                    rtoTargetSec: 300,
                },
            },
            { id: 'router', type: 'glb', position: { x: 260, y: 260 }, params: { routingPolicy: 'latency' } },
            {
                id: 'region-eu',
                type: 'region',
                position: { x: 540, y: 40 },
                size: { width: 540, height: 250 },
                params: { code: 'eu-west-1', geo: 'europe', isPrimary: true },
            },
            {
                id: 'region-us',
                type: 'region',
                position: { x: 540, y: 340 },
                size: { width: 540, height: 250 },
                params: { code: 'us-east-1', geo: 'north-america', isPrimary: false },
            },
            { id: 'svc-eu', type: 'service', parentId: 'region-eu', position: { x: 40, y: 80 } },
            {
                id: 'db-eu',
                type: 'postgres',
                parentId: 'region-eu',
                position: { x: 300, y: 80 },
                params: {
                    rowCount: 20000,
                    replicaLagMs: 400,
                    concurrencyControl: 'optimistic',
                    readFromReplica: 0.2,
                },
            },
            { id: 'svc-us', type: 'service', parentId: 'region-us', position: { x: 40, y: 80 } },
            {
                id: 'db-us',
                type: 'postgres',
                parentId: 'region-us',
                position: { x: 300, y: 80 },
                params: {
                    rowCount: 20000,
                    replicaLagMs: 400,
                    concurrencyControl: 'optimistic',
                    readFromReplica: 0.2,
                },
            },
        ],
        links: [
            { from: 'clients', to: 'router' },
            { from: 'router', to: 'svc-eu', weight: 1 },
            { from: 'router', to: 'svc-us', weight: 1 },
            { from: 'svc-eu', to: 'db-eu' },
            { from: 'svc-us', to: 'db-us' },
            { from: 'db-eu', to: 'db-us' },
        ],
    });
}

export const DEMO_SCHEMES: DemoScheme[] = [
    { id: 'video-platform', name: { ru: 'Видеоплатформа', en: 'Video platform' }, build: videoPlatform },
    {
        id: 'two-region-payments',
        name: { ru: 'Платежи в двух регионах', en: 'Two-region payments' },
        build: twoRegionPayments,
    },
];
