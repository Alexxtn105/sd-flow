import { appendFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, it } from 'vitest';
import registry from '../src/engine/ComponentRegistry';
import initComponents from '../src/engine/initComponents';
import { buildScheme } from './helpers/scheme';
import { simulate } from '../src/engine/sim/simulate';

beforeAll(() => {
    registry.reset();
    initComponents();
});

describe('scratch', () => {
    it('reproduces', () => {
        writeFileSync('/tmp/sdf-fix-report.txt', '');

        for (const consumers of [1, 10, 40, 100, 200, 400, 1000]) {
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
                { sampleCount: 200 },
            );

            appendFileSync(
                '/tmp/sdf-fix-report.txt',
                `инстансов ${consumers}: лаг ${result.edges['edge-2'].lagSec.toFixed(3)} с · util ${result.nodes.worker.utilization.toFixed(3)} · backlog ${result.edges['edge-2'].backlog.toFixed(1)}\n`,
            );
        }
    });
});
