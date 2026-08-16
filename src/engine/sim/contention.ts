import type { ComponentParams, ResourceLimit } from '../types/component';
import { resourceLimit } from './resources';

export const KEY_SERIALIZATION_RESOURCE = 'key-serialization';

export const RMW_WINDOW_FACTOR = 2;
export const MAX_WRITE_ATTEMPTS = 5;

const DEFAULT_KEY_COUNT = 1e6;
const KEY_COUNT_PARAMS = ['rowCount', 'uniqueKeys', 'documentCount', 'itemCount', 'keyCount'];

export function effectiveKeys(params: ComponentParams): number {
    for (const key of KEY_COUNT_PARAMS) {
        const value = params[key];
        if (typeof value === 'number' && value > 0) return value;
    }

    return DEFAULT_KEY_COUNT;
}

export function concurrencyControlOf(params: ComponentParams): string {
    return String(params.concurrencyControl ?? 'none');
}

export function rmwWindowSec(serviceSec: number): number {
    return Math.max(serviceSec, 0) * RMW_WINDOW_FACTOR;
}

export function collisionProbability(writeRpsPerKey: number, windowSec: number): number {
    if (writeRpsPerKey <= 0 || windowSec <= 0) return 0;

    return 1 - Math.exp(-writeRpsPerKey * windowSec);
}

export function retriesPerWrite(collision: number): number {
    if (collision <= 0) return 0;

    const attempts = collision >= 1 ? MAX_WRITE_ATTEMPTS : 1 / (1 - collision);

    return Math.min(attempts, MAX_WRITE_ATTEMPTS) - 1;
}

export function contentionRetryShare(
    params: ComponentParams,
    writeRps: number,
    serviceSec: number,
): number {
    if (concurrencyControlOf(params) !== 'optimistic' || writeRps <= 0) return 0;

    const keys = effectiveKeys(params);
    const windowSec = rmwWindowSec(serviceSec);

    return retriesPerWrite(collisionProbability(writeRps / keys, windowSec));
}

export function keySerializationLimit(
    params: ComponentParams,
    writeShare: number,
    serviceSec: number,
): ResourceLimit | null {
    if (concurrencyControlOf(params) !== 'pessimistic') return null;

    const lockSec = rmwWindowSec(serviceSec);
    if (lockSec <= 0 || writeShare <= 0) return null;

    const keys = effectiveKeys(params);

    return resourceLimit(
        KEY_SERIALIZATION_RESOURCE,
        keys / (writeShare * lockSec),
        'keys / (writeShare × T_lock)',
        { keys, writeShare, lockSec },
    );
}
