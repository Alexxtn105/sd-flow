import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { CHALLENGES } from '../../src/data/challenges';
import { DEMO_SCHEMES } from '../../src/data/demoSchemes';
import { sampleById, sampleGroups } from '../../src/data/sampleSchemes';

beforeAll(() => {
    registry.reset();
    initComponents();
});

describe('список готовых схем', () => {
    const groups = sampleGroups();

    it('начинается с демо-схем, дальше идут задания', () => {
        expect(groups[0].items.map((item) => item.id)).toEqual(DEMO_SCHEMES.map((demo) => `demo:${demo.id}`));
        expect(groups[0].level).toBeNull();
        expect(groups.slice(1).every((group) => group.level !== null)).toBe(true);
    });

    it('содержит все эталонные решения каталога', () => {
        const expected = CHALLENGES.flatMap((challenge) =>
            challenge.referenceSolutions.map((solution) => `reference:${challenge.id}:${solution.id}`),
        );

        const listed = groups.slice(1).flatMap((group) => group.items.map((item) => item.id));

        expect(listed.slice().sort()).toEqual(expected.slice().sort());
        expect(listed.length).toBeGreaterThan(CHALLENGES.length);
    });

    it('идёт по возрастанию уровня и не содержит пустых групп', () => {
        const levels = groups.slice(1).map((group) => group.level ?? 0);

        expect(levels).toEqual(levels.slice().sort((left, right) => left - right));
        expect(groups.every((group) => group.items.length > 0)).toBe(true);
    });

    it('даёт уникальные идентификаторы и находит каждый по нему', () => {
        const ids = groups.flatMap((group) => group.items.map((item) => item.id));

        expect(new Set(ids).size).toBe(ids.length);

        for (const id of ids) {
            expect(sampleById(id), id).toBeDefined();
        }

        expect(sampleById('reference:url-shortener:нет-такого')).toBeUndefined();
    });

    it('называет схему задания парой «задание · решение» на обоих языках', () => {
        const sample = sampleById('reference:url-shortener:cache-and-sql');

        expect(sample?.name).toEqual({
            ru: 'Кэш перед реляционной базой',
            en: 'Cache in front of a relational database',
        });
        expect(sample?.schemeName.ru).toBe('Сократитель ссылок · Кэш перед реляционной базой');
        expect(sample?.schemeName.en).toBe('URL shortener · Cache in front of a relational database');
    });

    it('каждая схема собирается и содержит блоки и связи', () => {
        for (const group of groups) {
            for (const item of group.items) {
                const scheme = item.build();

                expect(scheme.nodes.length, item.id).toBeGreaterThan(0);
                expect(scheme.edges.length, item.id).toBeGreaterThan(0);
            }
        }
    });
});
