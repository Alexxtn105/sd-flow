import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import enHelp from '../../src/locales/en/help.json';
import enHints from '../../src/locales/en/hints.json';
import ruHelp from '../../src/locales/ru/help.json';
import ruHints from '../../src/locales/ru/hints.json';

interface HelpEntry {
    summary: string;
    capacity: string;
    practices: string[];
    pitfalls: string[];
}

const HELP: Record<string, Record<string, HelpEntry>> = {
    ru: ruHelp as Record<string, HelpEntry>,
    en: enHelp as Record<string, HelpEntry>,
};

const HINTS: Record<string, Record<string, string>> = {
    ru: ruHints as Record<string, string>,
    en: enHints as Record<string, string>,
};

beforeAll(() => {
    registry.reset();
    initComponents();
});

function blockIds(): string[] {
    return [...new Set(registry.list().map((definition) => definition.helpId))];
}

function paramKeys(): string[] {
    const keys = new Set<string>();

    for (const definition of registry.list()) {
        for (const key of Object.keys(definition.paramSchema)) keys.add(key);
    }

    return [...keys];
}

describe('справка по блокам', () => {
    it('покрывает весь каталог на обоих языках', () => {
        for (const [language, dictionary] of Object.entries(HELP)) {
            expect(blockIds().filter((id) => !(id in dictionary)), `${language}: нет справки`).toEqual([]);
        }
    });

    it('не держит справку по несуществующим блокам', () => {
        const known = new Set(blockIds());

        for (const [language, dictionary] of Object.entries(HELP)) {
            expect(Object.keys(dictionary).filter((id) => !known.has(id)), `${language}: висячий ключ`).toEqual([]);
        }
    });

    it('заполняет все поля справки', () => {
        const broken: string[] = [];

        for (const [language, dictionary] of Object.entries(HELP)) {
            for (const [id, entry] of Object.entries(dictionary)) {
                if (!entry.summary?.trim()) broken.push(`${language}/${id}: summary`);
                if (!entry.capacity?.trim()) broken.push(`${language}/${id}: capacity`);
                if (!Array.isArray(entry.practices) || entry.practices.length < 2) {
                    broken.push(`${language}/${id}: practices`);
                }
                if (!Array.isArray(entry.pitfalls) || entry.pitfalls.length < 2) {
                    broken.push(`${language}/${id}: pitfalls`);
                }
                for (const item of [...(entry.practices ?? []), ...(entry.pitfalls ?? [])]) {
                    if (!item.trim()) broken.push(`${language}/${id}: пустой пункт`);
                }
            }
        }

        expect(broken).toEqual([]);
    });

    it('русская и английская справки совпадают по набору блоков', () => {
        expect(Object.keys(HELP.ru).sort()).toEqual(Object.keys(HELP.en).sort());
    });
});

describe('подсказки к параметрам', () => {
    it('покрывают все параметры каталога на обоих языках', () => {
        for (const [language, dictionary] of Object.entries(HINTS)) {
            expect(paramKeys().filter((key) => !(key in dictionary)), `${language}: нет подсказки`).toEqual([]);
        }
    });

    it('не держат подсказки к несуществующим параметрам', () => {
        const known = new Set(paramKeys());

        for (const [language, dictionary] of Object.entries(HINTS)) {
            expect(Object.keys(dictionary).filter((key) => !known.has(key)), `${language}: висячий ключ`).toEqual([]);
        }
    });

    it('не содержат пустых подсказок', () => {
        const empty: string[] = [];

        for (const [language, dictionary] of Object.entries(HINTS)) {
            for (const [key, value] of Object.entries(dictionary)) {
                if (typeof value !== 'string' || !value.trim()) empty.push(`${language}/${key}`);
            }
        }

        expect(empty).toEqual([]);
    });

    it('русские и английские подсказки совпадают по набору ключей', () => {
        expect(Object.keys(HINTS.ru).sort()).toEqual(Object.keys(HINTS.en).sort());
    });
});
