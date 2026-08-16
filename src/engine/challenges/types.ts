import type { ComponentParams } from '../types/component';
import type { SchemeV1 } from '../types/scheme';
import type { ScenarioId } from '../sim/scenarios';

export type ChallengeLevel = 1 | 2 | 3 | 4 | 5;

export interface LocalizedText {
    ru: string;
    en: string;
}

export interface NodeMatcher {
    group?: string;
    type?: string;
}

export interface ChallengeFlow {
    id: string;
    name: LocalizedText;
    weightInScore: number;
}

export interface ChallengeConstraints {
    maxNodes?: number;
    allowedGroups?: string[];
    forbiddenTypes?: string[];
}

export type RequirementKind =
    | 'capability'
    | 'slo'
    | 'capacity'
    | 'durability'
    | 'redundancy'
    | 'budget'
    | 'storage'
    | 'freshness'
    | 'consistency'
    | 'anomaly'
    | 'geo'
    | 'rpo-rto'
    | 'security';

export type SloMetric = 'latency.p50' | 'latency.p95' | 'latency.p99' | 'availability' | 'errorRate';

export type ConsistencyLevel = 'strong' | 'read-your-writes' | 'eventual';

export type SecurityControl = 'auth-on-edge' | 'no-direct-client-to-db' | 'tls-terminate' | 'rate-limit-at-edge';

interface RequirementBase {
    id: string;
    desc: LocalizedText;
    scenario?: ScenarioId;
}

export interface CapabilityRequirement extends RequirementBase {
    kind: 'capability';
    flow: string;
    to: NodeMatcher;
    viaAny?: NodeMatcher[];
    notVia?: NodeMatcher[];
    asyncBefore?: NodeMatcher;
}

export interface SloRequirement extends RequirementBase {
    kind: 'slo';
    flow: string;
    metric: SloMetric;
    max?: number;
    min?: number;
}

export interface CapacityRequirement extends RequirementBase {
    kind: 'capacity';
    maxUtilization: number;
}

export interface DurabilityRequirement extends RequirementBase {
    kind: 'durability';
    flow: string;
    minReplication: number;
}

export interface RedundancyRequirement extends RequirementBase {
    kind: 'redundancy';
    flow: string;
    minRedundancy: number;
    spanAzs?: number;
}

export interface BudgetRequirement extends RequirementBase {
    kind: 'budget';
    maxMonthlyCostUsd: number;
}

export interface StorageRequirement extends RequirementBase {
    kind: 'storage';
    horizonYears: number;
    headroom: number;
}

export interface FreshnessRequirement extends RequirementBase {
    kind: 'freshness';
    maxLagSec: number;
}

export interface ConsistencyRequirement extends RequirementBase {
    kind: 'consistency';
    flow: string;
    requires: ConsistencyLevel;
}

export interface AnomalyRequirement extends RequirementBase {
    kind: 'anomaly';
    code: string;
    maxRatePerSec?: number;
    maxSharePercent?: number;
}

export interface GeoRequirement extends RequirementBase {
    kind: 'geo';
    minRegions?: number;
    maxClientRttMs?: number;
    residency?: boolean;
}

export interface RpoRtoRequirement extends RequirementBase {
    kind: 'rpo-rto';
    maxRpoSec: number;
    maxRtoSec: number;
}

export interface SecurityRequirement extends RequirementBase {
    kind: 'security';
    requires: SecurityControl[];
}

export type Requirement =
    | CapabilityRequirement
    | SloRequirement
    | CapacityRequirement
    | DurabilityRequirement
    | RedundancyRequirement
    | BudgetRequirement
    | StorageRequirement
    | FreshnessRequirement
    | ConsistencyRequirement
    | AnomalyRequirement
    | GeoRequirement
    | RpoRtoRequirement
    | SecurityRequirement;

export interface ScenarioRelaxation {
    latencyFactor?: number;
    utilizationFactor?: number;
    availabilityFloor?: number;
}

export interface ChallengeHint {
    level: 1 | 2 | 3;
    cost: number;
    text: LocalizedText;
    forRequirement?: string;
}

