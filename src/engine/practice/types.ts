import type { LocalizedText, Requirement } from '../challenges/types';
import type { ComponentParams } from '../types/component';
import type { EdgeKind, EdgePolicy } from '../types/scheme';

export type PracticeKind = 'interview' | 'incident' | 'golf';

export interface InterviewStage {
    atMinute: number;
    brief: LocalizedText;
    requirementIds: string[];
    extraRequirements: Requirement[];
    scale: { nodeId: string; params: ComponentParams } | null;
    given: Record<string, number | string>;
}

export interface InterviewSession {
    id: string;
    challengeId: string;
    title: LocalizedText;
    brief: LocalizedText;
    durationMinutes: number;
    stages: InterviewStage[];
}

export type SchemePatch =
    | { kind: 'params'; nodeId: string; params: ComponentParams }
    | { kind: 'drop-node'; nodeId: string }
    | { kind: 'drop-link'; from: string; to: string }
    | { kind: 'policy'; from: string; to: string; policy: Partial<EdgePolicy> }
    | { kind: 'edge-kind'; from: string; to: string; edgeKind: EdgeKind };

export interface IncidentCase {
    id: string;
    challengeId: string;
    solutionId: string;
    title: LocalizedText;
    symptom: LocalizedText;
    rootCause: LocalizedText;
    timeLimitMinutes: number;
    faults: SchemePatch[];
}

export interface GolfTask {
    id: string;
    challengeId: string;
    startFrom: string;
    title: LocalizedText;
    brief: LocalizedText;
    parUsdMonth: number;
    inflate: SchemePatch[];
}

export type GolfMedal = 'gold' | 'silver' | 'bronze' | 'none';

export interface PracticeRecord {
    id: string;
    attempts: number;
    solved: boolean;
    bestSeconds: number | null;
    bestCostUsd: number | null;
    bestStars: 0 | 1 | 2 | 3;
}
