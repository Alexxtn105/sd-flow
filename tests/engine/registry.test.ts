import { beforeEach, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import { defineComponent, num } from '../../src/engine/components/_shared/params';
import type { ComponentDefinition } from '../../src/engine/types/component';

const sample = defineComponent({
    id: 'test-block',
    group: 'compute',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-service',
    ports: { in: [{ id: 'in', protocols: ['http'], role: 'serve' }], out: [] },
    defaultParams: { instances: 2 },
    paramSchema: { instances: num('scale') },
    helpId: 'test-block',
}) as unknown as ComponentDefinition;

describe('ComponentRegistry', () => {
    beforeEach(() => {
        registry.reset();
    });

    it('регистрирует блок и отдаёт копию параметров по умолчанию', () => {
        registry.register(sample);

        const params = registry.getDefaultParams('test-block');
        params.instances = 99;

        expect(registry.has('test-block')).toBe(true);
        expect(registry.getDefaultParams('test-block').instances).toBe(2);
    });

    it('запрещает повторную регистрацию одного id', () => {
        registry.register(sample);
        expect(() => registry.register(sample)).toThrow(/уже зарегистрирован/);
    });

    it('отклоняет параметр без описания в paramSchema', () => {
        const broken = { ...sample, defaultParams: { instances: 2, ghost: 1 } } as ComponentDefinition;
        expect(() => registry.register(broken)).toThrow(/ghost/);
    });

    it('отклоняет описание несуществующего параметра', () => {
        const broken = {
            ...sample,
            paramSchema: { instances: num('scale'), phantom: num('scale') },
        } as unknown as ComponentDefinition;
        expect(() => registry.register(broken)).toThrow(/phantom/);
    });

    it('после freeze регистрация невозможна', () => {
        registry.register(sample);
        registry.freeze();

        expect(registry.isFrozen()).toBe(true);
        expect(() => registry.register({ ...sample, id: 'another' })).toThrow(/заморожен/);
        expect(() => registry.registerGroup('sql')).toThrow(/заморожен/);
    });

    it('группы сохраняют порядок регистрации', () => {
        registry.registerGroup('clients');
        registry.registerGroup('compute');
        registry.register(sample);

        expect(registry.getGroupIds()).toEqual(['clients', 'compute']);
        expect(registry.getGroups()[1].components.map((component) => component.id)).toEqual(['test-block']);
    });
});
