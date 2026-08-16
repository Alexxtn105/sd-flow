import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import {
    applyInstancePreset,
    detectInstancePreset,
    INSTANCE_PRESETS,
    PRESET_SCALE,
    supportsInstancePreset,
} from '../../src/engine/instancePresets';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const BOX = { cpuCores: 8, memoryGb: 32, costPerInstanceHour: 0.4, instances: 3, region: 'eu' };

describe('пресеты инстанса', () => {
    it('доступны блокам, у которых есть размер, и недоступны прочим', () => {
        expect(supportsInstancePreset(BOX)).toBe(true);
        expect(supportsInstancePreset(registry.getDefaultParams('postgres'))).toBe(true);
        expect(supportsInstancePreset({ instances: 3 })).toBe(false);
        expect(supportsInstancePreset(registry.getDefaultParams('multi-region-policy'))).toBe(false);
    });

    it('масштабируют только размерные параметры', () => {
        const patch = applyInstancePreset(BOX, 'l');

        expect(patch).toEqual({ cpuCores: 16, memoryGb: 64, costPerInstanceHour: 0.8 });
        expect(patch.instances).toBeUndefined();
        expect(patch.region).toBeUndefined();
    });

    it('держат число ядер целым и не меньше одного', () => {
        expect(applyInstancePreset({ cpuCores: 2, memoryGb: 4 }, 'xs')).toEqual({ cpuCores: 1, memoryGb: 1 });
        expect(applyInstancePreset({ cpuCores: 1, memoryGb: 2 }, 'xs').cpuCores).toBe(1);
    });

    it('узнают свой же пресет обратно', () => {
        for (const preset of INSTANCE_PRESETS) {
            const patched = { ...BOX, ...applyInstancePreset(BOX, preset) };

            expect(detectInstancePreset(BOX, patched)).toBe(preset);
        }
    });

    it('дефолтные параметры блока — это пресет M', () => {
        const defaults = registry.getDefaultParams('postgres');

        expect(detectInstancePreset(defaults, defaults)).toBe('m');
        expect(PRESET_SCALE.m).toBe(1);
    });

    it('ручная правка размера даёт «свой» пресет', () => {
        expect(detectInstancePreset(BOX, { ...BOX, cpuCores: 7 })).toBeNull();
        expect(detectInstancePreset({ instances: 1 }, { instances: 1 })).toBeNull();
    });

    it('каждый размер переведён на оба языка', () => {
        for (const preset of INSTANCE_PRESETS) {
            expect(ruCommon.inspector.presetSize, `ru: ${preset}`).toHaveProperty(preset);
            expect(enCommon.inspector.presetSize, `en: ${preset}`).toHaveProperty(preset);
        }

        expect(ruCommon.inspector).toHaveProperty('presetCustom');
        expect(enCommon.inspector).toHaveProperty('presetCustom');
    });
});
