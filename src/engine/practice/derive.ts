import type { Challenge, LocalizedText, Requirement } from '../challenges/types';
import type { ComponentParams } from '../types/component';
import type { SchemeEdge, SchemeV1 } from '../types/scheme';
import type { GolfMedal, GolfTask, IncidentCase, SchemePatch, InterviewSession, InterviewStage } from './types';

const SECONDS_PER_MINUTE = 60;
const SILVER_FACTOR = 1.3;
const BRONZE_FACTOR = 1.7;

type ScalePatch = { nodeId: string; params: ComponentParams };

export function stageIndexAt(session: InterviewSession, elapsedSeconds: number): number {
    const minutes = elapsedSeconds / SECONDS_PER_MINUTE;
    const reached = session.stages.filter((stage) => stage.atMinute <= minutes).length;

    return Math.max(0, Math.min(session.stages.length - 1, reached - 1));
}

function joinBriefs(parts: LocalizedText[]): LocalizedText {
    return {
        ru: parts.map((part) => part.ru).join('\n\n'),
        en: parts.map((part) => part.en).join('\n\n'),
    };
}

function patchesOf(stages: InterviewStage[]): ScalePatch[] {
    return stages.map((stage) => stage.scale).filter((scale): scale is ScalePatch => scale !== null);
}

function patchScheme(scheme: SchemeV1, patches: ScalePatch[]): SchemeV1 {
    if (patches.length === 0) return scheme;

    return {
        ...scheme,
        nodes: scheme.nodes.map((node) => {
            const applied = patches.filter((patch) => patch.nodeId === node.id);
            if (applied.length === 0) return node;

            return { ...node, params: applied.reduce((params, patch) => ({ ...params, ...patch.params }), node.params) };
        }),
    };
}

function patchLocked(
    locked: Record<string, ComponentParams>,
    patches: ScalePatch[],
): Record<string, ComponentParams> {
    return patches.reduce(
        (result, patch) => ({ ...result, [patch.nodeId]: { ...(result[patch.nodeId] ?? {}), ...patch.params } }),
        { ...locked },
    );
}

export function challengeForInterview(base: Challenge, session: InterviewSession, stageIndex: number): Challenge {
    const stages = session.stages.slice(0, Math.max(0, Math.min(stageIndex, session.stages.length - 1)) + 1);
    const revealed = new Set(stages.flatMap((stage) => stage.requirementIds));
    const patches = patchesOf(stages);

    const byId = new Map<string, Requirement>(
        base.requirements
            .filter((requirement) => revealed.has(requirement.id))
            .map((requirement) => [requirement.id, requirement]),
    );

    for (const stage of stages) {
        for (const requirement of stage.extraRequirements) byId.set(requirement.id, requirement);
    }

    const requirements = [...byId.values()];

    return {
        ...base,
        id: session.id,
        title: session.title,
        brief: joinBriefs([session.brief, ...stages.map((stage) => stage.brief)]),
        estimatedMinutes: session.durationMinutes,
        given: stages.reduce((given, stage) => ({ ...given, ...stage.given }), base.given),
        requirements,
        bonusObjectives: [],
        scenarios: { required: base.scenarios.required, bonus: [] },
        lockedParams: patchLocked(base.lockedParams, patches),
        starter: () => patchScheme(base.starter(), patches),
        hints: [],
        referenceSolutions: [],
    };
}

function edgeMatches(edge: SchemeEdge, from: string, to: string): boolean {
    return edge.source === from && edge.target === to;
}

export function applyPatches(scheme: SchemeV1, patches: SchemePatch[]): SchemeV1 {
    return patches.reduce<SchemeV1>((current, fault) => {
        if (fault.kind === 'params') {
            return {
                ...current,
                nodes: current.nodes.map((node) =>
                    node.id === fault.nodeId ? { ...node, params: { ...node.params, ...fault.params } } : node,
                ),
            };
        }

        if (fault.kind === 'drop-node') {
            return {
                ...current,
                nodes: current.nodes.filter((node) => node.id !== fault.nodeId),
                edges: current.edges.filter((edge) => edge.source !== fault.nodeId && edge.target !== fault.nodeId),
            };
        }

        if (fault.kind === 'drop-link') {
            return { ...current, edges: current.edges.filter((edge) => !edgeMatches(edge, fault.from, fault.to)) };
        }

        if (fault.kind === 'policy') {
            return {
                ...current,
                edges: current.edges.map((edge) =>
                    edgeMatches(edge, fault.from, fault.to) ? { ...edge, policy: { ...edge.policy, ...fault.policy } } : edge,
                ),
            };
        }

        return {
            ...current,
            edges: current.edges.map((edge) =>
                edgeMatches(edge, fault.from, fault.to) ? { ...edge, kind: fault.edgeKind } : edge,
            ),
        };
    }, scheme);
}

function solutionOf(base: Challenge, solutionId: string): () => SchemeV1 {
    const solution = base.referenceSolutions.find((item) => item.id === solutionId);
    if (!solution) throw new Error(`Нет эталонного решения ${solutionId} у задания ${base.id}`);

    return solution.build;
}

export function challengeForIncident(base: Challenge, incident: IncidentCase): Challenge {
    const build = solutionOf(base, incident.solutionId);

    return {
        ...base,
        id: incident.id,
        title: incident.title,
        brief: incident.symptom,
        estimatedMinutes: incident.timeLimitMinutes,
        bonusObjectives: [],
        scenarios: { required: base.scenarios.required, bonus: [] },
        starter: () => applyPatches(build(), incident.faults),
        hints: [],
        referenceSolutions: [],
    };
}

export function challengeForGolf(base: Challenge, task: GolfTask): Challenge {
    const build = solutionOf(base, task.startFrom);

    return {
        ...base,
        id: task.id,
        title: task.title,
        brief: task.brief,
        requirements: base.requirements.filter((requirement) => requirement.kind !== 'budget'),
        bonusObjectives: [],
        scenarios: { required: base.scenarios.required, bonus: [] },
        starter: () => applyPatches(build(), task.inflate),
        hints: [],
        referenceSolutions: [],
    };
}

export function golfMedal(costUsdMonth: number, parUsdMonth: number): GolfMedal {
    if (costUsdMonth <= parUsdMonth) return 'gold';
    if (costUsdMonth <= parUsdMonth * SILVER_FACTOR) return 'silver';
    if (costUsdMonth <= parUsdMonth * BRONZE_FACTOR) return 'bronze';

    return 'none';
}
