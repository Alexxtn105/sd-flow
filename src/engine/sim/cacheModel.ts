import type { CacheProfile } from '../types/component';
import { explain } from './resources';
import type { Explain } from '../types/component';

const HEAD_TERMS = 1000;

export interface CacheResult {
    hitRatio: number;
    residentKeys: number;
    hotKeyShare: number;
    explain: Explain;
}

export function generalizedHarmonic(count: number, alpha: number): number {
    const n = Math.max(1, Math.floor(count));
    const head = Math.min(n, HEAD_TERMS);

    let sum = 0;
    for (let k = 1; k <= head; k += 1) sum += Math.pow(k, -alpha);

    if (n <= HEAD_TERMS) return sum;

    if (Math.abs(alpha - 1) < 1e-9) return sum + Math.log(n / head);

    return sum + (Math.pow(n, 1 - alpha) - Math.pow(head, 1 - alpha)) / (1 - alpha);
}

export function cacheHitRatio(profile: CacheProfile, writeShare: number, readRps: number): CacheResult {
    const entryBytes = Math.max(profile.entryBytes, 1);
    const residentKeys = Math.max(1, Math.floor(profile.capacityBytes / entryBytes));
    const uniqueKeys = Math.max(1, profile.uniqueKeys);
    const alpha = Math.max(profile.zipfAlpha, 0.01);

    const totalWeight = generalizedHarmonic(uniqueKeys, alpha);
    const residentWeight = generalizedHarmonic(Math.min(residentKeys, uniqueKeys), alpha);
    const baseRatio = residentKeys >= uniqueKeys ? 1 : residentWeight / totalWeight;

    const invalidationFactor = 1 - Math.min(writeShare, 1);

    const workingKeys = Math.min(residentKeys, uniqueKeys);
    const reaccessIntervalSec = readRps > 0 ? workingKeys / readRps : Number.POSITIVE_INFINITY;
    const ttlFactor =
        profile.ttlSec > 0 && Number.isFinite(reaccessIntervalSec)
            ? 1 - Math.exp(-profile.ttlSec / Math.max(reaccessIntervalSec, 1e-9))
            : 1;

    const hitRatio = Math.max(0, Math.min(1, baseRatio * invalidationFactor * ttlFactor));

    return {
        hitRatio,
        residentKeys,
        hotKeyShare: 1 / totalWeight,
        explain: explain(
            'H(M, α) / H(N, α) × (1 − writeShare) × ttlFactor',
            {
                M: residentKeys,
                N: uniqueKeys,
                alpha,
                writeShare,
                ttlFactor,
            },
            hitRatio,
            'ratio',
        ),
    };
}
