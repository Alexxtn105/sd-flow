import { describe, expect, it } from 'vitest';
import { defaultMarkPercent, formatDefault, isDefaultValue } from '../../src/utils/paramDefault';
import { sliderScaleOf } from '../../src/utils/paramSlider';
import type { ParamField } from '../../src/engine/types/component';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

const linear: ParamField = { kind: 'number', section: 'scale', min: 0, max: 100 };
const logarithmic: ParamField = { kind: 'number', section: 'scale', min: 1, max: 1_000_000 };

describe('значение по умолчанию', () => {
    it('узнаёт нетронутый параметр', () => {
        expect(isDefaultValue(4, 4)).toBe(true);
        expect(isDefaultValue(4.000000000001, 4)).toBe(true);
        expect(isDefaultValue(5, 4)).toBe(false);
        expect(isDefaultValue('lww', 'lww')).toBe(true);
        expect(isDefaultValue(true, false)).toBe(false);
    });

    it('без дефолта считает параметр нетронутым', () => {
        expect(isDefaultValue(42, undefined)).toBe(true);
    });

    it('ставит отметку там, где стоит дефолт', () => {
        const scale = sliderScaleOf(linear, 50);
        expect(scale).not.toBeNull();
        expect(defaultMarkPercent(scale!, 25)).toBeCloseTo(25, 5);
        expect(defaultMarkPercent(scale!, 0)).toBe(0);
        expect(defaultMarkPercent(scale!, 100)).toBe(100);
    });

    it('на логарифмической шкале отметка тоже логарифмическая', () => {
        const scale = sliderScaleOf(logarithmic, 1000);
        expect(scale?.log).toBe(true);
        expect(defaultMarkPercent(scale!, 1000)).toBeCloseTo(50, 1);
    });

    it('прячет отметку, если дефолт вне шкалы', () => {
        const scale = sliderScaleOf(linear, 50);
        expect(defaultMarkPercent(scale!, 500)).toBeNull();
        expect(defaultMarkPercent(scale!, undefined)).toBeNull();
        expect(defaultMarkPercent(scale!, 'auto')).toBeNull();
    });

    it('растянутая под текущее значение шкала не теряет отметку', () => {
        const scale = sliderScaleOf(linear, 400);
        expect(scale?.max).toBe(400);
        expect(defaultMarkPercent(scale!, 100)).toBeCloseTo(25, 5);
    });

    it('подписывает дефолт человекочитаемо', () => {
        expect(formatDefault(0.30000000000000004)).toBe('0.3');
        expect(formatDefault(true)).toBe('✓');
        expect(formatDefault('auto')).toBe('auto');
        expect(formatDefault(undefined)).toBe('');
    });

    it('подписи переведены на оба языка', () => {
        expect(ruCommon.inspector).toHaveProperty('defaultValue');
        expect(enCommon.inspector).toHaveProperty('defaultValue');
        expect(ruCommon.inspector).toHaveProperty('resetToDefault');
        expect(enCommon.inspector).toHaveProperty('resetToDefault');
    });
});