export interface ReferenceSolution {
    id: string;
    name: LocalizedText;
    tradeoff: LocalizedText;
    build: () => SchemeV1;
}

export interface Challenge {
    id: string;
    level: ChallengeLevel;
    estimatedMinutes: number;
    tags: string[];
    title: LocalizedText;
    brief: LocalizedText;
    given: Record<string, number | string>;
    flows: ChallengeFlow[];
    constraints: ChallengeConstraints;
    requirements: Requirement[];
    bonusObjectives: Requirement[];
    scenarios: { required: ScenarioId[]; bonus: ScenarioId[] };
    relaxation: Partial<Record<ScenarioId, ScenarioRelaxation>>;
    requiredConsistencyModel?: 'anomalies';
    pricingProfile?: string;
    lockedParams: Record<string, ComponentParams>;
    starter: () => SchemeV1;
    hints: ChallengeHint[];
    referenceSolutions: ReferenceSolution[];
}

export type RequirementStatus = 'met' | 'unmet' | 'unknown';

export interface RequirementContribution {
    nodeId: string;
    value: number;
    share: number;
}

export interface RequirementEvaluation {
    id: string;
    kind: RequirementKind;
    status: RequirementStatus;
    scenario: ScenarioId;
    reason: string;
    actual: number | null;
    target: number | null;
    unit: string;
    headroom: number | null;
    nodeIds: string[];
    values: Record<string, string | number>;
    contributions: RequirementContribution[];
}

export interface RealismViolation {
    code: string;
    nodeIds: string[];
    values: Record<string, string | number>;
}

export type LintKind = 'positive' | 'antipattern';

export interface LintHit {
    rule: string;
    kind: LintKind;
    weight: number;
    nodeIds: string[];
    edgeIds: string[];
    values: Record<string, string | number>;
}

export interface LintResult {
    positives: LintHit[];
    antipatterns: LintHit[];
    practiceScore: number;
    penalty: number;
}

export type RubricAxis =
    | 'resilience'
    | 'data-correctness'
    | 'economy'
    | 'simplicity'
    | 'practices'
    | 'headroom'
    | 'bonus';

export interface AxisScore {
    axis: RubricAxis;
    weight: number;
    score: number;
    values: Record<string, string | number>;
}

export interface Penalty {
    code: string;
    points: number;
}

export interface RubricResult {
    axes: AxisScore[];
    penalties: Penalty[];
    total: number;
}

export type ComparisonMetric = 'latencyP99' | 'costMonth' | 'availability' | 'nodeCount' | 'peakUtilization';

export type ComparisonDirection = 'lower' | 'higher';

export type ComparisonOutcome = 'better' | 'worse' | 'equal' | 'incomparable';

export type ComparisonMetrics = Record<ComparisonMetric, number>;

export interface ComparisonCell {
    solutionId: string;
    value: number;
    delta: number;
    outcome: ComparisonOutcome;
}

export interface ComparisonRow {
    metric: ComparisonMetric;
    unit: string;
    better: ComparisonDirection;
    mine: number;
    references: ComparisonCell[];
}

export interface SolutionComparison {
    comparable: boolean;
    solutionIds: string[];
    rows: ComparisonRow[];
}

export type VerdictStage = 'realism' | 'compile' | 'hard-gates' | 'scenarios' | 'passed';

export interface ScenarioRun {
    scenario: ScenarioId;
    required: boolean;
    passed: boolean;
    failures: RequirementEvaluation[];
}

export interface ChallengeVerdict {
    challengeId: string;
    stars: 0 | 1 | 2 | 3;
    stage: VerdictStage;
    realism: RealismViolation[];
    requirements: RequirementEvaluation[];
    bonusObjectives: RequirementEvaluation[];
    scenarioRuns: ScenarioRun[];
    lint: LintResult;
    rubric: RubricResult;
    comparison: SolutionComparison | null;
    metrics: ComparisonMetrics;
    attempt: number;
}

export interface ChallengeProgress {
    challengeId: string;
    stars: 0 | 1 | 2 | 3;
    attempts: number;
    hintsUsed: number[];
    bestScore: number;
}
