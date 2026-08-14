import { create } from 'zustand';
import type { ChallengeProgress, ChallengeVerdict } from '../engine/challenges/types';
import type { SchemeV1 } from '../engine/types/scheme';
import { runAcceptance } from '../services/simulationService';
import StorageService, { STORAGE_KEYS } from '../services/storageService';

export type ChallengeStatus = 'idle' | 'running' | 'ready' | 'error';

export interface ChallengeState {
    activeId: string | null;
    status: ChallengeStatus;
    error: string | null;
    verdict: ChallengeVerdict | null;
    hintsUsed: number[];
    progress: Record<string, ChallengeProgress>;
    open: (challengeId: string) => void;
    close: () => void;
    revealHint: (index: number) => void;
    submit: (scheme: SchemeV1) => void;
}

function loadProgress(): Record<string, ChallengeProgress> {
    return StorageService.load<Record<string, ChallengeProgress>>(STORAGE_KEYS.CHALLENGES) ?? {};
}

function progressFor(progress: Record<string, ChallengeProgress>, challengeId: string): ChallengeProgress {
    return progress[challengeId] ?? { challengeId, stars: 0, attempts: 0, hintsUsed: [], bestScore: 0 };
}

let latestRequest = 0;

export const useChallengeStore = create<ChallengeState>((set, get) => ({
    activeId: null,
    status: 'idle',
    error: null,
    verdict: null,
    hintsUsed: [],
    progress: loadProgress(),

    open: (challengeId) => {
        const known = progressFor(get().progress, challengeId);
        set({ activeId: challengeId, status: 'idle', error: null, verdict: null, hintsUsed: known.hintsUsed });
    },

    close: () => set({ activeId: null, status: 'idle', error: null, verdict: null, hintsUsed: [] }),

    revealHint: (index) => {
        const { hintsUsed, activeId, progress } = get();
        if (hintsUsed.includes(index)) return;

        const next = [...hintsUsed, index].sort((left, right) => left - right);
        set({ hintsUsed: next });

        if (!activeId) return;

        const updated = { ...progress, [activeId]: { ...progressFor(progress, activeId), hintsUsed: next } };
        set({ progress: updated });
        StorageService.save(STORAGE_KEYS.CHALLENGES, updated);
    },

    submit: (scheme) => {
        const { activeId, hintsUsed, progress } = get();
        if (!activeId) return;

        const attempt = progressFor(progress, activeId).attempts + 1;
        latestRequest += 1;
        const requestId = latestRequest;
        set({ status: 'running', error: null });

        runAcceptance({ challengeId: activeId, scheme, attempt, hintsUsed })
            .then((verdict) => {
                if (requestId !== latestRequest) return;

                const previous = progressFor(get().progress, activeId);
                const updated: Record<string, ChallengeProgress> = {
                    ...get().progress,
                    [activeId]: {
                        challengeId: activeId,
                        stars: Math.max(previous.stars, verdict.stars) as ChallengeProgress['stars'],
                        attempts: attempt,
                        hintsUsed,
                        bestScore: Math.max(previous.bestScore, verdict.rubric.total),
                    },
                };

                set({ verdict, status: 'ready', progress: updated });
                StorageService.save(STORAGE_KEYS.CHALLENGES, updated);
            })
            .catch((error: Error) => {
                if (requestId !== latestRequest) return;
                set({ status: 'error', error: error.message });
            });
    },
}));
