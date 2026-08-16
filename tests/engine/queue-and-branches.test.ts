import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { NodeSpec, LinkSpec } from '../helpers/scheme';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 500;

describe('async-ребро не участвует в балансировке', () => {
    it('публикация события не забирает половину пользовательских запросов', () => {
        const plain = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web' },
                    { id: 'svc', type: 'service' },
                ],
                links: [{ from: 'client', to: 'svc' }],
            }),
            { sampleCount: SAMPLES },
        );

        const withQueue = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web' },
                    { id: 'svc', type: 'service' },
                    { id: 'events', type: 'sns' },
                ],
                links: [
                    { from: 'client', to: 'svc' },
                    { from: 'client', to: 'events' },
                ],
            }),
            { sampleCount: SAMPLES },
        );

        expect(withQueue.nodes.svc.throughput).toBeCloseTo(plain.nodes.svc.throughput, 6);
        expect(withQueue.nodes.events.throughput).toBeCloseTo(plain.nodes.svc.throughput, 6);
    });
});

describe('нулевая ёмкость не даёт бесплатного прохода', () => {
    function gateway(messagesPerConnMin: number) {
        const result = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web', params: { dau: 30_000_000 } },
                    { id: 'ws', type: 'ws-gateway', params: { messagesPerConnMin } },
                ],
                links: [{ from: 'client', to: 'ws' }],
            }),
            { sampleCount: SAMPLES },
        );

        return { node: result.nodes.ws, findings: result.findings };
    }

    it('ёмкость 0 останавливает поток и даёт находку', () => {
        const dead = gateway(0);
        const alive = gateway(10);

        expect(dead.node.capacity).toBe(0);
        expect(dead.node.throughput).toBe(0);
        expect(dead.node.errorRate).toBe(1);
        expect(dead.findings.some((finding) => finding.code === 'overloaded')).toBe(true);

        expect(alive.node.throughput).toBeGreaterThan(0);
        expect(alive.node.errorRate).toBe(0);
    });
});

describe('обход задержки предупреждает об обрезке', () => {
    function chain(length: number) {
        const nodes: NodeSpec[] = [{ id: 'client', type: 'client-web' }];
        const links: LinkSpec[] = [];

        for (let index = 0; index < length; index += 1) {
            nodes.push({ id: `svc-${index}`, type: 'service' });
            links.push({ from: index === 0 ? 'client' : `svc-${index - 1}`, to: `svc-${index}` });
        }

        return simulate(buildScheme({ nodes, links }), { sampleCount: SAMPLES });
    }

    it('короткая цепочка считается целиком и молчит', () => {
        expect(chain(6).findings.some((finding) => finding.code === 'latency-truncated')).toBe(false);
    });

    it('длинная цепочка помечается находкой на обоих языках', () => {
        expect(chain(18).findings.some((finding) => finding.code === 'latency-truncated')).toBe(true);
        expect(ruCommon.findings).toHaveProperty('latency-truncated');
        expect(enCommon.findings).toHaveProperty('latency-truncated');
    });
});

describe('очередь без объявленного лимита', () => {
    function waitMs(dau: number): { wait: number; utilization: number } {
        const result = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web', params: { dau } },
                    { id: 'api', type: 'service', params: { instances: 200, autoscale: false } },
                    { id: 'cache', type: 'redis' },
                ],
                links: [
                    { from: 'client', to: 'api' },
                    { from: 'api', to: 'cache' },
                ],
            }),
            { sampleCount: SAMPLES },
        );

        return { wait: result.nodes.cache.waitSec * 1000, utilization: result.nodes.cache.utilization };
    }

    it('ожидание растёт вместе с утилизацией', () => {
        const light = waitMs(20_000_000);
        const heavy = waitMs(140_000_000);

        expect(heavy.utilization).toBeGreaterThan(light.utilization);
        expect(heavy.wait).toBeGreaterThan(light.wait * 3);
    });
});

describe('лаг очереди измеряется в секундах', () => {
    function lagOf(consumers: number): number {
        const result = simulate(
            buildScheme({
                nodes: [
                    { id: 'client', type: 'client-web', params: { dau: 20_000_000 } },
                    { id: 'api', type: 'service' },
                    { id: 'queue', type: 'kafka' },
                    { id: 'worker', type: 'worker', params: { instances: consumers, autoscale: false } },
                ],
                links: [
                    { from: 'client', to: 'api' },
                    { from: 'api', to: 'queue' },
                    { from: 'queue', to: 'worker' },
                ],
            }),
            { sampleCount: SAMPLES },
        );

        return result.edges['edge-2'].lagSec;
    }

    it('здоровый консьюмер держит лаг близко к нулю, задавленный копит секунды', () => {
        const healthy = lagOf(1000);
        const starved = lagOf(10);

        expect(healthy).toBeLessThan(1);
        expect(starved).toBeGreaterThan(30);
    });
});
