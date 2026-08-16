import type { CacheProfile, ComponentParams } from '../types/component';
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

function clampRatio(value: number): number {
    return Math.max(0, Math.min(1, value));
}

export function resolveHitRatio(
    params: ComponentParams,
    computed: number | null,
    warmth: number,
): number | null {
    const override = params.hitRatioOverride;
    const manual = typeof override === 'number' ? clampRatio(override) : null;
    const mode = String(params.hitRatioMode ?? (computed === null ? 'manual' : 'auto'));
    const base = mode === 'manual' && manual !== null ? manual : computed;

    return base === null ? null : clampRatio(base * warmth);
}

export function residencyRatio(uniqueKeys: number, residentKeys: number, alpha: number): number {
    if (residentKeys >= uniqueKeys) return 1;

    return generalizedHarmonic(residentKeys, alpha) / generalizedHarmonic(uniqueKeys, alpha);
}

export function ttlAwareRatio(
    uniqueKeys: number,
    residentKeys: number,
    alpha: number,
    readRps: number,
    ttlSec: number,
): number {
    const resident = Math.max(1, Math.min(residentKeys, uniqueKeys));
    const ceiling = residencyRatio(uniqueKeys, residentKeys, alpha);

    if (ttlSec <= 0 || readRps <= 0) return ceiling;

    const totalWeight = generalizedHarmonic(uniqueKeys, alpha);
    const arrivals = readRps * ttlSec;
    const head = Math.min(resident, HEAD_TERMS);

    let ratio = 0;
    for (let key = 1; key <= head; key += 1) {
        const share = Math.pow(key, -alpha) / totalWeight;
        ratio += share * (1 - Math.exp(-arrivals * share));
    }

    if (resident > head) {
        const boundary = Math.min(resident, Math.max(head, Math.pow(arrivals / totalWeight, 1 / alpha)));
        const hotWeight = generalizedHarmonic(boundary, alpha) - generalizedHarmonic(head, alpha);
        const coldWeight = generalizedHarmonic(resident, 2 * alpha) - generalizedHarmonic(boundary, 2 * alpha);

        ratio += hotWeight / totalWeight;
        ratio += (arrivals * Math.max(coldWeight, 0)) / (totalWeight * totalWeight);
    }

    return Math.max(0, Math.min(ratio, ceiling));
}

export function cacheHitRatio(profile: CacheProfile, writeShare: number, readRps: number): CacheResult {
    const entryBytes = Math.max(profile.entryBytes, 1);
    const residentKeys = Math.max(1, Math.floor(profile.capacityBytes / entryBytes));
    const uniqueKeys = Math.max(1, profile.uniqueKeys);
    const alpha = Math.max(profile.zipfAlpha, 0.01);

    const totalWeight = generalizedHarmonic(uniqueKeys, alpha);
    const baseRatio = ttlAwareRatio(uniqueKeys, residentKeys, alpha, readRps, profile.ttlSec);

    const invalidationFactor = 1 - Math.min(writeShare, 1);
    const hitRatio = Math.max(0, Math.min(1, baseRatio * invalidationFactor));

    return {
        hitRatio,
        residentKeys,
        hotKeyShare: 1 / totalWeight,
        explain: explain(
            'Σ_k≤M p_k · (1 − e^(−λ_read · p_k · TTL)) × (1 − writeShare)',
            {
                M: residentKeys,
                N: uniqueKeys,
                alpha,
                readRps,
                ttlSec: profile.ttlSec,
                writeShare,
            },
            hitRatio,
            'ratio',
        ),
    };
}
