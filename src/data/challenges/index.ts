import type { Challenge } from '../../engine/challenges/types';
import { imageResize } from './imageResize';
import { pastebin } from './pastebin';
import { staticSite } from './staticSite';
import { urlShortener } from './urlShortener';

export const CHALLENGES: Challenge[] = [staticSite, urlShortener, pastebin, imageResize];

export function challengeById(id: string): Challenge | undefined {
    return CHALLENGES.find((challenge) => challenge.id === id);
}

export function challengesByLevel(): { level: number; items: Challenge[] }[] {
    const levels = [...new Set(CHALLENGES.map((challenge) => challenge.level))].sort((left, right) => left - right);
    return levels.map((level) => ({ level, items: CHALLENGES.filter((challenge) => challenge.level === level) }));
}
