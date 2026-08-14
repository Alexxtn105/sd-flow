import type { Challenge } from '../../engine/challenges/types';
import { flashSale } from './flashSale';
import { imageResize } from './imageResize';
import { multiRegion } from './multiRegion';
import { notifications } from './notifications';
import { pastebin } from './pastebin';
import { rateLimiter } from './rateLimiter';
import { shopCatalog } from './shopCatalog';
import { staticSite } from './staticSite';
import { twitterFeed } from './twitterFeed';
import { urlShortener } from './urlShortener';
import { videoHosting } from './videoHosting';
import { advancedChallenges } from './advanced';

export const CHALLENGES: Challenge[] = [
    staticSite,
    urlShortener,
    pastebin,
    imageResize,
    rateLimiter,
    twitterFeed,
    notifications,
    shopCatalog,
    videoHosting,
    flashSale,
    multiRegion,
    ...advancedChallenges,
];

export function challengeById(id: string): Challenge | undefined {
    return CHALLENGES.find((challenge) => challenge.id === id);
}

export function challengesByLevel(): { level: number; items: Challenge[] }[] {
    const levels = [...new Set(CHALLENGES.map((challenge) => challenge.level))].sort((left, right) => left - right);
    return levels.map((level) => ({ level, items: CHALLENGES.filter((challenge) => challenge.level === level) }));
}
