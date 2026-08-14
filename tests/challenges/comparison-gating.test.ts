import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { CHALLENGES } from '../../src/data/challenges';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import type { Challenge } from '../../src/engine/challenges/types';
import type { SchemeV1 } from '../../src/engine/types/scheme';

const SAMPLE_COUNT = 2000;

beforeAll(() => {
    registry.reset();
    initComponents();
});

function verdictFor(challenge: Challenge, scheme: SchemeV1) {
    return acceptChallenge({ challenge, scheme, attempt: 1, hintsUsed: [], sampleCount: SAMPLE_COUNT });
}

describe('дифф с эталонами не объявляет победителем пустую схему', () => {
    it.each(CHALLENGES.map((challenge) => [challenge.id, challenge] as const))(
        'стартовая схема «%s» сравнивается как несопоставимая',
        (_id, challenge) => {
            const verdict = verdictFor(challenge, challenge.starter());
            if (verdict.comparison === null) return;

            expect(verdict.comparison.comparable).toBe(false);

            const outcomes = verdict.comparison.rows.flatMap((row) =>
                row.references.map((cell) => cell.outcome),
            );
            expect(outcomes.length).toBeGreaterThan(0);
            expect(outcomes.some((outcome) => outcome === 'better')).toBe(false);
        },
    );

    it.each(CHALLENGES.map((challenge) => [challenge.id, challenge] as const))(
        'хотя бы один эталон «%s» сравнивается по существу',
        (_id, challenge) => {
            if (challenge.referenceSolutions.length === 0) return;

            const verdicts = challenge.referenceSolutions.map((reference) =>
                verdictFor(challenge, reference.build()),
            );

            expect(verdicts.some((verdict) => verdict.comparison?.comparable === true)).toBe(true);
        },
    );

    it('значения остаются доступны, даже когда сравнение несопоставимо', () => {
        const challenge = CHALLENGES[0];
        const verdict = verdictFor(challenge, challenge.starter());

        for (const row of verdict.comparison?.rows ?? []) {
            expect(Number.isFinite(row.mine)).toBe(true);
            for (const cell of row.references) {
                expect(Number.isFinite(cell.value)).toBe(true);
                expect(cell.delta).toBeCloseTo(row.mine - cell.value, 9);
            }
        }
    });
});
