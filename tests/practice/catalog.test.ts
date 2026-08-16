import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import { compileTopology } from '../../src/engine/sim/compile';
import { simulate } from '../../src/engine/sim/simulate';
import {
    applyPatches,
    challengeForGolf,
    challengeForIncident,
    challengeForInterview,
    golfMedal,
    stageIndexAt,
} from '../../src/engine/practice/derive';
import type { Challenge } from '../../src/engine/challenges/types';
import type { SchemeV1 } from '../../src/engine/types/scheme';
import { challengeById } from '../../src/data/challenges';
import { GOLF_TASKS, INCIDENTS, INTERVIEWS, resolveChallenge } from '../../src/data/practice';

const SAMPLE_COUNT = 2000;

beforeAll(() => {
    registry.reset();
    initComponents();
});

function base(challengeId: string): Challenge {
    const challenge = challengeById(challengeId);
    if (!challenge) throw new Error(`нет задания ${challengeId}`);

    return challenge;
}

function accept(challenge: Challenge, scheme: SchemeV1) {
    return acceptChallenge({ challenge, scheme, attempt: 1, hintsUsed: [], sampleCount: SAMPLE_COUNT });
}

function costOf(scheme: SchemeV1): number {
    return simulate(scheme, { sampleCount: 1, scenario: 'baseline' }).totals.costMonth;
}

function solutionOf(challenge: Challenge, solutionId: string) {
    const solution = challenge.referenceSolutions.find((item) => item.id === solutionId);
    if (!solution) throw new Error(`нет эталона ${solutionId}`);

    return solution;
}

