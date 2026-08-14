import { writeFileSync } from 'node:fs';
import { beforeAll, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { canConnectTypes } from '../../src/engine/ports';

beforeAll(() => {
    registry.reset();
    initComponents();
});

it('dump', () => {
    const all = registry.list();
    const lines: string[] = [];
    for (const def of all) {
        lines.push(`${def.id} [${def.group}] shape=${def.shape} managed=${def.managed ?? false}`);
        const targets = all.filter((other) => canConnectTypes(def.id, other.id)).map((other) => other.id);
        lines.push(`   -> ${targets.join(', ')}`);
    }
    for (const def of all) {
        const parts: string[] = [];
        for (const [key, field] of Object.entries(def.paramSchema)) {
            if (field.kind !== 'number') continue;
            if (!field.realistic) continue;
            parts.push(`${key}=[${field.realistic.min}..${field.realistic.max}]`);
        }
        lines.push(`RANGE ${def.id}: ${parts.join(' ')}`);
    }
    writeFileSync('/tmp/sdflow-dump.txt', lines.join('\n'));
});
