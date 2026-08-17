import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Timeline from '../../src/components/panels/Dashboard/Timeline';
import {
    clampCursorIndex,
    cursorIndexAt,
    defaultCursorIndex,
    scopedValue,
    timelineCursor,
    TIMELINE_METRICS,
    TIMELINE_SYSTEM_SCOPE,
} from '../../src/utils/timeline';
import type { Timeline as TimelineResult, TimelineNodeSample, TimelineSample } from '../../src/engine/sim/types';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

const STEP_SEC = 30;

function nodeSample(nodeId: string, lambda: number, utilization: number): TimelineNodeSample {
    return {
        nodeId,
        lambda,
        throughput: lambda,
        utilization,
        p99Ms: utilization * 100,
        backlog: utilization * 10,
        queueDepth: utilization * 5,
        errorRate: utilization > 1 ? 0.1 : 0,
        instances: 4,
        capacity: 1000,
        desiredInstances: 4,
        hitRatio: null,
    };
}

function sample(index: number, utilization: number, breach: boolean): TimelineSample {
    return {
        timeSec: index * STEP_SEC,
        lambda: utilization * 1000,
        throughput: utilization * 1000,
        errorRate: breach ? 0.2 : 0,
        peakUtilization: utilization,
        worstP99Ms: utilization * 100,
        backlog: utilization * 10,
        instances: 4,
        breach,
        nodes: {
            api: nodeSample('api', utilization * 1000, utilization),
            db: nodeSample('db', utilization * 400, utilization * 1.5),
        },
    };
}

const TIMELINE: TimelineResult = {
    stepSec: STEP_SEC,
    horizonSec: 4 * STEP_SEC,
    samples: [sample(0, 0.2, false), sample(1, 0.5, false), sample(2, 1.1, true), sample(3, 0.4, false)],
    peakLambda: 1100,
    peakBacklog: 11,
    peakP99Ms: 110,
    breachFromSec: 2 * STEP_SEC,
    recoveredAtSec: 3 * STEP_SEC,
};

const EMPTY: TimelineResult = { ...TIMELINE, samples: [], breachFromSec: null, recoveredAtSec: null };

describe('курсор таймлайна', () => {
    it('по умолчанию встаёт на первое нарушение', () => {
        expect(defaultCursorIndex(TIMELINE)).toBe(2);
    });

    it('без нарушений показывает последний срез', () => {
        const calm = { ...TIMELINE, samples: TIMELINE.samples.map((item) => ({ ...item, breach: false })) };

        expect(defaultCursorIndex(calm)).toBe(3);
        expect(defaultCursorIndex(EMPTY)).toBe(0);
    });

    it('не выходит за границы среза', () => {
        expect(clampCursorIndex(TIMELINE, -5)).toBe(0);
        expect(clampCursorIndex(TIMELINE, 99)).toBe(3);
        expect(clampCursorIndex(EMPTY, 3)).toBe(0);
    });

    it('переводит долю ширины графика в ближайший срез', () => {
        expect(cursorIndexAt(TIMELINE, 0)).toBe(0);
        expect(cursorIndexAt(TIMELINE, 0.5)).toBe(2);
        expect(cursorIndexAt(TIMELINE, 1)).toBe(3);
        expect(cursorIndexAt(TIMELINE, 2)).toBe(3);
    });

    it('отдаёт значение выбранной области и самый горячий узел', () => {
        const system = timelineCursor(TIMELINE, 2, TIMELINE_SYSTEM_SCOPE, 'utilization');
        const node = timelineCursor(TIMELINE, 2, 'api', 'utilization');

        expect(system?.sample.timeSec).toBe(60);
        expect(system?.value).toBeCloseTo(1.1, 6);
        expect(system?.worstNodeId).toBe('db');
        expect(system?.worstValue).toBeCloseTo(1.65, 6);
        expect(node?.value).toBeCloseTo(1.1, 6);
        expect(timelineCursor(EMPTY, 0, TIMELINE_SYSTEM_SCOPE, 'utilization')).toBeNull();
    });

    it('читает каждую метрику и у схемы, и у узла', () => {
        for (const metric of TIMELINE_METRICS) {
            expect(Number.isFinite(scopedValue(TIMELINE.samples[1], TIMELINE_SYSTEM_SCOPE, metric))).toBe(true);
            expect(Number.isFinite(scopedValue(TIMELINE.samples[1], 'db', metric))).toBe(true);
        }

        expect(scopedValue(TIMELINE.samples[1], 'нет-такого', 'utilization')).toBe(0);
    });
});

describe('скраббер таймлайна', () => {
    const markup = renderToStaticMarkup(
        createElement(Timeline, { timeline: TIMELINE, labelOf: (nodeId: string) => `узел ${nodeId}` }),
    );

    it('рисует ползунок времени на все срезы', () => {
        expect(markup).toContain('dash-timeline-scrubber');
        expect(markup).toContain('type="range"');
        expect(markup).toContain('max="3"');
        expect(markup).toContain('value="2"');
    });

    it('рисует курсор и подпись выбранного момента', () => {
        expect(markup).toContain('dash-timeline-cursor');
        expect(markup).toContain('dash-timeline-cursor-dot');
        expect(markup).toContain('dash-timeline-readout');
        expect(markup).toContain('узел db');
    });

    it('переведён на оба языка', () => {
        for (const key of ['scrub', 'at', 'worst']) {
            expect(ruCommon.timeline, `ru: timeline.${key}`).toHaveProperty(key);
            expect(enCommon.timeline, `en: timeline.${key}`).toHaveProperty(key);
        }
    });
});
