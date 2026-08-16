import { describe, expect, it } from 'vitest';
import type { ProbeHeatmap } from '../../src/engine/sim/types';
import {
    DEFAULT_HEAT_ALARM,
    DEFAULT_HEAT_WARN,
    UTILIZATION_SCALE,
    formatHeatRange,
    heatLevel,
    heatScale,
    heatValueOf,
    nodeHeat,
} from '../../src/utils/heatmap';
import { utilizationLevel } from '../../src/utils/format';

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

    it('легенда утилизации описывает ту же раскраску, что и узел', () => {
        for (const stop of UTILIZATION_SCALE) {
            const inside = stop.to === null ? stop.from + 0.5 : (stop.from + stop.to) / 2;
            expect(utilizationLevel(inside)).toBe(stop.level);
        }

        expect(utilizationLevel(1)).toBe('hot');
        expect(utilizationLevel(0.8)).toBe('ok');
    });

    it('подписывает ступени легенды диапазонами', () => {
        expect(formatHeatRange({ level: 'ok', from: 0.02, to: 0.8 })).toBe('2% – 80%');
        expect(formatHeatRange({ level: 'hot', from: 1, to: null })).toBe('≥ 100%');
        expect(formatHeatRange({ level: 'idle', from: 0, to: 0 })).toBe('0%');
    });
});

describe('заливка узла', () => {
    const off = { heatmapOn: false, projected: null, thresholds: null, utilization: 0.95 };

    it('выключенная карта не красит ничего', () => {
        expect(nodeHeat(off)).toBeNull();
        expect(nodeHeat({ ...off, projected: 0.95, thresholds: THRESHOLDS })).toBeNull();
    });

    it('красит по утилизации, когда пробы-проектора нет', () => {
        const heat = (utilization: number) =>
            nodeHeat({ heatmapOn: true, projected: null, thresholds: null, utilization });

        expect(heat(0.5)).toEqual({ level: 'ok', source: 'utilization' });
        expect(heat(0.9)).toEqual({ level: 'warn', source: 'utilization' });
        expect(heat(1.2)).toEqual({ level: 'hot', source: 'utilization' });
    });

    it('блок без посчитанной утилизации не красится', () => {
        expect(nodeHeat({ heatmapOn: true, projected: null, thresholds: null, utilization: null })).toBeNull();
    });

    it('проекция пробы главнее утилизации и считается по её порогам', () => {
        const heat = nodeHeat({
            heatmapOn: true,
            projected: 0.75,
            thresholds: THRESHOLDS,
            utilization: 0.1,
        });

        expect(heat).toEqual({ level: 'warn', source: 'probe' });
    });
});
