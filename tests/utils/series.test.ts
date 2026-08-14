import { describe, expect, it } from 'vitest';
import { SPARKLINE_HEIGHT, SPARKLINE_WIDTH, layoutSparkline } from '../../src/utils/series';

const BOX = { width: 100, height: 10 };

describe('раскладка спарклайна', () => {
    it('раскладывает точки равномерно по ширине и по шкале значений', () => {
        const layout = layoutSparkline([0, 50, 100], BOX);

        expect(layout.points.map((point) => point.x)).toEqual([0, 50, 100]);
        expect(layout.points.map((point) => point.y)).toEqual([10, 5, 0]);
        expect(layout.min).toBe(0);
        expect(layout.max).toBe(100);
        expect(layout.last).toBe(100);
        expect(layout.peak).toBe(100);
    });

    it('отдаёт строку полилинии и замкнутый на базовую линию многоугольник', () => {
        const layout = layoutSparkline([0, 50, 100], BOX);

        expect(layout.line).toBe('0,10 50,5 100,0');
        expect(layout.area).toBe('0,10 50,5 100,0 100,10 0,10');
    });

    it('прижимает нижнюю границу к нулю, а не к минимуму ряда', () => {
        const layout = layoutSparkline([50, 60], BOX);

        expect(layout.min).toBe(0);
        expect(layout.max).toBe(60);
        expect(layout.points.map((point) => point.y)).toEqual([1.67, 0]);
    });

    it('опускает нижнюю границу ниже нуля, когда в ряду есть отрицательные значения', () => {
        expect(layoutSparkline([-5, 5], BOX).min).toBe(-5);
    });

    it('на пустом ряде не рисует ничего и не выдаёт значений', () => {
        const layout = layoutSparkline([], BOX);

        expect(layout.points).toEqual([]);
        expect(layout.line).toBe('');
        expect(layout.area).toBe('');
        expect(layout.last).toBeNull();
        expect(layout.peak).toBeNull();
        expect(layout.lastLevel).toBe('ok');
        expect(layout.crossings).toEqual([]);
        expect(layout.spans).toEqual([]);
        expect(Number.isFinite(layout.min)).toBe(true);
        expect(Number.isFinite(layout.max)).toBe(true);
    });

    it('единственную точку растягивает в горизонтальную линию во всю ширину', () => {
        const layout = layoutSparkline([42], BOX);

        expect(layout.points).toHaveLength(1);
        expect(layout.points[0].x).toBe(0);
        expect(layout.line).toBe('0,0 100,0');
        expect(layout.area).toBe('0,0 100,0 100,10 0,10');
        expect(layout.last).toBe(42);
    });

    it('на полностью плоском ряде не делит на ноль и кладёт линию на базовую', () => {
        const layout = layoutSparkline([0, 0, 0], BOX);

        expect(layout.points.map((point) => point.y)).toEqual([10, 10, 10]);
        expect(layout.line).toBe('0,10 50,10 100,10');
        for (const point of layout.points) {
            expect(Number.isFinite(point.y)).toBe(true);
        }
    });

    it('не делит на ноль и на совпавших заданных границах', () => {
        const layout = layoutSparkline([5, 5], { ...BOX, min: 5, max: 5 });

        expect(layout.min).toBe(5);
        expect(layout.max).toBe(5);
        expect(layout.points.map((point) => point.y)).toEqual([10, 10]);
    });

    it('выбрасывает нечисловые отсчёты, сохраняя позицию остальных на оси времени', () => {
        const layout = layoutSparkline([10, Number.NaN, 30, Number.POSITIVE_INFINITY, 20], BOX);

        expect(layout.points.map((point) => point.index)).toEqual([0, 2, 4]);
        expect(layout.points.map((point) => point.x)).toEqual([0, 50, 100]);
        expect(layout.line).toBe('0,6.67 50,0 100,3.33');
        expect(layout.peak).toBe(30);
        expect(layout.last).toBe(20);
    });

    it('ряд из одних нечисловых отсчётов равносилен пустому', () => {
        const layout = layoutSparkline([Number.NaN, Number.NEGATIVE_INFINITY], BOX);

        expect(layout.points).toEqual([]);
        expect(layout.line).toBe('');
        expect(layout.last).toBeNull();
    });

    it('поднимает верх шкалы до порогов, чтобы их линии были видны', () => {
        const layout = layoutSparkline([10, 20], { ...BOX, warn: 70, alarm: 90 });

        expect(layout.max).toBe(90);
        expect(layout.alarmY).toBe(0);
        expect(layout.warnY).toBe(2.22);
    });

    it('не выпускает точку за верхний край, когда значение выше заданного максимума', () => {
        const layout = layoutSparkline([50, 150], { ...BOX, min: 0, max: 100 });

        expect(layout.max).toBe(100);
        expect(layout.points.map((point) => point.y)).toEqual([5, 0]);
    });

    it('без порогов не размечает ни уровней, ни линий', () => {
        const layout = layoutSparkline([10, 900], BOX);

        expect(layout.warnY).toBeNull();
        expect(layout.alarmY).toBeNull();
        expect(layout.crossings).toEqual([]);
        expect(layout.points.every((point) => point.level === 'ok')).toBe(true);
    });

    it('отмечает переходы через пороги и не повторяет их, пока ряд держится выше', () => {
        const layout = layoutSparkline([10, 80, 95, 95, 40, 92], { ...BOX, warn: 70, alarm: 90 });

        expect(layout.crossings).toEqual([
            { index: 1, value: 80, x: 20, level: 'warn' },
            { index: 2, value: 95, x: 40, level: 'alarm' },
            { index: 5, value: 92, x: 100, level: 'alarm' },
        ]);
        expect(layout.lastLevel).toBe('alarm');
    });

    it('отмечает переход на первом же отсчёте, если ряд начинается выше порога', () => {
        const layout = layoutSparkline([95, 95], { ...BOX, warn: 70, alarm: 90 });

        expect(layout.crossings.map((crossing) => crossing.index)).toEqual([0]);
        expect(layout.crossings[0].level).toBe('alarm');
    });

    it('собирает полосы по непрерывным участкам одного уровня', () => {
        const layout = layoutSparkline([10, 80, 95, 95, 40, 92], { ...BOX, warn: 70, alarm: 90 });

        expect(layout.spans).toEqual([
            { level: 'warn', fromIndex: 1, toIndex: 1, x: 10, width: 20 },
            { level: 'alarm', fromIndex: 2, toIndex: 3, x: 30, width: 40 },
            { level: 'alarm', fromIndex: 5, toIndex: 5, x: 90, width: 10 },
        ]);
    });

    it('держит полосы внутри рамки графика', () => {
        const layout = layoutSparkline([95, 10, 10, 10, 95], { ...BOX, warn: 70, alarm: 90 });

        for (const span of layout.spans) {
            expect(span.x).toBeGreaterThanOrEqual(0);
            expect(span.width).toBeGreaterThan(0);
            expect(span.x + span.width).toBeLessThanOrEqual(BOX.width);
        }
    });

    it('берёт размер по умолчанию и отвергает неположительный', () => {
        expect(layoutSparkline([1, 2])).toMatchObject({ width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT });
        expect(layoutSparkline([1, 2], { width: 0, height: -5 })).toMatchObject({
            width: SPARKLINE_WIDTH,
            height: SPARKLINE_HEIGHT,
        });
    });

    it('раскладывает ряд длиной с горизонт таймлайна без выхода за края', () => {
        const values = Array.from({ length: 121 }, (_, index) => index);
        const layout = layoutSparkline(values, { ...BOX, warn: 70, alarm: 90 });

        expect(layout.points).toHaveLength(121);
        for (const point of layout.points) {
            expect(point.x).toBeGreaterThanOrEqual(0);
            expect(point.x).toBeLessThanOrEqual(BOX.width);
            expect(point.y).toBeGreaterThanOrEqual(0);
            expect(point.y).toBeLessThanOrEqual(BOX.height);
        }
        expect(layout.points[layout.points.length - 1].x).toBe(BOX.width);
    });
});
