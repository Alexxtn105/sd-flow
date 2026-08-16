import type { ChallengeProgress } from '../engine/challenges/types';
import type { PracticeRecord } from '../engine/practice/types';

export const PROGRESS_FORMAT = 'sd-flow-progress';
export const PROGRESS_VERSION = 1;

export interface ProgressBundle {
    format: string;
    version: number;
    exportedAt: string;
    challenges: Record<string, ChallengeProgress>;
    practice: Record<string, PracticeRecord>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function numberOf(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function starsOf(value: unknown): ChallengeProgress['stars'] {
    const stars = Math.round(numberOf(value));
    return (stars < 0 ? 0 : stars > 3 ? 3 : stars) as ChallengeProgress['stars'];
}

function optionalNumberOf(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function challengeProgressOf(key: string, value: unknown): ChallengeProgress | null {
    if (!isRecord(value)) return null;

    const hints = Array.isArray(value.hintsUsed) ? value.hintsUsed.filter((item) => typeof item === 'number') : [];

    return {
        challengeId: key,
        stars: starsOf(value.stars),
        attempts: numberOf(value.attempts),
        hintsUsed: [...hints].sort((left, right) => left - right),
        bestScore: numberOf(value.bestScore),
    };
}

function practiceRecordOf(key: string, value: unknown): PracticeRecord | null {
    if (!isRecord(value)) return null;

    return {
        id: key,
        attempts: numberOf(value.attempts),
        solved: value.solved === true,
        bestSeconds: optionalNumberOf(value.bestSeconds),
        bestCostUsd: optionalNumberOf(value.bestCostUsd),
        bestStars: starsOf(value.bestStars),
    };
}

export function buildProgressBundle(
    challenges: Record<string, ChallengeProgress>,
    practice: Record<string, PracticeRecord>,
    exportedAt: string,
): ProgressBundle {
    return { format: PROGRESS_FORMAT, version: PROGRESS_VERSION, exportedAt, challenges, practice };
}

export function readProgressBundle(raw: unknown): ProgressBundle | null {
    if (!isRecord(raw) || raw.format !== PROGRESS_FORMAT) return null;
    if (numberOf(raw.version) > PROGRESS_VERSION) return null;

    const challenges: Record<string, ChallengeProgress> = {};
    const practice: Record<string, PracticeRecord> = {};

    for (const [key, value] of Object.entries(isRecord(raw.challenges) ? raw.challenges : {})) {
        const parsed = challengeProgressOf(key, value);
        if (parsed) challenges[key] = parsed;
    }

    for (const [key, value] of Object.entries(isRecord(raw.practice) ? raw.practice : {})) {
        const parsed = practiceRecordOf(key, value);
        if (parsed) practice[key] = parsed;
    }

    return {
        format: PROGRESS_FORMAT,
        version: numberOf(raw.version, PROGRESS_VERSION),
        exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
        challenges,
        practice,
    };
}

function lowerOf(current: number | null, candidate: number | null): number | null {
    if (current === null) return candidate;
    if (candidate === null) return current;

    return Math.min(current, candidate);
}

export function mergeChallengeProgress(
    current: Record<string, ChallengeProgress>,
    incoming: Record<string, ChallengeProgress>,
): Record<string, ChallengeProgress> {
    const merged: Record<string, ChallengeProgress> = { ...current };

    for (const [key, value] of Object.entries(incoming)) {
        const known = merged[key];

        merged[key] = known
            ? {
                  challengeId: key,
                  stars: Math.max(known.stars, value.stars) as ChallengeProgress['stars'],
                  attempts: Math.max(known.attempts, value.attempts),
                  hintsUsed: [...new Set([...known.hintsUsed, ...value.hintsUsed])].sort(
                      (left, right) => left - right,
                  ),
                  bestScore: Math.max(known.bestScore, value.bestScore),
              }
            : value;
    }

    return merged;
}

export function mergePracticeRecords(
    current: Record<string, PracticeRecord>,
    incoming: Record<string, PracticeRecord>,
): Record<string, PracticeRecord> {
    const merged: Record<string, PracticeRecord> = { ...current };

    for (const [key, value] of Object.entries(incoming)) {
        const known = merged[key];

        merged[key] = known
            ? {
                  id: key,
                  attempts: Math.max(known.attempts, value.attempts),
                  solved: known.solved || value.solved,
                  bestSeconds: lowerOf(known.bestSeconds, value.bestSeconds),
                  bestCostUsd: lowerOf(known.bestCostUsd, value.bestCostUsd),
                  bestStars: Math.max(known.bestStars, value.bestStars) as PracticeRecord['bestStars'],
              }
            : value;
    }

    return merged;
}
