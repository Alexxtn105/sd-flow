import { writeFileSync } from 'node:fs';
import { beforeAll, describe, it } from 'vitest';
import registry from '../src/engine/ComponentRegistry';
import initComponents from '../src/engine/initComponents';

beforeAll(() => {
    registry.reset();
    initComponents();
});

describe('diag', () => {
    it('кто не растёт от инстансов', () => {
        const lines: string[] = [];

        for (const definition of registry.list()) {
            const defaults = registry.getDefaultParams(definition.id);
            if (definition.shape !== 'node' || !definition.model || typeof defaults.instances !== 'number') continue;

            const capacity = (instances: number) =>
                definition.model!.capacity({
                    nodeId: 'node',
                    params: { ...defaults, instances },
                    instances,
                    lambda: 1000,
                    readShare: 0.8,
                    writeShare: 0.2,
                    requestBytes: 500,
                    responseBytes: 2000,
                    blockingSec: 0,
                });

            const single = capacity(1);
            const double = capacity(2);

            if (double.capacity <= single.capacity) {
                lines.push(`${definition.id}: ${single.capacity.toFixed(0)} (${single.boundBy}) → ${double.capacity.toFixed(0)} (${double.boundBy})`);
            }
        }

        writeFileSync('/tmp/sdf-diag.txt', `${lines.join('\n')}\n`);
    }, 600_000);
});
