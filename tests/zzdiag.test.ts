import { appendFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, it } from 'vitest';
import registry from '../src/engine/ComponentRegistry';
import initComponents from '../src/engine/initComponents';
import { simulate } from '../src/engine/sim/simulate';
import { sampleGroups } from '../src/data/sampleSchemes';
import type { SchemeV1 } from '../src/engine/types/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

function doubled(scheme: SchemeV1): SchemeV1 {
    return {
        ...scheme,
        nodes: scheme.nodes.map((node) => {
            const dau = node.params.dau;
            const rps = node.params.rps;
            if (typeof dau === 'number') return { ...node, params: { ...node.params, dau: dau * 2 } };
            if (typeof rps === 'number') return { ...node, params: { ...node.params, rps: rps * 2 } };

            return node;
        }),
    };
}

describe('diag', () => {
    it('S-1 монотонность', () => {
        writeFileSync('/tmp/sdf-diag.txt', '');
        let breaches = 0;

        for (const group of sampleGroups()) {
            for (const sample of group.items) {
                const base = simulate(sample.build(), { sampleCount: 100 });
                const heavy = simulate(doubled(sample.build()), { sampleCount: 100 });

                for (const [id, node] of Object.entries(base.nodes)) {
                    const other = heavy.nodes[id];
                    if (!other) continue;
                    if (other.throughput + 1e-6 < node.throughput * 0.999) {
                        breaches += 1;
                        appendFileSync(
                            '/tmp/sdf-diag.txt',
                            `${sample.id}/${id}: поток ${node.throughput.toFixed(2)} → ${other.throughput.toFixed(2)} · hit ${(node.hitRatio ?? -1).toFixed(3)} → ${(other.hitRatio ?? -1).toFixed(3)} · util ${node.utilization.toFixed(4)} → ${other.utilization.toFixed(4)}\n`,
                        );
                    }
                }
            }
        }

        appendFileSync('/tmp/sdf-diag.txt', `нарушений монотонности: ${breaches}\n`);
    }, 600_000);
});
