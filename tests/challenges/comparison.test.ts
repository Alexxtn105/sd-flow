import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import { CHALLENGES } from '../../src/data/challenges';
import type { Challenge, ComparisonRow, SolutionComparison } from '../../src/engine/challenges/types';
import type { SchemeV1 } from '../../src/engine/types/scheme';

const SAMPLE_COUNT = 2000;

const TOLERANCE = 1e-9;

const METRICS = ['latencyP99', 'costMonth', 'availability', 'nodeCount', 'peakUtilization'];

const DIRECTIONS: Record<string, 'lower' | 'higher'> = {
    latencyP99: 'lower',
    costMonth: 'lower',
    availability: 'higher',
    nodeCount: 'lower',
    peakUtilization: 'lower',
};

beforeAll(() => {
    registry.reset();
    initComponents();
});

function accept(challenge: Challenge, scheme: SchemeV1) {
    return acceptChallenge({ challenge, scheme, attempt: 1, hintsUsed: [], sampleCount: SAMPLE_COUNT });
}

function comparisonOf(challenge: Challenge, scheme: SchemeV1): SolutionComparison {
    const comparison = accept(challenge, scheme).comparison;
    if (!comparison) throw new Error(`нет диффа для ${challenge.id}`);

    return comparison;
}

function expectedOutcome(row: ComparisonRow, delta: number, comparable: boolean): string {
    if (Math.abs(delta) <= TOLERANCE) return 'equal';
    if (!comparable) return 'incomparable';

    return (delta < 0) === (row.better === 'lower') ? 'better' : 'worse';
}

describe('метрический дифф с эталонами', () => {
    it('не появляется у задания без эталонных решений', () => {
        const challenge = CHALLENGES[0];
        const stripped: Challenge = { ...challenge, referenceSolutions: [] };

        expect(accept(stripped, challenge.starter()).comparison).toBeNull();
    });

    it('не появляется у схемы, которая не компилируется', () => {
        const challenge = CHALLENGES[0];
        const scheme = challenge.referenceSolutions[0].build();
        expect(scheme.edges.length).toBeGreaterThan(0);

        const broken: SchemeV1 = {
            ...scheme,
            edges: scheme.edges.map((edge, index) => (index === 0 ? { ...edge, target: 'nowhere' } : edge)),
        };

        const verdict = accept(challenge, broken);

        expect(verdict.stage).toBe('compile');
        expect(verdict.comparison).toBeNull();
    });

    for (const challenge of CHALLENGES) {
        describe(challenge.id, () => {
            it('покрывает все оси и все эталоны', () => {
                const comparison = comparisonOf(challenge, challenge.starter());

                expect(comparison.solutionIds).toEqual(challenge.referenceSolutions.map((solution) => solution.id));
                expect(comparison.rows.map((row) => row.metric)).toEqual(METRICS);

                for (const row of comparison.rows) {
                    expect(row.better).toBe(DIRECTIONS[row.metric]);
                    expect(Number.isFinite(row.mine)).toBe(true);
                    expect(row.references.map((cell) => cell.solutionId)).toEqual(comparison.solutionIds);

                    for (const cell of row.references) {
                        expect(Number.isFinite(cell.value)).toBe(true);
                        expect(cell.delta).toBeCloseTo(row.mine - cell.value, 9);
                        expect(cell.outcome).toBe(expectedOutcome(row, cell.delta, comparison.comparable));
                    }
                }
            });

            it('сравнение эталона с самим собой не даёт расхождений', () => {
                for (const [index, solution] of challenge.referenceSolutions.entries()) {
                    const comparison = comparisonOf(challenge, solution.build());

                    for (const row of comparison.rows) {
                        const own = row.references[index];

                        expect({ metric: row.metric, delta: own.delta, outcome: own.outcome }).toEqual({
                            metric: row.metric,
                            delta: 0,
                            outcome: 'equal',
                        });
                        expect(own.value).toBe(row.mine);
                    }
                }
            });

            it('детерминирован', () => {
                const first = comparisonOf(challenge, challenge.starter());
                const second = comparisonOf(challenge, challenge.starter());

                expect(second).toEqual(first);
            });

            it('отличает эталоны друг от друга хотя бы по одной оси', () => {
                if (challenge.referenceSolutions.length < 2) return;

                const comparison = comparisonOf(challenge, challenge.starter());
                const columns = comparison.solutionIds.map((_, index) =>
                    comparison.rows.map((row) => row.references[index].value).join('|'),
                );

                expect(new Set(columns).size).toBeGreaterThan(1);
            });
        });
    }
});
