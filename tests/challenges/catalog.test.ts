import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import { compileTopology } from '../../src/engine/sim/compile';
import { simulate } from '../../src/engine/sim/simulate';
import { CHALLENGES } from '../../src/data/challenges';
import type { Challenge } from '../../src/engine/challenges/types';

const SAMPLE_COUNT = 2000;
const ADVANCED_LEVELS = [4, 5];

beforeAll(() => {
    registry.reset();
    initComponents();
});

function accept(challenge: Challenge, build: () => ReturnType<Challenge['starter']>) {
    return acceptChallenge({ challenge, scheme: build(), attempt: 1, hintsUsed: [], sampleCount: SAMPLE_COUNT });
}

function monthlyCost(build: () => ReturnType<Challenge['starter']>): number {
    return simulate(build(), { sampleCount: 1, scenario: 'baseline' }).totals.costMonth;
}

function schemeSignature(build: () => ReturnType<Challenge['starter']>): string {
    const scheme = build();
    const nodes = scheme.nodes
        .map((node) => `${node.type}:${JSON.stringify(node.params)}`)
        .sort()
        .join('|');
    const edges = scheme.edges
        .map((edge) => `${edge.source}>${edge.target}:${edge.kind}:${JSON.stringify(edge.policy)}`)
        .sort()
        .join('|');

    return `${nodes}#${edges}`;
}

describe('каталог заданий', () => {
    it('не пуст и не содержит повторов идентификаторов', () => {
        expect(CHALLENGES.length).toBeGreaterThan(0);
        expect(new Set(CHALLENGES.map((item) => item.id)).size).toBe(CHALLENGES.length);
    });

    it('покрывает все пять уровней сложности', () => {
        const levels = new Set(CHALLENGES.map((challenge) => challenge.level));

        expect([...levels].sort()).toEqual([1, 2, 3, 4, 5]);
        for (const level of ADVANCED_LEVELS) {
            expect(CHALLENGES.filter((challenge) => challenge.level === level).length).toBeGreaterThanOrEqual(4);
        }
    });

    for (const challenge of CHALLENGES) {
        describe(challenge.id, () => {
            it('объявляет непротиворечивые требования и потоки', () => {
                const starter = challenge.starter();
                const nodeIds = new Set(starter.nodes.map((node) => node.id));

                expect(new Set(challenge.requirements.map((item) => item.id)).size).toBe(challenge.requirements.length);
                expect(new Set(challenge.bonusObjectives.map((item) => item.id)).size).toBe(
                    challenge.bonusObjectives.length,
                );
                expect(challenge.flows.length).toBeGreaterThan(0);

                for (const flow of challenge.flows) expect(nodeIds.has(flow.id)).toBe(true);
                for (const nodeId of Object.keys(challenge.lockedParams)) expect(nodeIds.has(nodeId)).toBe(true);
                for (const hint of challenge.hints) {
                    expect(hint.cost).toBeGreaterThan(0);
                    if (!hint.forRequirement) continue;
                    expect(challenge.requirements.some((item) => item.id === hint.forRequirement)).toBe(true);
                }
                for (const value of Object.values(challenge.given)) {
                    if (typeof value !== 'number') continue;
                    expect(Number.isFinite(value)).toBe(true);
                    expect(value).toBeGreaterThan(0);
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

                if (verdicts.length < 2) return;

                const outcomes = new Set(verdicts.map((verdict) => `${verdict.stars}:${verdict.rubric.total.toFixed(3)}`));
                expect(outcomes.size).toBeGreaterThan(1);
            });

            it('эталонные решения компилируются и проходят Realism Gate', () => {
                for (const solution of challenge.referenceSolutions) {
                    const topology = compileTopology(solution.build());
                    const errors = topology.issues.filter((issue) => issue.severity === 'error');

                    expect({ solution: solution.id, errors }).toEqual({ solution: solution.id, errors: [] });
                    expect({ solution: solution.id, realism: accept(challenge, solution.build).realism }).toEqual({
                        solution: solution.id,
                        realism: [],
                    });
                }
            });

            it('вердикт детерминирован', () => {
                const first = accept(challenge, challenge.referenceSolutions[0].build);
                const second = accept(challenge, challenge.referenceSolutions[0].build);

                expect(second.stars).toBe(first.stars);
                expect(second.rubric.total).toBeCloseTo(first.rubric.total, 9);
            });

            if (challenge.referenceSolutions.length > 1) {
                it('эталонные решения — разные схемы, а не варианты одного', () => {
                    const signatures = challenge.referenceSolutions.map((solution) => schemeSignature(solution.build));
                    const costs = challenge.referenceSolutions.map((solution) => monthlyCost(solution.build));

                    expect(new Set(signatures).size).toBe(signatures.length);
                    for (const cost of costs) expect(cost).toBeGreaterThan(0);
                });
            }

            if (ADVANCED_LEVELS.includes(challenge.level)) {
                it('оформлено по полной форме уровня 4–5', () => {
                    expect(challenge.requirements.length).toBeGreaterThanOrEqual(7);
                    expect(challenge.bonusObjectives.length).toBeGreaterThanOrEqual(2);
                    expect(challenge.referenceSolutions.length).toBeGreaterThanOrEqual(2);
                    expect(challenge.scenarios.required.length).toBeGreaterThanOrEqual(2);
                    expect(challenge.scenarios.bonus.length).toBeGreaterThanOrEqual(1);
                    expect(challenge.estimatedMinutes).toBeGreaterThanOrEqual(60);
                    expect(challenge.hints.map((hint) => hint.level)).toEqual([1, 2, 3]);
                    expect(Object.keys(challenge.given).length).toBeGreaterThanOrEqual(6);

                    for (const scenario of [...challenge.scenarios.required, ...challenge.scenarios.bonus]) {
                        expect(challenge.relaxation[scenario]).toBeDefined();
                    }
                });

                it('провальное эталонное решение объясняет, чем именно оно плохо', () => {
                    const verdicts = challenge.referenceSolutions.map((solution) => accept(challenge, solution.build));
                    const weakest = verdicts.reduce((left, right) => (right.stars < left.stars ? right : left));
                    if (weakest.stars >= 2) return;

                    const failures = [
                        ...weakest.requirements.filter((evaluation) => evaluation.status !== 'met'),
                        ...weakest.scenarioRuns.filter((run) => run.required && !run.passed),
                    ];

                    expect(failures.length).toBeGreaterThan(0);
                });
            }
        });
    }
});
