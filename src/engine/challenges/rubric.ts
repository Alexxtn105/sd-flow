import type { CompiledTopology } from '../sim/compile';
import type { SimResult } from '../sim/types';
import type {
    AxisScore,
    Challenge,
    LintResult,
    Penalty,
    RequirementEvaluation,
    RubricAxis,
    RubricResult,
    ScenarioRun,
} from './types';

export const RUBRIC_WEIGHTS: Record<RubricAxis, number> = {
    resilience: 25,
    'data-correctness': 15,
    economy: 20,
    simplicity: 15,
    practices: 15,
    headroom: 5,
    bonus: 5,
};

export const RUBRIC_AXES = Object.keys(RUBRIC_WEIGHTS) as RubricAxis[];

const TARGET_UTILIZATION = 0.5;
const OVER_PROVISIONED_UTILIZATION = 0.15;
const OVER_PROVISIONED_SCORE = 40;
const DEEP_SYNC_DEPTH = 5;
const REFERENCE_NODE_TOLERANCE = 1.5;

export interface ReferencePoint {
    costMonth: number;
    nodeCount: number;
}

export interface RubricInput {
    challenge: Challenge;
    topology: CompiledTopology;
    baseline: SimResult;
    requirements: RequirementEvaluation[];
    bonusObjectives: RequirementEvaluation[];
    scenarioRuns: ScenarioRun[];
    lint: LintResult;
    reference: ReferencePoint | null;
    penalties: Penalty[];
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function share(met: number, total: number): number {
    return total === 0 ? 1 : met / total;
}

function availabilityTarget(challenge: Challenge): number {
    const targets = challenge.requirements
        .filter((requirement) => requirement.kind === 'slo' && requirement.metric === 'availability')
        .map((requirement) => (requirement.kind === 'slo' ? (requirement.min ?? 0) : 0));

    return targets.length > 0 ? Math.max(...targets) : 0.999;
}

function resilienceScore(input: RubricInput): AxisScore {
    const bonusRuns = input.scenarioRuns.filter((run) => !run.required);
    const failoverRuns = input.scenarioRuns.filter(
        (run) => run.scenario === 'az-failure' || run.scenario === 'region-failure',
    );

    const target = availabilityTarget(input.challenge);
    const actual = input.baseline.totals.availability;
    const availabilityScore = clamp((1 - target) / Math.max(1 - actual, 1e-9), 0, 1);

    const spofCount = input.baseline.findings.filter((finding) => finding.code === 'spof').length;
    const spofScore = spofCount === 0 ? 1 : clamp(1 - spofCount / 3, 0, 1);

    const parts = [
        share(bonusRuns.filter((run) => run.passed).length, bonusRuns.length),
        availabilityScore,
        spofScore,
        share(failoverRuns.filter((run) => run.passed).length, failoverRuns.length),
    ];

    return {
        axis: 'resilience',
        weight: RUBRIC_WEIGHTS.resilience,
        score: (parts.reduce((sum, part) => sum + part, 0) / parts.length) * 100,
        values: { availability: actual, availabilityTarget: target, spof: spofCount },
    };
}

function dataCorrectnessScore(input: RubricInput): AxisScore | null {
    const relevant = input.requirements.filter(
        (evaluation) => evaluation.kind === 'anomaly' || evaluation.kind === 'consistency',
    );

    if (relevant.length === 0 || input.baseline.consistency.mode !== 'anomalies') return null;

    const met = relevant.filter((evaluation) => evaluation.status === 'met').length;

    return {
        axis: 'data-correctness',
        weight: RUBRIC_WEIGHTS['data-correctness'],
        score: share(met, relevant.length) * 100,
        values: { met, total: relevant.length },
    };
}

function economyScore(input: RubricInput): AxisScore | null {
    if (!input.reference || input.reference.costMonth <= 0) return null;

    const cost = input.baseline.totals.costMonth;
    if (cost <= 0) return null;

    const ratio = cost / input.reference.costMonth;
    const score = clamp(1 - Math.log2(ratio) / 2, 0, 1) * 100;

    return {
        axis: 'economy',
        weight: RUBRIC_WEIGHTS.economy,
        score,
        values: { costMonth: cost, referenceCostMonth: input.reference.costMonth },
    };
}

function simplicityScore(input: RubricInput): AxisScore {
    const placed = input.topology.nodes.filter((node) => node.definition.shape === 'node');
    const unused = placed.filter((node) => (input.baseline.nodes[node.id]?.lambdaOffered ?? 0) <= 0).length;
    const deepChains = input.baseline.flows.filter((flow) => flow.depth > DEEP_SYNC_DEPTH).length;

    const excess = input.reference
        ? Math.max(0, placed.length - REFERENCE_NODE_TOLERANCE * input.reference.nodeCount)
        : 0;

    const score = clamp(100 - 6 * unused - 4 * excess - 3 * deepChains, 0, 100);

    return {
        axis: 'simplicity',
        weight: RUBRIC_WEIGHTS.simplicity,
        score,
        values: { nodes: placed.length, unused, deepChains },
    };
}

function practicesScore(input: RubricInput): AxisScore {
    return {
        axis: 'practices',
        weight: RUBRIC_WEIGHTS.practices,
        score: clamp(input.lint.practiceScore, 0, 100),
        values: { positives: input.lint.positives.length, antipatterns: input.lint.antipatterns.length },
    };
}

function headroomScore(input: RubricInput): AxisScore | null {
    const loaded = Object.values(input.baseline.nodes).filter(
        (node) =>
            node.lambdaOffered > 0 &&
            Number.isFinite(node.capacity) &&
            !input.topology.nodeById.get(node.nodeId)?.definition.managed,
    );
    if (loaded.length === 0) return null;

    const utilizations = loaded.map((node) => node.utilization);
    const middle = median(utilizations);
    const distance = Math.abs(middle - TARGET_UTILIZATION) / TARGET_UTILIZATION;
    const base = clamp(100 - distance * 100, 0, 100);
    const overProvisioned = Math.max(...utilizations) < OVER_PROVISIONED_UTILIZATION;

    return {
        axis: 'headroom',
        weight: RUBRIC_WEIGHTS.headroom,
        score: overProvisioned ? Math.min(base, OVER_PROVISIONED_SCORE) : base,
        values: { medianUtilization: middle, overProvisioned: overProvisioned ? 1 : 0 },
    };
}

function bonusScore(input: RubricInput): AxisScore | null {
    if (input.bonusObjectives.length === 0) return null;

    const met = input.bonusObjectives.filter((evaluation) => evaluation.status === 'met').length;

    return {
        axis: 'bonus',
        weight: RUBRIC_WEIGHTS.bonus,
        score: share(met, input.bonusObjectives.length) * 100,
        values: { met, total: input.bonusObjectives.length },
    };
}

export function scoreRubric(input: RubricInput): RubricResult {
    const axes = [
        resilienceScore(input),
        dataCorrectnessScore(input),
        economyScore(input),
        simplicityScore(input),
        practicesScore(input),
        headroomScore(input),
        bonusScore(input),
    ].filter((axis): axis is AxisScore => axis !== null);

    const totalWeight = axes.reduce((sum, axis) => sum + axis.weight, 0);
    const weighted = axes.reduce((sum, axis) => sum + axis.score * axis.weight, 0);
    const penaltyPoints = input.penalties.reduce((sum, penalty) => sum + penalty.points, 0);

    return {
        axes,
        penalties: input.penalties,
        total: clamp(totalWeight === 0 ? 0 : weighted / totalWeight - penaltyPoints, 0, 100),
    };
}
