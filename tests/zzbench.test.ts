import { appendFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { beforeAll, describe, it } from 'vitest';
import registry from '../src/engine/ComponentRegistry';
import initComponents from '../src/engine/initComponents';
import { simulate } from '../src/engine/sim/simulate';
import { sampleGroups } from '../src/data/sampleSchemes';

beforeAll(() => {
    registry.reset();
    initComponents();
});

describe('bench', () => {
    it('measures', () => {
        writeFileSync('/tmp/sdf-bench.txt', '');

        const samples = sampleGroups().flatMap((group) => group.items);
        const heavy = samples.filter((item) => item.id.includes('video-platform') || item.id.includes('twitter'));

        for (const sample of heavy) {
            const scheme = sample.build();
            simulate(scheme, { sampleCount: 20000 });

            const started = performance.now();
            for (let run = 0; run < 5; run += 1) simulate(scheme, { sampleCount: 20000 });
            const elapsed = (performance.now() - started) / 5;

            appendFileSync('/tmp/sdf-bench.txt', `${sample.id}: ${elapsed.toFixed(1)} мс\n`);
        }
    }, 120_000);
});
