import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { costDrivers } from '../../src/engine/sim/costDrivers';
import { groupParams, SECTION_ORDER } from '../../src/utils/paramSections';
import type { ParamField } from '../../src/engine/types/component';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const schema: Record<string, ParamField> = {
    instances: { kind: 'number', section: 'scale', min: 1, max: 10 },
    serviceTimeMs: { kind: 'number', section: 'performance', min: 1, max: 100 },
    costPerInstanceHour: { kind: 'number', section: 'cost', min: 0, max: 10 },
};

describe('раскладка параметров по секциям', () => {
    it('идёт в объявленном порядке секций', () => {
        const sections = groupParams(
            { costPerInstanceHour: 0.12, serviceTimeMs: 3, instances: 2 },
            schema,
        ).map((group) => group.section);

        expect(sections).toEqual(['scale', 'performance', 'cost']);
        expect(SECTION_ORDER.indexOf('scale')).toBeLessThan(SECTION_ORDER.indexOf('cost'));
    });

    it('не показывает параметр, которого у блока нет', () => {
        const entries = groupParams({ instances: 2, autoscale: false }, schema).flatMap(
            (group) => group.entries,
        );

        expect(entries.map((entry) => entry.key)).toEqual(['instances']);
    });

    it('у каждого показанного параметра есть схема, значит есть подсказка и контрол', () => {
        for (const definition of registry.list()) {
            const entries = groupParams(registry.getDefaultParams(definition.id), definition.paramSchema);

            for (const group of entries) {
                for (const entry of group.entries) {
                    expect(entry.field.section).toBe(group.section);
                }
            }
        }
    });
});

describe('платящие параметры API-шлюза', () => {
    it('включают число инстансов и оба ценника', () => {
        const gateway = registry.get('api-gateway');
        if (!gateway) throw new Error('нет блока api-gateway');

        const drivers = costDrivers(gateway).map((driver) => driver.param);

        expect(drivers).toContain('instances');
        expect(drivers).toContain('costPerInstanceHour');
        expect(drivers).toContain('costPerMillionRequests');
    });

    it('число инстансов попадает в статью вычислений', () => {
        const gateway = registry.get('api-gateway');
        if (!gateway) throw new Error('нет блока api-gateway');

        const instances = costDrivers(gateway).find((driver) => driver.param === 'instances');

        expect(instances?.articles).toEqual(['compute']);
    });
});
