import type { ParamField, ParamValue } from '../engine/types/component';

export type RangeStatus = 'ok' | 'warn' | 'error';

export function rangeStatus(value: ParamValue, field: ParamField | undefined): RangeStatus {
    if (field?.kind !== 'number' || typeof value !== 'number') return 'ok';

    if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        return 'error';
    }

    if (field.realistic && (value < field.realistic.min || value > field.realistic.max)) return 'warn';

    return 'ok';
}
