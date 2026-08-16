import type { ParamValue } from '../engine/types/component';
import type { SliderScale } from './paramSlider';
import { SLIDER_STEPS, toSlider } from './paramSlider';

const NUMERIC_TOLERANCE = 1e-9;

export function isDefaultValue(value: ParamValue, defaultValue: ParamValue | undefined): boolean {
    if (defaultValue === undefined) return true;

    if (typeof value === 'number' && typeof defaultValue === 'number') {
        return Math.abs(value - defaultValue) <= Math.max(Math.abs(defaultValue), 1) * NUMERIC_TOLERANCE;
    }

    return value === defaultValue;
}

export function defaultMarkPercent(scale: SliderScale, defaultValue: ParamValue | undefined): number | null {
    if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) return null;
    if (defaultValue < scale.min || defaultValue > scale.max) return null;

    return (toSlider(scale, defaultValue) / SLIDER_STEPS) * 100;
}

export function formatDefault(value: ParamValue | undefined): string {
    if (value === undefined) return '';
    if (typeof value === 'boolean') return value ? '✓' : '✕';
    if (typeof value === 'number') return String(Number(value.toPrecision(6)));

    return String(value);
}
