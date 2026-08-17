import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { DAYS_PER_MONTH, FREE_IOPS, PRICING_PROFILES, pricingFor } from '../../src/engine/sim/constants';
import { backupCopies } from '../../src/engine/sim/derived';
import { billableIops } from '../../src/engine/sim/provisioned';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { ComponentParams } from '../../src/engine/types/component';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;

function withStore(type: string, params?: ComponentParams) {
    return buildScheme({
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'svc', type: 'service' },
            { id: 'store', type, ...(params ? { params } : {}) },
        ],
        links: [
            { from: 'client', to: 'svc' },
            { from: 'svc', to: 'store' },
        ],
    });
}

describe('бэкапы', () => {
    it('считаются от объёма хранилища по политике §8.5', () => {
        const result = simulate(withStore('postgres'), { sampleCount: SAMPLES });
        const store = result.nodes.store;

        expect(store.storage).not.toBeNull();
        expect(store.backupGb).toBeCloseTo((store.storage?.totalGb ?? 0) * backupCopies(), 6);
        expect(result.totals.backupGb).toBeCloseTo(store.backupGb, 6);
    });

    it('не начисляются блокам без долговременных данных', () => {
        const result = simulate(withStore('redis'), { sampleCount: SAMPLES });

        expect(result.nodes.store.backupGb).toBe(0);
        expect(result.nodes.svc.backupGb).toBe(0);
    });

    it('оплачиваются по ставке профиля цен, сверх объёма и выделенных IOPS', () => {
        const result = simulate(withStore('postgres'), { sampleCount: SAMPLES });
        const store = result.nodes.store;
        const defaults = registry.getDefaultParams('postgres');
        const pricing = pricingFor('aws-2026-q2');
        const storageGb = store.storage?.totalGb ?? 0;
        const perGb = Number(defaults.costPerGbMonth);
        const iops = (Number(defaults.provisionedIops) - FREE_IOPS) * pricing.iopsPerMonth;
        const backups = store.backupGb * pricing.backupPerGbMonth;

        expect(backups).toBeGreaterThan(0);
        expect(store.cost.storage).toBeCloseTo(storageGb * perGb + iops + backups, 3);
    });
});

describe('логи и ключи идемпотентности', () => {
    it('логи оплачиваются по ставке профиля, если своего сборщика в схеме нет', () => {
        const result = simulate(withStore('postgres'), { sampleCount: SAMPLES });
        const service = result.nodes.svc;
        const pricing = pricingFor('aws-2026-q2');

        expect(service.logsGbDay).toBeGreaterThan(0);
        expect(service.cost.storage).toBeCloseTo(service.logsGbDay * DAYS_PER_MONTH * pricing.logsPerGbMonth, 3);
    });

    it('нарисованный сборщик забирает плату за логи себе', () => {
        const collected = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web' },
                    { id: 'svc', type: 'service' },
                    { id: 'store', type: 'postgres' },
                    { id: 'logs', type: 'logs' },
                ],
                links: [
                    { from: 'client', to: 'svc' },
                    { from: 'svc', to: 'store' },
                    { from: 'svc', to: 'logs' },
                ],
            }),
            { sampleCount: SAMPLES },
        );

        expect(collected.nodes.svc.logsGbDay).toBeGreaterThan(0);
        expect(collected.nodes.svc.cost.storage).toBe(0);
        expect(collected.nodes.logs.cost.total).toBeGreaterThan(0);
    });

    it('ключи идемпотентности оплачивает тот, кто их хранит', () => {
        const result = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web' },
                    { id: 'svc', type: 'service', params: { logLinesPerRequest: 0 } },
                    { id: 'gateway', type: 'payment-external' },
                ],
                links: [
                    { from: 'client', to: 'svc' },
                    { from: 'svc', to: 'gateway', readShare: 0 },
                ],
            }),
            { sampleCount: SAMPLES },
        );
        const pricing = pricingFor('aws-2026-q2');
        const caller = result.nodes.svc;

        expect(caller.idempotencyGb).toBeGreaterThan(0);
        expect(caller.cost.storage).toBeCloseTo(caller.idempotencyGb * pricing.keyStatePerGbMonth, 3);
        expect(result.nodes.gateway.idempotencyGb).toBe(0);
    });
});

describe('выделенные IOPS', () => {
    it('оплачиваются сверх объёма, с бесплатным порогом', () => {
        const rate = pricingFor('aws-2026-q2').iopsPerMonth;
        const declared = Number(registry.getDefaultParams('postgres').provisionedIops);

        const base = simulate(withStore('postgres'), { sampleCount: SAMPLES }).nodes.store;
        const doubled = simulate(withStore('postgres', { provisionedIops: declared * 2 }), {
            sampleCount: SAMPLES,
        }).nodes.store;

        expect(doubled.cost.storage - base.cost.storage).toBeCloseTo(declared * rate, 3);
        expect(billableIops({ provisionedIops: declared })).toBe(declared - FREE_IOPS);
    });

    it('первые IOPS бесплатны, как у gp3', () => {
        expect(billableIops({ provisionedIops: FREE_IOPS })).toBe(0);
        expect(billableIops({ provisionedIops: FREE_IOPS - 1000 })).toBe(0);
        expect(billableIops({ provisionedIops: FREE_IOPS + 1000 })).toBe(1000);
        expect(billableIops({})).toBe(0);
    });

    it('не начисляются блоку, который их не объявляет', () => {
        const result = simulate(withStore('redis'), { sampleCount: SAMPLES });

        expect(registry.getDefaultParams('redis').provisionedIops).toBeUndefined();
        expect(result.nodes.store.cost.storage).toBe(0);
    });
});

describe('премия за управляемый сервис', () => {
    it('масштабирует счёт управляемого блока по профилю цен', () => {
        const build = (pricingProfile: string) =>
            simulate(
                buildScheme({
                    nodes: [
                        { id: 'client', type: 'client-web' },
                        { id: 'svc', type: 'service' },
                        { id: 'store', type: 'dynamodb' },
                    ],
                    links: [
                        { from: 'client', to: 'svc' },
                        { from: 'svc', to: 'store' },
                    ],
                    settings: { pricingProfile },
                }),
                { sampleCount: SAMPLES },
            );

        const aws = build('aws-2026-q2');
        const hetzner = build('hetzner-2026-q2');
        const multiplier = PRICING_PROFILES['hetzner-2026-q2'].managedMultiplier;

        expect(registry.get('dynamodb')?.managed).toBe(true);
        expect(hetzner.nodes.store.cost.compute).toBeCloseTo(aws.nodes.store.cost.compute * multiplier, 6);
        expect(hetzner.nodes.store.cost.requests).toBeCloseTo(aws.nodes.store.cost.requests * multiplier, 6);
    });

    it('не трогает блок, который держат сами', () => {
        const build = (pricingProfile: string) =>
            simulate(
                buildScheme({
                    nodes: [
                        { id: 'client', type: 'client-web' },
                        { id: 'svc', type: 'service' },
                        { id: 'store', type: 'postgres' },
                    ],
                    links: [
                        { from: 'client', to: 'svc' },
                        { from: 'svc', to: 'store' },
                    ],
                    settings: { pricingProfile },
                }),
                { sampleCount: SAMPLES },
            );

        const aws = build('aws-2026-q2');
        const hetzner = build('hetzner-2026-q2');

        expect(registry.get('postgres')?.managed).toBeUndefined();
        expect(hetzner.nodes.store.cost.compute).toBeCloseTo(aws.nodes.store.cost.compute, 6);
    });
});
