import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { PRICING_PROFILES } from '../../src/engine/sim/constants';
import { backupCopies } from '../../src/engine/sim/derived';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 200;

function withStore(type: string) {
    return buildScheme({
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'svc', type: 'service' },
            { id: 'store', type },
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

    it('не попадают в счёт: это строка хранилища, а не стоимости', () => {
        const result = simulate(withStore('postgres'), { sampleCount: SAMPLES });
        const store = result.nodes.store;
        const storageGb = store.storage?.totalGb ?? 0;
        const perGb = Number(registry.getDefaultParams('postgres').costPerGbMonth);

        expect(store.backupGb).toBeGreaterThan(0);
        expect(store.cost.storage).toBeCloseTo(storageGb * perGb, 3);
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
