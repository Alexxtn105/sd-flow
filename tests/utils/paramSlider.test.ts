import { describe, expect, it } from 'vitest';
import {
    fromSlider,
    normaliseParamValue,
    sliderScaleOf,
    SLIDER_STEPS,
    toSlider,
} from '../../src/utils/paramSlider';
import type { ParamField } from '../../src/engine/types/component';

function numberField(extra: Partial<Extract<ParamField, { kind: 'number' }>>): ParamField {
    return { kind: 'number', section: 'capacity', ...extra } as ParamField;
}

describe('шкала слайдера', () => {
    it('не появляется там, где границ нет', () => {
        expect(sliderScaleOf(undefined, 1)).toBeNull();
        expect(sliderScaleOf({ kind: 'boolean', section: 'behaviour' } as ParamField, 1)).toBeNull();
        expect(sliderScaleOf(numberField({ min: 1 }), 1)).toBeNull();
        expect(sliderScaleOf(numberField({ min: 5, max: 5 }), 5)).toBeNull();
    });

    it('линейная для узкого диапазона, логарифмическая для широкого', () => {
        expect(sliderScaleOf(numberField({ min: 1, max: 30 }), 4)?.log).toBe(false);
        expect(sliderScaleOf(numberField({ min: 1, max: 1e9 }), 1000)?.log).toBe(true);
        expect(sliderScaleOf(numberField({ min: 0, max: 1e9 }), 1000)?.log).toBe(false);
    });

    it('растягивается до значения, вышедшего за границы поля', () => {
        const scale = sliderScaleOf(numberField({ min: 1, max: 10 }), 42);

        expect(scale?.max).toBe(42);
        expect(toSlider(scale!, 42)).toBe(SLIDER_STEPS);
    });

    it('переводит значение в позицию и обратно', () => {
        const scale = sliderScaleOf(numberField({ min: 0, max: 100, step: 1 }), 50)!;

        expect(toSlider(scale, 0)).toBe(0);
        expect(toSlider(scale, 50)).toBe(SLIDER_STEPS / 2);
        expect(toSlider(scale, 100)).toBe(SLIDER_STEPS);
        expect(fromSlider(scale, SLIDER_STEPS / 2)).toBe(50);
        expect(fromSlider(scale, 0)).toBe(0);
        expect(fromSlider(scale, SLIDER_STEPS)).toBe(100);
    });

    it('на логарифмической шкале середина — геометрическое среднее', () => {
        const scale = sliderScaleOf(numberField({ min: 1, max: 1e6 }), 1000)!;

        expect(fromSlider(scale, SLIDER_STEPS / 2)).toBeCloseTo(1000, 0);
        expect(toSlider(scale, 1000)).toBe(SLIDER_STEPS / 2);
    });

    it('округляет к шагу поля и не выходит за границы', () => {
        const scale = sliderScaleOf(numberField({ min: 0, max: 1, step: 0.01 }), 0.5)!;
        const value = fromSlider(scale, 333);

        expect(value).toBe(Number(value.toFixed(2)));
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(fromSlider(scale, SLIDER_STEPS + 500)).toBe(1);
        expect(fromSlider(scale, -100)).toBe(0);
    });

    it('без объявленного шага значение остаётся целым', () => {
        const counted = sliderScaleOf(numberField({ min: 1, max: 40 }), 3)!;

        for (const position of [1, 7, 123, 456, 789, SLIDER_STEPS - 1]) {
            const value = fromSlider(counted, position);

            expect(Number.isInteger(value)).toBe(true);
        }

        const wide = sliderScaleOf(numberField({ min: 1, max: 5_000_000_000 }), 2_000_000)!;

        expect(Number.isInteger(fromSlider(wide, 421))).toBe(true);
    });

    it('введённое руками значение округляется там, где шага нет', () => {
        expect(normaliseParamValue(numberField({ min: 1, max: 40 }), 3.5)).toBe(4);
        expect(normaliseParamValue(numberField({ min: 1, max: 40 }), 3.2)).toBe(3);
        expect(normaliseParamValue(numberField({ min: 0, max: 1, step: 0.01 }), 0.85)).toBe(0.85);
        expect(normaliseParamValue(numberField({ min: 1, max: 64, step: 0.25 }), 0.5)).toBe(0.5);
        expect(normaliseParamValue(undefined, 3.5)).toBe(3.5);
    });

    it('позиция не выпадает за пределы даже для значения вне шкалы', () => {
        const scale = { min: 10, max: 20, log: false, step: 1 };

        expect(toSlider(scale, 5)).toBe(0);
        expect(toSlider(scale, 500)).toBe(SLIDER_STEPS);
    });
});
