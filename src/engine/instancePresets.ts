import type { ComponentParams } from './types/component';

export type InstancePreset = 'xs' | 's' | 'm' | 'l' | 'xl';

export const INSTANCE_PRESETS: InstancePreset[] = ['xs', 's', 'm', 'l', 'xl'];

export const PRESET_SCALE: Record<InstancePreset, number> = {
    xs: 0.25,
    s: 0.5,
    m: 1,
    l: 2,
    xl: 4,
};

const SCALED_PARAMS = [
    'cpuCores',
    'memoryGb',
    'bufferPoolGb',
    'networkMbps',
    'costPerInstanceHour',
];

const INTEGER_PARAMS = new Set(['cpuCores']);
const MIN_PRESET_PARAMS = 2;
const MATCH_TOLERANCE = 0.02;

function scalableKeys(defaults: ComponentParams): string[] {
    return SCALED_PARAMS.filter((key) => typeof defaults[key] === 'number' && (defaults[key] as number) > 0);
}

export function supportsInstancePreset(defaults: ComponentParams): boolean {
    return scalableKeys(defaults).length >= MIN_PRESET_PARAMS;
}

function scaleValue(key: string, base: number, factor: number): number {
    const scaled = base * factor;
    if (INTEGER_PARAMS.has(key)) return Math.max(1, Math.round(scaled));

    return Number(scaled.toPrecision(4));
}

export function applyInstancePreset(defaults: ComponentParams, preset: InstancePreset): ComponentParams {
    const factor = PRESET_SCALE[preset];
    const patch: ComponentParams = {};

    for (const key of scalableKeys(defaults)) {
        patch[key] = scaleValue(key, defaults[key] as number, factor);
    }

    return patch;
}

export function detectInstancePreset(
    defaults: ComponentParams,
    params: ComponentParams,
): InstancePreset | null {
    const keys = scalableKeys(defaults);
    if (keys.length < MIN_PRESET_PARAMS) return null;

    for (const preset of INSTANCE_PRESETS) {
        const patch = applyInstancePreset(defaults, preset);
        const matches = keys.every((key) => {
            const expected = patch[key] as number;
            const actual = params[key];

            return typeof actual === 'number' && Math.abs(actual - expected) <= expected * MATCH_TOLERANCE;
        });

        if (matches) return preset;
    }

    return null;
}
