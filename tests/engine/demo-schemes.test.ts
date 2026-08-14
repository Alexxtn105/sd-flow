import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { DEMO_SCHEMES } from '../../src/data/demoSchemes';
import { simulate } from '../../src/engine/sim/simulate';

beforeAll(() => {
    registry.reset();
    initComponents();
});

function demo(id: string) {
    const found = DEMO_SCHEMES.find((item) => item.id === id);
    if (!found) throw new Error(`Нет демо-схемы ${id}`);
    return found.build();
}

describe('демо-схема «Видеоплатформа»', () => {
    it('даёт правдоподобные петабайты в сутки и терабиты в секунду', () => {
        const result = simulate(demo('video-platform'), { sampleCount: 4000 });

        const petabytesPerDay = result.totals.egressGbDay / 1e6;
        expect(petabytesPerDay).toBeGreaterThan(80);
        expect(petabytesPerDay).toBeLessThan(130);

        expect(result.totals.networkGbps).toBeGreaterThan(8000);
        expect(result.totals.networkGbps).toBeLessThan(30000);
    });

    it('наполнение CDN из origin тоже оплачивается как egress', () => {
        const result = simulate(demo('video-platform'), { sampleCount: 2000 });

        const cdnPbDay = result.nodes.cdn.egressGbDay / 1e6;
        const originPbDay = result.nodes.blobs.egressGbDay / 1e6;

        expect(cdnPbDay).toBeGreaterThan(95);
        expect(originPbDay / cdnPbDay).toBeCloseTo(0.05, 2);
        expect(result.nodes.blobs.cost.network).toBeGreaterThan(0);
    });

    it('считается на порядок быстрее секунды на полном числе сэмплов', () => {
        const scheme = demo('video-platform');
        simulate(scheme, { sampleCount: 20000 });

        const started = performance.now();
        simulate(scheme, { sampleCount: 20000 });
        const elapsed = performance.now() - started;

        expect(elapsed).toBeLessThan(250);
    });

    it('CDN поглощает основную часть запросов до origin', () => {
        const result = simulate(demo('video-platform'), { sampleCount: 2000 });

        const cdnEdge = Object.values(result.edges).find((edge) => edge.edgeId === 'edge-0');
        const originEdge = Object.values(result.edges).find((edge) => edge.edgeId === 'edge-2');

        expect(cdnEdge).toBeDefined();
        expect(originEdge).toBeDefined();
        expect(originEdge!.rps).toBeLessThan(cdnEdge!.rps * 0.15);
    });

    it('каждый нагруженный узел имеет названный ограничитель ёмкости', () => {
        const result = simulate(demo('video-platform'), { sampleCount: 2000 });

        for (const node of Object.values(result.nodes)) {
            if (node.lambdaOffered <= 0) continue;
            expect(node.boundBy).not.toBe('unmodelled');
        }
    });
});

describe('демо-схема «Платежи в двух регионах»', () => {
    it('показывает ненулевую частоту конфликтов записи при active-active и LWW', () => {
        const result = simulate(demo('two-region-payments'), { sampleCount: 2000 });

        const conflicts = result.consistency.anomalies.filter((item) => item.code === 'write-conflict');
        const lost = result.consistency.anomalies.filter((item) => item.code === 'lost-write-lww');

        expect(conflicts.length).toBeGreaterThan(0);
        expect(conflicts[0].ratePerSec).toBeGreaterThan(0);
        expect(lost[0].ratePerSec).toBeCloseTo(conflicts[0].ratePerSec * 0.5, 6);
    });

    it('обнуляет конфликты после включения single-writer-per-key', () => {
        const scheme = demo('two-region-payments');
        const policy = scheme.nodes.find((node) => node.type === 'multi-region-policy');
        if (!policy) throw new Error('В схеме нет политики мультирегиона');

        policy.params.conflictResolution = 'single-writer-per-key';

        const result = simulate(scheme, { sampleCount: 2000 });
        const conflicts = result.consistency.anomalies.filter((item) => item.code === 'write-conflict');

        expect(conflicts).toHaveLength(0);
    });

    it('раскладывает трафик по двум регионам и считает RPO и RTO', () => {
        const result = simulate(demo('two-region-payments'), { sampleCount: 2000 });

        expect(result.multiRegion).not.toBeNull();
        expect(result.multiRegion!.regions).toHaveLength(2);
        expect(result.multiRegion!.mode).toBe('active-active');
        expect(result.multiRegion!.rpoSec).toBeGreaterThan(0);
        expect(result.multiRegion!.rtoSec).toBeGreaterThan(0);

        for (const region of result.multiRegion!.regions) {
            expect(region.rps).toBeGreaterThan(0);
        }
    });

    it('сценарий region-failure выключает узлы одного региона', () => {
        const baseline = simulate(demo('two-region-payments'), { sampleCount: 1000, scenario: 'baseline' });
        const failure = simulate(demo('two-region-payments'), { sampleCount: 1000, scenario: 'region-failure' });

        expect(baseline.nodes['svc-eu'].throughput).toBeGreaterThan(0);
        expect(failure.nodes['svc-eu'].throughput).toBe(0);
        expect(failure.nodes['svc-us'].throughput).toBeGreaterThan(0);
    });
});
