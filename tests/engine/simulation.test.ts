import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 2000;

describe('стационарный решатель', () => {
    it('считает нагрузку от клиента до базы и находит ограничитель', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'svc', type: 'service' },
                { id: 'db', type: 'postgres' },
            ],
            links: [
                { from: 'client', to: 'svc' },
                { from: 'svc', to: 'db' },
            ],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });

        const expectedRps = (2000000 * 3 * 40) / 86400;
        expect(result.totals.rps).toBeCloseTo(expectedRps, 1);

        const service = result.nodes.svc;
        expect(service.lambdaNominal).toBeCloseTo(expectedRps, 1);
        expect(service.boundBy).toBe('cpu');
        expect(service.utilization).toBeGreaterThan(0);
        expect(service.utilization).toBeLessThan(1);

        const database = result.nodes.db;
        expect(database.lambdaNominal).toBeCloseTo(expectedRps, 1);
        expect(database.boundBy).toBe('iops');

        expect(result.converged).toBe(true);
        expect(result.flows).toHaveLength(1);
        expect(result.flows[0].latency.p99).toBeGreaterThan(result.flows[0].latency.p50);
    });

    it('детерминирован при одинаковой схеме', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'svc', type: 'service' },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const first = simulate(scheme, { sampleCount: SAMPLES });
        const second = simulate(scheme, { sampleCount: SAMPLES });

        expect(first.flows[0].latency.p99).toBe(second.flows[0].latency.p99);
        expect(first.seed).toBe(second.seed);
    });

    it('автоскейлинг добавляет инстансы под нагрузку', () => {
        const light = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 100000 } },
                { id: 'svc', type: 'service' },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const heavy = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 20000000 } },
                { id: 'svc', type: 'service' },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const lightResult = simulate(light, { sampleCount: SAMPLES });
        const heavyResult = simulate(heavy, { sampleCount: SAMPLES });

        expect(lightResult.nodes.svc.instances).toBe(3);
        expect(heavyResult.nodes.svc.instances).toBeGreaterThan(lightResult.nodes.svc.instances);
    });

    it('перегруженный узел сбрасывает нагрузку и попадает в findings', () => {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web', params: { dau: 50000000 } },
                { id: 'svc', type: 'service', params: { autoscale: false, instances: 1 } },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const result = simulate(scheme, { sampleCount: SAMPLES });
        const service = result.nodes.svc;

        expect(service.utilization).toBeGreaterThan(1);
        expect(service.throughput).toBeLessThan(service.lambdaOffered);
        expect(result.findings.some((finding) => finding.code === 'overloaded')).toBe(true);
    });
});
