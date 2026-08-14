import type { Challenge } from '../../engine/challenges/types';
import { adClicks } from './adClicks';
import { flashSale } from './flashSale';
import { geoMatching } from './geoMatching';
import { globalFeed } from './globalFeed';
import { imageResize } from './imageResize';
import { jobScheduler } from './jobScheduler';
import { leaderboard } from './leaderboard';
import { matchingEngine } from './matchingEngine';
import { liveStreaming } from './liveStreaming';
import { multiRegion } from './multiRegion';
import { notifications } from './notifications';
import { observability } from './observability';
import { objectStorage } from './objectStorage';
import { pastebin } from './pastebin';
import { payments } from './payments';
import { rateLimiter } from './rateLimiter';
import { shopCatalog } from './shopCatalog';
import { staticSite } from './staticSite';
import { twitterFeed } from './twitterFeed';
import { urlShortener } from './urlShortener';
import { videoHosting } from './videoHosting';

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
    payments,
    adClicks,
    jobScheduler,
    leaderboard,
    observability,
    geoMatching,
    multiRegion,
    matchingEngine,
    objectStorage,
    globalFeed,
    liveStreaming,
];

export function challengeById(id: string): Challenge | undefined {
    return CHALLENGES.find((challenge) => challenge.id === id);
}

export function challengesByLevel(): { level: number; items: Challenge[] }[] {
    const levels = [...new Set(CHALLENGES.map((challenge) => challenge.level))].sort((left, right) => left - right);
    return levels.map((level) => ({ level, items: CHALLENGES.filter((challenge) => challenge.level === level) }));
}