describe('наборы режимов', () => {
    it('не пусты и не содержат повторов идентификаторов', () => {
        const ids = [...INTERVIEWS, ...INCIDENTS, ...GOLF_TASKS].map((item) => item.id);

        expect(INTERVIEWS.length).toBeGreaterThanOrEqual(6);
        expect(INCIDENTS.length).toBeGreaterThanOrEqual(10);
        expect(GOLF_TASKS.length).toBeGreaterThanOrEqual(5);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('интервью', () => {
    for (const session of INTERVIEWS) {
        describe(session.id, () => {
            it('ссылается на существующие требования и узлы базового задания', () => {
                const challenge = base(session.challengeId);
                const starterNodes = new Set(challenge.starter().nodes.map((node) => node.id));
                const known = new Set(challenge.requirements.map((requirement) => requirement.id));

                expect(session.stages.length).toBeGreaterThanOrEqual(2);
                expect(session.stages[0].atMinute).toBe(0);

                session.stages.forEach((stage, index) => {
                    if (index > 0) expect(stage.atMinute).toBeGreaterThan(session.stages[index - 1].atMinute);
                    expect(stage.atMinute).toBeLessThan(session.durationMinutes);

                    for (const id of stage.requirementIds) expect(known.has(id)).toBe(true);
                    if (!stage.scale) return;

                    expect(starterNodes.has(stage.scale.nodeId)).toBe(true);
                    expect(Object.keys(challenge.lockedParams)).toContain(stage.scale.nodeId);
                });
            });

            it('раскрывает требования по этапам и не теряет их', () => {
                const challenge = base(session.challengeId);
                const counts = session.stages.map(
                    (_, index) => challengeForInterview(challenge, session, index).requirements.length,
                );

                expect(counts[0]).toBeGreaterThan(0);
                for (let index = 1; index < counts.length; index += 1) {
                    expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]);
                }
                expect(counts[counts.length - 1]).toBeGreaterThan(counts[0]);
            });

            it('переносит масштабирование и в схему, и в запертые параметры', () => {
                const challenge = base(session.challengeId);
                const last = session.stages.length - 1;
                const derived = challengeForInterview(challenge, session, last);
                const scheme = derived.starter();

                for (const stage of session.stages) {
                    if (!stage.scale) continue;

                    const node = scheme.nodes.find((item) => item.id === stage.scale?.nodeId);
                    expect(node).toBeDefined();

                    for (const [key, value] of Object.entries(stage.scale.params)) {
                        expect(node?.params[key]).toBe(value);
                        expect(derived.lockedParams[stage.scale.nodeId][key]).toBe(value);
                    }
                }
            });

            it('масштаб этапа остаётся в реалистичных пределах', () => {
                const challenge = base(session.challengeId);
                const last = session.stages.length - 1;
                const derived = challengeForInterview(challenge, session, last);
                const verdict = accept(derived, derived.starter());

                expect(verdict.realism.filter((item) => item.code === 'param-out-of-range')).toHaveLength(0);
            });

            it('на первом этапе сдаётся лучшим эталоном базового задания', () => {
                const challenge = base(session.challengeId);
                const derived = challengeForInterview(challenge, session, 0);
                const verdicts = challenge.referenceSolutions.map((solution) => accept(derived, solution.build()));
                const best = verdicts.reduce((left, right) => (right.stars > left.stars ? right : left));

                expect(best.stage).toBe('passed');
            });

            it('стартовая схема сессии не сдаётся', () => {
                const derived = challengeForInterview(base(session.challengeId), session, 0);

                expect(accept(derived, derived.starter()).stars).toBe(0);
            });

            it('этап определяется по прошедшему времени', () => {
                expect(stageIndexAt(session, 0)).toBe(0);

                session.stages.forEach((stage, index) => {
                    expect(stageIndexAt(session, stage.atMinute * 60)).toBe(index);
                });
            });
        });
    }
});

describe('инциденты', () => {
    for (const incident of INCIDENTS) {
        describe(incident.id, () => {
            it('ломает именно то решение, которое чинится', () => {
                const challenge = base(incident.challengeId);
                const derived = challengeForIncident(challenge, incident);
                const pristine = solutionOf(challenge, incident.solutionId).build();

                expect(accept(derived, pristine).stage).toBe('passed');
                expect(['hard-gates', 'scenarios']).toContain(accept(derived, derived.starter()).stage);
            });

            it('не трогает данные задания', () => {
                const challenge = base(incident.challengeId);
                const locked = new Set(Object.keys(challenge.lockedParams));

                for (const fault of incident.faults) {
                    if (fault.kind === 'params' || fault.kind === 'drop-node') expect(locked.has(fault.nodeId)).toBe(false);
                    if (fault.kind !== 'drop-link' && fault.kind !== 'policy' && fault.kind !== 'edge-kind') continue;

                    expect(locked.has(fault.from)).toBe(false);
                }
            });

            it('сломанная схема компилируется — чинить есть что', () => {
                const derived = challengeForIncident(base(incident.challengeId), incident);
                const issues = compileTopology(derived.starter()).issues.filter((issue) => issue.severity === 'error');

                expect(issues).toEqual([]);
            });
        });
    }
});

describe('гольф', () => {
    for (const task of GOLF_TASKS) {
        describe(task.id, () => {
            it('стартует с рабочей, но раздутой схемы', () => {
                const challenge = base(task.challengeId);
                const derived = challengeForGolf(challenge, task);
                const inflated = derived.starter();

                expect(accept(derived, inflated).stage).toBe('passed');
                expect(costOf(inflated)).toBeGreaterThan(task.parUsdMonth);
            });

            it('медаль за нетронутую схему не выдаётся', () => {
                const derived = challengeForGolf(base(task.challengeId), task);

                expect(golfMedal(costOf(derived.starter()), task.parUsdMonth)).toBe('none');
            });

            it('цель достижима: исходный эталон в неё укладывается', () => {
                const challenge = base(task.challengeId);
                const derived = challengeForGolf(challenge, task);
                const pristine = solutionOf(challenge, task.startFrom).build();

                expect(accept(derived, pristine).stage).toBe('passed');
                expect(costOf(pristine)).toBeLessThanOrEqual(task.parUsdMonth);
            });

            it('снимает бюджетное требование — счёт и есть результат', () => {
                const derived = challengeForGolf(base(task.challengeId), task);

                expect(derived.requirements.some((requirement) => requirement.kind === 'budget')).toBe(false);
            });
        });
    }

    it('медаль зависит от расстояния до цели', () => {
        expect(golfMedal(900, 1000)).toBe('gold');
        expect(golfMedal(1000, 1000)).toBe('gold');
        expect(golfMedal(1200, 1000)).toBe('silver');
        expect(golfMedal(1600, 1000)).toBe('bronze');
        expect(golfMedal(2000, 1000)).toBe('none');
    });
});

describe('правки схемы', () => {
    it('снимают узел вместе с его связями', () => {
        const challenge = base('autocomplete');
        const scheme = solutionOf(challenge, 'in-memory-prefix-index').build();
        const stripped = applyPatches(scheme, [{ kind: 'drop-node', nodeId: 'hot-prefixes' }]);

        expect(stripped.nodes.some((node) => node.id === 'hot-prefixes')).toBe(false);
        expect(stripped.edges.some((edge) => edge.source === 'hot-prefixes' || edge.target === 'hot-prefixes')).toBe(false);
        expect(scheme.nodes.some((node) => node.id === 'hot-prefixes')).toBe(true);
    });
});

describe('разрешение ссылок', () => {
    it('собирает задание по ссылке любого режима', () => {
        expect(resolveChallenge({ kind: 'catalog', challengeId: 'static-site' }).id).toBe('static-site');
        expect(resolveChallenge({ kind: 'interview', sessionId: INTERVIEWS[0].id, stage: 0 }).id).toBe(INTERVIEWS[0].id);
        expect(resolveChallenge({ kind: 'incident', caseId: INCIDENTS[0].id }).id).toBe(INCIDENTS[0].id);
        expect(resolveChallenge({ kind: 'golf', taskId: GOLF_TASKS[0].id }).id).toBe(GOLF_TASKS[0].id);
    });

    it('падает на неизвестной ссылке', () => {
        expect(() => resolveChallenge({ kind: 'incident', caseId: 'нет-такого' })).toThrow();
    });
});
