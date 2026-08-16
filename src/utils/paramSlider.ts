import type { ParamField } from '../engine/types/component';

export const SLIDER_STEPS = 1000;

const LOG_SPAN_RATIO = 1000;

export interface SliderScale {
    min: number;
    max: number;
    log: boolean;
    step: number | null;
}

export function sliderScaleOf(field: ParamField | undefined, value: number): SliderScale | null {
    if (field?.kind !== 'number') return null;
    if (field.min === undefined || field.max === undefined) return null;
    if (!Number.isFinite(field.min) || !Number.isFinite(field.max) || field.max <= field.min) return null;

    const min = Math.min(field.min, value);
    const max = Math.max(field.max, value);
    const log = min > 0 && max / min >= LOG_SPAN_RATIO;

    return { min, max, log, step: field.step ?? null };
}

export function toSlider(scale: SliderScale, value: number): number {
    const bounded = Math.min(Math.max(value, scale.min), scale.max);
    const share = scale.log
        ? (Math.log(bounded) - Math.log(scale.min)) / (Math.log(scale.max) - Math.log(scale.min))
        : (bounded - scale.min) / (scale.max - scale.min);

    return Math.round(share * SLIDER_STEPS);
}

function roundToStep(value: number, step: number | null): number {
    if (step === null || step <= 0) return Math.round(value);

    const rounded = Math.round(value / step) * step;
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)));

    return Number(rounded.toFixed(decimals));
}

export function fromSlider(scale: SliderScale, position: number): number {
    const share = Math.min(Math.max(position, 0), SLIDER_STEPS) / SLIDER_STEPS;
    const raw = scale.log
        ? Math.exp(Math.log(scale.min) + share * (Math.log(scale.max) - Math.log(scale.min)))
        : scale.min + share * (scale.max - scale.min);

    return Math.min(Math.max(roundToStep(raw, scale.step), scale.min), scale.max);
}
