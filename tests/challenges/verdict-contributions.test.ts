import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import { topContributions } from '../../src/engine/challenges/predicates';
import { RUBRIC_AXES, RUBRIC_WEIGHTS } from '../../src/engine/challenges/rubric';
import { CHALLENGES } from '../../src/data/challenges';
import type { Challenge, RequirementEvaluation } from '../../src/engine/challenges/types';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

const SAMPLE_COUNT = 500;

beforeAll(() => {
    registry.reset();
    initComponents();
});

function reference(): { challenge: Challenge; requirements: RequirementEvaluation[] } {
    const challenge = CHALLENGES.find((item) => item.referenceSolutions.length > 0) as Challenge;
    const verdict = acceptChallenge({
        challenge,
        scheme: challenge.referenceSolutions[0].build(),
        attempt: 1,
        hintsUsed: [],
        sampleCount: SAMPLE_COUNT,
    });

    return { challenge, requirements: [...verdict.requirements, ...verdict.bonusObjectives] };
}

describe('вклад узлов в вердикт', () => {
    it('раскладывает задержку по хопам', () => {
        const { requirements } = reference();
        const latency = requirements.find(
            (item) => item.kind === 'slo' && item.unit === 'ms' && item.contributions.length > 0,
        );

        expect(latency).toBeDefined();
        expect(latency?.contributions.length).toBeLessThanOrEqual(3);

        const shares = latency?.contributions.map((part) => part.share) ?? [];
        expect(shares.every((share) => share > 0 && share <= 1)).toBe(true);
        expect([...shares].sort((left, right) => right - left)).toEqual(shares);
        expect(latency?.contributions[0].value).toBeGreaterThan(0);
    });

    it('раскладывает бюджет по самым дорогим блокам', () => {
        const { requirements } = reference();
        const budget = requirements.find((item) => item.kind === 'budget');

        if (!budget) return;

        expect(budget.contributions.length).toBeGreaterThan(0);
        expect(budget.contributions.reduce((sum, part) => sum + part.share, 0)).toBeLessThanOrEqual(1.000001);
    });

    it('у требований без чисел вклада нет', () => {
        const { requirements } = reference();

        for (const requirement of requirements) {
            if (requirement.actual === null) expect(requirement.contributions).toEqual([]);
        }
    });

    it('вклад считается долей от суммы, а не от максимума', () => {
        const parts = topContributions([
            { nodeId: 'a', value: 30 },
            { nodeId: 'b', value: 10 },
            { nodeId: 'c', value: 60 },
        ]);

        expect(parts.map((part) => part.nodeId)).toEqual(['c', 'a', 'b']);
        expect(parts.map((part) => part.share)).toEqual([0.6, 0.3, 0.1]);
    });

    it('нулевые и отрицательные вклады выбрасываются, список ограничен', () => {
        const parts = topContributions([
            { nodeId: 'a', value: 0 },
            { nodeId: 'b', value: -5 },
            { nodeId: 'c', value: 1 },
            { nodeId: 'd', value: 2 },
            { nodeId: 'e', value: 3 },
            { nodeId: 'f', value: 4 },
        ]);

        expect(parts.map((part) => part.nodeId)).toEqual(['f', 'e', 'd']);
        expect(topContributions([{ nodeId: 'a', value: 0 }])).toEqual([]);
    });

    it('вклад выводится строкой, переведённой на оба языка', () => {
        expect(ruCommon.challenge).toHaveProperty('contribution');
        expect(enCommon.challenge).toHaveProperty('contribution');
    });
});

describe('рубрика до сдачи', () => {
    it('перечисляет семь осей с весами, дающими сотню', () => {
        expect(RUBRIC_AXES).toHaveLength(7);
        expect(RUBRIC_AXES.reduce((sum, axis) => sum + RUBRIC_WEIGHTS[axis], 0)).toBe(100);
    });

    it('у каждой оси есть имя и пояснение на обоих языках', () => {
        for (const axis of RUBRIC_AXES) {
            expect(ruCommon.challenge.axis, `ru: axis.${axis}`).toHaveProperty(axis);
            expect(enCommon.challenge.axis, `en: axis.${axis}`).toHaveProperty(axis);
            expect(ruCommon.challenge.axisHint, `ru: axisHint.${axis}`).toHaveProperty(axis);
            expect(enCommon.challenge.axisHint, `en: axisHint.${axis}`).toHaveProperty(axis);
        }
    });

    it('секция «что оценивается» и её пояснения переведены', () => {
        expect(ruCommon.challenge.section).toHaveProperty('scoring');
        expect(enCommon.challenge.section).toHaveProperty('scoring');
        expect(ruCommon.challenge).toHaveProperty('scoringIntro');
        expect(enCommon.challenge).toHaveProperty('scoringPenalties');
    });
});
