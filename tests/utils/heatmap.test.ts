import { describe, expect, it } from 'vitest';
import type { ProbeHeatmap } from '../../src/engine/sim/types';
import { DEFAULT_HEAT_ALARM, DEFAULT_HEAT_WARN, heatLevel, heatScale, heatValueOf } from '../../src/utils/heatmap';

const THRESHOLDS = { warn: 0.7, alarm: 0.9 };

function heatmap(): ProbeHeatmap {
    return {
        metric: 'utilization',
        scope: 'scheme',
        warn: 0.7,
        alarm: 0.9,
        peak: 0.95,
        hottestNodeId: 'db',
        cells: [
            { nodeId: 'db', value: 0.95 },
            { nodeId: 'svc', value: 0.4 },
            { nodeId: 'idle', value: 0 },
        ],
    };
}

describe('шкала тепловой карты', () => {
    it('делит значения по порогам', () => {
        expect(heatLevel(0.4, THRESHOLDS)).toBe('ok');
        expect(heatLevel(0.7, THRESHOLDS)).toBe('warn');
        expect(heatLevel(0.89, THRESHOLDS)).toBe('warn');
        expect(heatLevel(0.9, THRESHOLDS)).toBe('hot');
        expect(heatLevel(1.4, THRESHOLDS)).toBe('hot');
    });

    it('блок без нагрузки не красит', () => {
        expect(heatLevel(0, THRESHOLDS)).toBe('idle');
        expect(heatLevel(-1, THRESHOLDS)).toBe('idle');
        expect(heatLevel(Number.NaN, THRESHOLDS)).toBe('idle');
    });

    it('переставленные местами пороги не ломают порядок уровней', () => {
        const inverted = { warn: 0.9, alarm: 0.7 };

        expect(heatLevel(0.5, inverted)).toBe('ok');
        expect(heatLevel(0.8, inverted)).toBe('warn');
        expect(heatLevel(0.95, inverted)).toBe('hot');
    });

    it('подменяет нечисловой порог значением по умолчанию', () => {
        const broken = { warn: Number.NaN, alarm: Number.POSITIVE_INFINITY };

        expect(heatLevel(DEFAULT_HEAT_WARN, broken)).toBe('warn');
        expect(heatLevel(DEFAULT_HEAT_ALARM, broken)).toBe('hot');
    });

    it('раскладывает легенду по четырём ступеням без разрывов', () => {
        expect(heatScale(THRESHOLDS)).toEqual([
            { level: 'idle', from: 0, to: 0 },
            { level: 'ok', from: 0, to: 0.7 },
            { level: 'warn', from: 0.7, to: 0.9 },
            { level: 'hot', from: 0.9, to: null },
        ]);
    });

    it('достаёт значение блока и отличает ноль от отсутствия', () => {
        expect(heatValueOf(heatmap(), 'db')).toBe(0.95);
        expect(heatValueOf(heatmap(), 'idle')).toBe(0);
        expect(heatValueOf(heatmap(), 'unknown')).toBeNull();
    });
});
