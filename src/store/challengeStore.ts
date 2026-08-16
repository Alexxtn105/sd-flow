import { create } from 'zustand';
import { interviewById, refKey, resolveChallenge } from '../data/practice';
import type { ChallengeRef } from '../data/practice';
import { stageIndexAt } from '../engine/practice/derive';
import type { InterviewSession, PracticeRecord } from '../engine/practice/types';
import type { Challenge, ChallengeProgress, ChallengeVerdict } from '../engine/challenges/types';
import type { SchemeV1 } from '../engine/types/scheme';
import { loadAuthored } from '../services/authoredChallenges';
import type { AuthoredChallenge } from '../services/authoredChallenges';
import {
    buildProgressBundle,
    mergeChallengeProgress,
    mergePracticeRecords,
    readProgressBundle,
} from '../services/progressTransfer';
import type { ProgressBundle } from '../services/progressTransfer';
import { runAcceptance } from '../services/simulationService';
import StorageService, { STORAGE_KEYS } from '../services/storageService';
import { useGraphStore } from './graphStore';
import { useSchemeStore } from './schemeStore';

export type ChallengeStatus = 'idle' | 'running' | 'ready' | 'error';

export type PracticeTrack = 'catalog' | 'interview' | 'incident' | 'golf' | 'authored';

export interface TimedSession {
    limitSec: number;
    startedAt: number;
    elapsedSec: number;
    stage: number;
    expired: boolean;
}

export interface ChallengeState {
    track: PracticeTrack;
    ref: ChallengeRef | null;
    active: Challenge | null;
    session: TimedSession | null;
    status: ChallengeStatus;
    error: string | null;
    verdict: ChallengeVerdict | null;
    hintsUsed: number[];
    progress: Record<string, ChallengeProgress>;
    practice: Record<string, PracticeRecord>;
    authored: AuthoredChallenge[];
    editing: AuthoredChallenge | null;
    editorOpen: boolean;
    setTrack: (track: PracticeTrack) => void;
    openEditor: (item: AuthoredChallenge | null) => void;
    closeEditor: () => void;
    open: (ref: ChallengeRef) => void;
    restart: () => void;
    close: () => void;
    revealHint: (index: number) => void;
    submit: (scheme: SchemeV1) => void;
    tick: () => void;
    refreshAuthored: () => void;
    exportProgress: () => ProgressBundle;
    importProgress: (raw: unknown) => boolean;
}

const SECONDS_PER_MINUTE = 60;
const TIMED_KINDS = new Set(['interview', 'incident']);

function loadProgress(): Record<string, ChallengeProgress> {
    return StorageService.load<Record<string, ChallengeProgress>>(STORAGE_KEYS.CHALLENGES) ?? {};
}

function loadPractice(): Record<string, PracticeRecord> {
    return StorageService.load<Record<string, PracticeRecord>>(STORAGE_KEYS.PRACTICE) ?? {};
}

function progressFor(progress: Record<string, ChallengeProgress>, key: string): ChallengeProgress {
    return progress[key] ?? { challengeId: key, stars: 0, attempts: 0, hintsUsed: [], bestScore: 0 };
}

function practiceFor(practice: Record<string, PracticeRecord>, key: string): PracticeRecord {
    return practice[key] ?? { id: key, attempts: 0, solved: false, bestSeconds: null, bestCostUsd: null, bestStars: 0 };
}

function limitSecOf(ref: ChallengeRef, challenge: Challenge): number {
    return TIMED_KINDS.has(ref.kind) ? challenge.estimatedMinutes * SECONDS_PER_MINUTE : 0;
}

function applyStageScale(session: InterviewSession, fromStage: number, toStage: number): void {
    const graph = useGraphStore.getState();
    graph.beginTransaction();

    for (const stage of session.stages.slice(fromStage + 1, toStage + 1)) {
        if (!stage.scale) continue;

        for (const [key, value] of Object.entries(stage.scale.params)) {
            graph.updateNodeParam(stage.scale.nodeId, key, value);
        }
    }

    useGraphStore.getState().commitTransaction();
}

function lowerOf(current: number | null, candidate: number): number {
    return current === null ? candidate : Math.min(current, candidate);
}

let latestRequest = 0;

