import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import { CHALLENGES } from '../../src/data/challenges';
import type { Challenge } from '../../src/engine/challenges/types';

const SAMPLE_COUNT = 2000;

beforeAll(() => {
    registry.reset();
    initComponents();
});

function accept(challenge: Challenge, build: () => ReturnType<Challenge['starter']>) {
    return acceptChallenge({ challenge, scheme: build(), attempt: 1, hintsUsed: [], sampleCount: SAMPLE_COUNT });
}

describe('каталог заданий', () => {
    it('не пуст и не содержит повторов идентификаторов', () => {
        expect(CHALLENGES.length).toBeGreaterThan(0);
        expect(new Set(CHALLENGES.map((item) => item.id)).size).toBe(CHALLENGES.length);
    });

    for (const challenge of CHALLENGES) {
        describe(challenge.id, () => {
            it('объявляет непротиворечивые требования и потоки', () => {
                const starter = challenge.starter();
                const nodeIds = new Set(starter.nodes.map((node) => node.id));

                expect(new Set(challenge.requirements.map((item) => item.id)).size).toBe(challenge.requirements.length);
                expect(challenge.flows.length).toBeGreaterThan(0);

                for (const flow of challenge.flows) expect(nodeIds.has(flow.id)).toBe(true);
                for (const nodeId of Object.keys(challenge.lockedParams)) expect(nodeIds.has(nodeId)).toBe(true);
                for (const hint of challenge.hints) {
                    if (!hint.forRequirement) continue;
                    expect(challenge.requirements.some((item) => item.id === hint.forRequirement)).toBe(true);
                }
            });

            it('стартовая схема не сдаётся', () => {
                expect(accept(challenge, challenge.starter).stars).toBe(0);
            });

            it('хотя бы одно эталонное решение проходит приёмку', () => {
                expect(challenge.referenceSolutions.length).toBeGreaterThan(0);

                const verdicts = challenge.referenceSolutions.map((solution) => accept(challenge, solution.build));
                const best = verdicts.reduce((left, right) => (right.stars > left.stars ? right : left));

                expect(best.stars).toBeGreaterThanOrEqual(2);
                expect(best.stage).toBe('passed');
            });

            it('вердикт детерминирован', () => {
                const first = accept(challenge, challenge.referenceSolutions[0].build);
                const second = accept(challenge, challenge.referenceSolutions[0].build);

                expect(second.stars).toBe(first.stars);
                expect(second.rubric.total).toBeCloseTo(first.rubric.total, 9);
            });
        });
    }
});
