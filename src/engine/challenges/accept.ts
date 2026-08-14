import registry from '../ComponentRegistry';
import type { SchemeV1 } from '../types/scheme';
import { compileTopology } from '../sim/compile';
import type { CompiledTopology } from '../sim/compile';
import type { ScenarioId } from '../sim/scenarios';
import { DEFAULT_SAMPLE_COUNT, simulate } from '../sim/simulate';
import type { SimResult } from '../sim/types';
import { lintArchitecture } from './lint';
import { evaluateRequirement } from './predicates';
import type { PredicateInput } from './predicates';
import { checkRealism } from './realism';
import { scoreRubric } from './rubric';
import type { ReferencePoint } from './rubric';
import type {
    Challenge,
    ChallengeVerdict,
    Penalty,
    Requirement,
    RequirementEvaluation,
    ScenarioRelaxation,
    ScenarioRun,
} from './types';

const REFERENCE_SAMPLE_COUNT = 1000;
const THREE_STARS_SCORE = 80;
const ATTEMPT_PENALTY = 3;
const OVERRIDE_PENALTY = 5;
const SCENARIO_KINDS = new Set(['slo', 'capacity']);

const FAVOURABLE_DIRECTION: Record<string, 'higher' | 'lower'> = {
    cacheHitRatio: 'higher',
    resolverCacheHitRatio: 'higher',
    compressionRatio: 'higher',
    hotKeyShare: 'lower',
    coldStartShare: 'lower',
    tombstoneRatio: 'lower',
};

export interface AcceptInput {
    challenge: Challenge;
    scheme: SchemeV1;
    attempt: number;
    hintsUsed: number[];
    sampleCount?: number;
}

function predicateInput(
    topology: CompiledTopology,
    result: SimResult,
    scenario: ScenarioId,
    relaxation: ScenarioRelaxation,
): PredicateInput {
    return { topology, result, scenario, relaxation };
}

function requirementsFor(challenge: Challenge, scenario: ScenarioId): Requirement[] {
    if (scenario === 'baseline') {
        return challenge.requirements.filter((requirement) => (requirement.scenario ?? 'baseline') === 'baseline');
    }

    return challenge.requirements.filter(
        (requirement) => requirement.scenario === scenario || SCENARIO_KINDS.has(requirement.kind),
    );
}

function overridePenalties(topology: CompiledTopology): Penalty[] {
    const penalties: Penalty[] = [];

    for (const node of topology.nodes) {
        const defaults = registry.getDefaultParams(node.type);

        for (const [param, direction] of Object.entries(FAVOURABLE_DIRECTION)) {
            const actual = node.params[param];
            const expected = defaults[param];
            if (typeof actual !== 'number' || typeof expected !== 'number') continue;

            const favourable = direction === 'higher' ? actual > expected : actual < expected;
            if (favourable) penalties.push({ code: `override-${param}`, points: OVERRIDE_PENALTY });
        }
    }

    return penalties;
}

function referencePoint(challenge: Challenge): ReferencePoint | null {
    const points = challenge.referenceSolutions.map((solution) => {
        const scheme = solution.build();
        const result = simulate(scheme, { sampleCount: REFERENCE_SAMPLE_COUNT, scenario: 'baseline' });

        return {
            costMonth: result.totals.costMonth,
            nodeCount: scheme.nodes.filter((node) => node.type !== 'region' && node.type !== 'az').length,
        };
    });

    if (points.length === 0) return null;

    return points.reduce((left, right) => (right.costMonth < left.costMonth ? right : left));
}

function emptyVerdict(challenge: Challenge, attempt: number): ChallengeVerdict {
    return {
        challengeId: challenge.id,
        stars: 0,
        stage: 'compile',
        realism: [],
        requirements: [],
        bonusObjectives: [],
        scenarioRuns: [],
        lint: { positives: [], antipatterns: [], practiceScore: 0, penalty: 0 },
        rubric: { axes: [], penalties: [], total: 0 },
        attempt,
    };
}