export const useChallengeStore = create<ChallengeState>((set, get) => ({
    track: 'catalog',
    ref: null,
    active: null,
    session: null,
    status: 'idle',
    error: null,
    verdict: null,
    hintsUsed: [],
    progress: loadProgress(),
    practice: loadPractice(),
    authored: loadAuthored(),
    editing: null,
    editorOpen: false,

    setTrack: (track) => set({ track }),

    openEditor: (item) => set({ editing: item, editorOpen: true }),

    closeEditor: () => set({ editing: null, editorOpen: false, authored: loadAuthored() }),

    open: (ref) => {
        const challenge = resolveChallenge(ref);
        const key = refKey(ref);
        const known = progressFor(get().progress, key);
        const limitSec = limitSecOf(ref, challenge);

        useSchemeStore.getState().importScheme(challenge.starter());

        set({
            ref,
            active: challenge,
            status: 'idle',
            error: null,
            verdict: null,
            hintsUsed: known.hintsUsed,
            session: limitSec === 0 ? null : { limitSec, startedAt: Date.now(), elapsedSec: 0, stage: 0, expired: false },
        });
    },

    restart: () => {
        const { ref } = get();
        if (!ref) return;

        get().open(ref.kind === 'interview' ? { ...ref, stage: 0 } : ref);
    },

    close: () =>
        set({ ref: null, active: null, session: null, status: 'idle', error: null, verdict: null, hintsUsed: [] }),

    revealHint: (index) => {
        const { hintsUsed, ref, progress } = get();
        if (hintsUsed.includes(index) || !ref) return;

        const next = [...hintsUsed, index].sort((left, right) => left - right);
        const key = refKey(ref);
        const updated = { ...progress, [key]: { ...progressFor(progress, key), hintsUsed: next } };

        set({ hintsUsed: next, progress: updated });
        StorageService.save(STORAGE_KEYS.CHALLENGES, updated);
    },

    submit: (scheme) => {
        const { ref, hintsUsed, progress, session } = get();
        if (!ref) return;

        const key = refKey(ref);
        const attempt = progressFor(progress, key).attempts + 1;
        latestRequest += 1;
        const requestId = latestRequest;
        set({ status: 'running', error: null });

        runAcceptance({ ref, scheme, attempt, hintsUsed })
            .then((verdict) => {
                if (requestId !== latestRequest) return;

                const previous = progressFor(get().progress, key);
                const updated: Record<string, ChallengeProgress> = {
                    ...get().progress,
                    [key]: {
                        challengeId: key,
                        stars: Math.max(previous.stars, verdict.stars) as ChallengeProgress['stars'],
                        attempts: attempt,
                        hintsUsed,
                        bestScore: Math.max(previous.bestScore, verdict.rubric.total),
                    },
                };

                set({ verdict, status: 'ready', progress: updated });
                StorageService.save(STORAGE_KEYS.CHALLENGES, updated);

                if (ref.kind === 'catalog' || ref.kind === 'authored') return;

                const record = practiceFor(get().practice, key);
                const solved = verdict.stage === 'passed';
                const inTime = session !== null && !session.expired;

                const practice: Record<string, PracticeRecord> = {
                    ...get().practice,
                    [key]: {
                        id: key,
                        attempts: record.attempts + 1,
                        solved: record.solved || solved,
                        bestSeconds: solved && inTime ? lowerOf(record.bestSeconds, session.elapsedSec) : record.bestSeconds,
                        bestCostUsd: solved ? lowerOf(record.bestCostUsd, verdict.metrics.costMonth) : record.bestCostUsd,
                        bestStars: Math.max(record.bestStars, verdict.stars) as PracticeRecord['bestStars'],
                    },
                };

                set({ practice });
                StorageService.save(STORAGE_KEYS.PRACTICE, practice);
            })
            .catch((error: Error) => {
                if (requestId !== latestRequest) return;
                set({ status: 'error', error: error.message });
            });
    },

    tick: () => {
        const { session, ref } = get();
        if (!session || !ref) return;

        const elapsedSec = Math.floor((Date.now() - session.startedAt) / 1000);
        if (elapsedSec === session.elapsedSec) return;

        const interview = ref.kind === 'interview' ? interviewById(ref.sessionId) : undefined;
        const stage = interview ? stageIndexAt(interview, elapsedSec) : session.stage;

        set({ session: { ...session, elapsedSec, stage, expired: elapsedSec >= session.limitSec } });

        if (!interview || stage === session.stage || ref.kind !== 'interview') return;

        applyStageScale(interview, session.stage, stage);
        const next: ChallengeRef = { ...ref, stage };
        set({ ref: next, active: resolveChallenge(next) });
    },

    refreshAuthored: () => set({ authored: loadAuthored() }),

    exportProgress: () =>
        buildProgressBundle(get().progress, get().practice, new Date().toISOString()),

    importProgress: (raw) => {
        const bundle = readProgressBundle(raw);
        if (!bundle) return false;

        const progress = mergeChallengeProgress(get().progress, bundle.challenges);
        const practice = mergePracticeRecords(get().practice, bundle.practice);

        set({ progress, practice });
        StorageService.save(STORAGE_KEYS.CHALLENGES, progress);
        StorageService.save(STORAGE_KEYS.PRACTICE, practice);

        return true;
    },
}));
