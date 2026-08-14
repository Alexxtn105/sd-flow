import type { Challenge } from '../../engine/challenges/types';
import { staticSite } from './staticSite';

export const CHALLENGES: Challenge[] = [staticSite];

export function challengeById(id: string): Challenge | undefined {
    return CHALLENGES.find((challenge) => challenge.id === id);
}

export function challengesByLevel(): { level: number; items: Challenge[] }[] {
    const levels = [...new Set(CHALLENGES.map((challenge) => challenge.level))].sort((left, right) => left - right);
    return levels.map((level) => ({ level, items: CHALLENGES.filter((challenge) => challenge.level === level) }));
}