export function evaluateLive(challenge: Challenge, topology: CompiledTopology, result: SimResult): RequirementEvaluation[] {
    const input = predicateInput(topology, result, 'baseline', {});
    return requirementsFor(challenge, 'baseline').map((requirement) => evaluateRequirement(requirement, input));
}

export function acceptChallenge(input: AcceptInput): ChallengeVerdict {
    const { challenge, scheme, attempt, hintsUsed } = input;
    const sampleCount = input.sampleCount ?? DEFAULT_SAMPLE_COUNT;

    const topology = compileTopology(scheme);
    if (topology.issues.some((issue) => issue.severity === 'error')) {
        return emptyVerdict(challenge, attempt);
    }

    const baseline = simulate(scheme, { sampleCount, scenario: 'baseline' });

    const realism = checkRealism({
        challenge,
        topology,
        result: baseline,
        consistencyModel: scheme.settings.consistencyModel,
    });

    const baselineInput = predicateInput(topology, baseline, 'baseline', {});
    const requirements = requirementsFor(challenge, 'baseline').map((requirement) =>
        evaluateRequirement(requirement, baselineInput),
    );
    const bonusObjectives = challenge.bonusObjectives.map((requirement) =>
        evaluateRequirement(requirement, baselineInput),
    );

    const lint = lintArchitecture({ topology, result: baseline });

    const scenarioRuns: ScenarioRun[] = [];
    const battery: { scenario: ScenarioId; required: boolean }[] = [
        ...challenge.scenarios.required.map((scenario) => ({ scenario, required: true })),
        ...challenge.scenarios.bonus.map((scenario) => ({ scenario, required: false })),
    ];

    for (const item of battery) {
        if (item.scenario === 'baseline') {
            scenarioRuns.push({
                scenario: item.scenario,
                required: item.required,
                passed: requirements.every((evaluation) => evaluation.status !== 'unmet'),
                failures: requirements.filter((evaluation) => evaluation.status === 'unmet'),
            });
            continue;
        }

        const result = simulate(scheme, { sampleCount, scenario: item.scenario });
        const relaxation = challenge.relaxation[item.scenario] ?? {};
        const evaluations = requirementsFor(challenge, item.scenario).map((requirement) =>
            evaluateRequirement(requirement, predicateInput(topology, result, item.scenario, relaxation)),
        );

        const failures = evaluations.filter((evaluation) => evaluation.status === 'unmet');
        scenarioRuns.push({ scenario: item.scenario, required: item.required, passed: failures.length === 0, failures });
    }

    const hintPenalties: Penalty[] = hintsUsed
        .map((index) => challenge.hints[index])
        .filter((hint) => hint !== undefined)
        .map((hint) => ({ code: `hint-${hint.level}`, points: hint.cost }));

    const penalties: Penalty[] = [
        ...hintPenalties,
        ...overridePenalties(topology),
        ...(lint.penalty > 0 ? [{ code: 'antipatterns', points: lint.penalty }] : []),
        ...(attempt > 1 ? [{ code: 'retry', points: (attempt - 1) * ATTEMPT_PENALTY }] : []),
    ];

    const rubric = scoreRubric({
        challenge,
        topology,
        baseline,
        requirements,
        bonusObjectives,
        scenarioRuns,
        lint,
        reference: referencePoint(challenge),
        penalties,
    });

    const hardGatesPassed = realism.length === 0 && requirements.every((evaluation) => evaluation.status === 'met');
    const requiredPassed = scenarioRuns.filter((run) => run.required).every((run) => run.passed);

    const stars: ChallengeVerdict['stars'] = !hardGatesPassed
        ? 0
        : !requiredPassed
          ? 1
          : rubric.total >= THREE_STARS_SCORE
            ? 3
            : 2;

    const stage: ChallengeVerdict['stage'] =
        realism.length > 0 ? 'realism' : !hardGatesPassed ? 'hard-gates' : !requiredPassed ? 'scenarios' : 'passed';

    return {
        challengeId: challenge.id,
        stars,
        stage,
        realism,
        requirements,
        bonusObjectives,
        scenarioRuns,
        lint,
        rubric,
        attempt,
    };
}
