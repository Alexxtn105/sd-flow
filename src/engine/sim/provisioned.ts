import type { ComponentParams } from '../types/component';
import { FREE_IOPS } from './constants';

function numberOf(params: ComponentParams, key: string): number | null {
    const value = params[key];

    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function provisionedIops(params: ComponentParams): number {
    return Math.max(0, numberOf(params, 'provisionedIops') ?? 0);
}

export function billableIops(params: ComponentParams): number {
    return Math.max(0, provisionedIops(params) - FREE_IOPS);
}
