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
    ComparisonDirection,
    ComparisonMetric,
    ComparisonMetrics,
    ComparisonOutcome,
    Penalty,
    Requirement,
    RequirementEvaluation,
    ScenarioRelaxation,
    ScenarioRun,
    SolutionComparison,
} from './types';

const THREE_STARS_SCORE = 80;
const ATTEMPT_PENALTY = 3;
const OVERRIDE_PENALTY = 5;
const SCENARIO_KINDS = new Set(['slo', 'capacity']);
const COMPARISON_TOLERANCE = 1e-9;

const COMPARISON_METRICS: { metric: ComparisonMetric; unit: string; better: ComparisonDirection }[] = [
    { metric: 'latencyP99', unit: 'ms', better: 'lower' },
    { metric: 'costMonth', unit: '$', better: 'lower' },
    { metric: 'availability', unit: 'nines', better: 'higher' },
    { metric: 'nodeCount', unit: '', better: 'lower' },
    { metric: 'peakUtilization', unit: 'ratio', better: 'lower' },
];

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

interface ReferenceRun {
    solutionId: string;
    costMonth: number;
    nodeCount: number;
    metrics: ComparisonMetrics;
}

function worstFlowP99(result: SimResult): number {
    return result.flows.reduce((worst, flow) => Math.max(worst, flow.latency.p99), 0);
}

function peakUtilization(result: SimResult): number {
    return Object.values(result.nodes).reduce(
        (peak, node) =>
            node.lambdaOffered > 0 && Number.isFinite(node.utilization) ? Math.max(peak, node.utilization) : peak,
        0,
    );
}

function comparisonMetrics(result: SimResult): ComparisonMetrics {
    return {
        latencyP99: worstFlowP99(result),
        costMonth: result.totals.costMonth,
        availability: result.totals.availability,
        nodeCount: Object.keys(result.nodes).length,
        peakUtilization: peakUtilization(result),
    };
}

export const ACCEPTANCE_SEED = 1;
export const ACCEPTANCE_PRICING = 'aws-2026-q2';

export function judgedScheme(challenge: Challenge, scheme: SchemeV1): SchemeV1 {
    return {
        ...scheme,
        settings: {
            ...scheme.settings,
            seed: ACCEPTANCE_SEED,
            pricingProfile: challenge.pricingProfile ?? ACCEPTANCE_PRICING,
        },
    };
}

function runReferences(challenge: Challenge, sampleCount: number): ReferenceRun[] {
    return challenge.referenceSolutions.map((solution) => {
        const scheme = judgedScheme(challenge, solution.build());
        const result = simulate(scheme, { sampleCount, scenario: 'baseline' });

        return {
            solutionId: solution.id,
            costMonth: result.totals.costMonth,
            nodeCount: scheme.nodes.filter((node) => node.type !== 'region' && node.type !== 'az').length,
            metrics: comparisonMetrics(result),
        };
    });
}

function referencePoint(runs: ReferenceRun[]): ReferencePoint | null {
    if (runs.length === 0) return null;

    const cheapest = runs.reduce((left, right) => (right.costMonth < left.costMonth ? right : left));

    return { costMonth: cheapest.costMonth, nodeCount: cheapest.nodeCount };
}

function comparisonOutcome(delta: number, better: ComparisonDirection): ComparisonOutcome {
    if (Math.abs(delta) <= COMPARISON_TOLERANCE) return 'equal';

    return (delta < 0) === (better === 'lower') ? 'better' : 'worse';
}

function compareWithReferences(
    mine: ComparisonMetrics,
    runs: ReferenceRun[],
    comparable: boolean,
): SolutionComparison | null {
    if (runs.length === 0) return null;

    return {
        comparable,
        solutionIds: runs.map((run) => run.solutionId),
        rows: COMPARISON_METRICS.map((row) => ({
            metric: row.metric,
            unit: row.unit,
            better: row.better,
            mine: mine[row.metric],
            references: runs.map((run) => {
                const value = run.metrics[row.metric];
                const delta = mine[row.metric] - value;
                const measured = comparisonOutcome(delta, row.better);
                const outcome = comparable || measured === 'equal' ? measured : 'incomparable';

                return { solutionId: run.solutionId, value, delta, outcome };
            }),
        })),
    };
}

function servesTheTask(requirements: RequirementEvaluation[], mine: ComparisonMetrics): boolean {
    const capabilitiesMet = requirements
        .filter((evaluation) => evaluation.kind === 'capability')
        .every((evaluation) => evaluation.status === 'met');

    return capabilitiesMet && mine.peakUtilization > 0;
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
        comparison: null,
        metrics: { latencyP99: 0, costMonth: 0, availability: 0, nodeCount: 0, peakUtilization: 0 },
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

    const judged = judgedScheme(challenge, scheme);
    const baseline = simulate(judged, { sampleCount, scenario: 'baseline' });

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

        const result = simulate(judged, { sampleCount, scenario: item.scenario });
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

    const references = runReferences(challenge, sampleCount);

    const rubric = scoreRubric({
        challenge,
        topology,
        baseline,
        requirements,
        bonusObjectives,
        scenarioRuns,
        lint,
        reference: referencePoint(references),
        penalties,
    });

    const mine = comparisonMetrics(baseline);
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
        comparison: compareWithReferences(mine, references, servesTheTask(requirements, mine)),
        metrics: mine,
        attempt,
    };
}
