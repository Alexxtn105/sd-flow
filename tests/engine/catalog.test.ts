import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import type { Wave } from '../../src/engine/types/component';
import ruBlocks from '../../src/locales/ru/blocks.json';
import enBlocks from '../../src/locales/en/blocks.json';
import ruGroups from '../../src/locales/ru/groups.json';
import enGroups from '../../src/locales/en/groups.json';
import ruParams from '../../src/locales/ru/params.json';
import enParams from '../../src/locales/en/params.json';

const EXPECTED_SHIPPED_COUNT = 109;

const SHIPPED_WAVES = new Set<Wave>(['mvp', 'v1']);

const EXPECTED_PER_GROUP: Record<string, number> = {
    clients: 7,
    edge: 11,
    compute: 11,
    sql: 5,
    nosql: 10,
    search: 4,
    olap: 5,
    cache: 3,
    messaging: 11,
    storage: 5,
    platform: 13,
    observability: 5,
    topology: 8,
    probes: 11,
};

beforeAll(() => {
    initComponents();
});

describe('каталог блоков', () => {
    it('содержит ровно 109 блоков волн MVP и V1', () => {
        expect(registry.size()).toBe(EXPECTED_SHIPPED_COUNT);
        expect(registry.list().every((component) => SHIPPED_WAVES.has(component.wave))).toBe(true);
    });

    it('раскладка по группам совпадает с docs/01-components.md §15', () => {
        const actual = Object.fromEntries(
            registry.getGroups().map((group) => [group.id, group.components.length]),
        );
        expect(actual).toEqual(EXPECTED_PER_GROUP);
    });

    it('порядок групп в палитре повторяет порядок документа', () => {
        expect(registry.getGroupIds()).toEqual(Object.keys(EXPECTED_PER_GROUP));
    });

    it('каждый блок описан консистентно', () => {
        for (const component of registry.list()) {
            expect(component.icon.startsWith('sd-'), `${component.id}: иконка ${component.icon}`).toBe(true);
            expect(component.helpId, `${component.id}: helpId`).toBe(component.id);
            expect(Object.keys(component.defaultParams).length, `${component.id}: параметры`).toBeGreaterThan(0);
            expect(Object.keys(component.paramSchema).sort()).toEqual(Object.keys(component.defaultParams).sort());
        }
    });

    it('значение перечислимого параметра по умолчанию входит в список вариантов', () => {
        for (const component of registry.list()) {
            for (const [key, field] of Object.entries(component.paramSchema)) {
                if (field.kind !== 'enum') continue;
                expect(field.options, `${component.id}.${key}`).toContain(String(component.defaultParams[key]));
            }
        }
    });

    it('числовой параметр по умолчанию попадает в свои границы', () => {
        for (const component of registry.list()) {
            for (const [key, field] of Object.entries(component.paramSchema)) {
                if (field.kind !== 'number') continue;
                const value = Number(component.defaultParams[key]);
                if (field.min !== undefined) expect(value, `${component.id}.${key} min`).toBeGreaterThanOrEqual(field.min);
                if (field.max !== undefined) expect(value, `${component.id}.${key} max`).toBeLessThanOrEqual(field.max);
            }
        }
    });

    it('блоки-узлы имеют хотя бы один порт', () => {
        for (const component of registry.list()) {
            if (component.shape === 'container' || component.shape === 'link' || component.shape === 'policy') continue;
            expect(component.ports.in.length + component.ports.out.length, `${component.id}: порты`).toBeGreaterThan(0);
        }
    });
});

describe('локализация каталога', () => {
    it('все блоки и группы переведены на оба языка', () => {
        for (const component of registry.list()) {
            expect(ruBlocks, `ru: ${component.id}`).toHaveProperty(component.id);
            expect(enBlocks, `en: ${component.id}`).toHaveProperty(component.id);
        }
        for (const group of registry.getGroupIds()) {
            expect(ruGroups, `ru: ${group}`).toHaveProperty(group);
            expect(enGroups, `en: ${group}`).toHaveProperty(group);
        }
    });

    it('все ключи параметров переведены на оба языка', () => {
        const missingRu: string[] = [];
        const missingEn: string[] = [];

        for (const component of registry.list()) {
            for (const key of Object.keys(component.defaultParams)) {
                if (!(key in ruParams)) missingRu.push(`${component.id}.${key}`);
                if (!(key in enParams)) missingEn.push(`${component.id}.${key}`);
            }
        }

        expect(missingRu).toEqual([]);
        expect(missingEn).toEqual([]);
    });
});
