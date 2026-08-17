import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Timeline as TimelineResult } from '../../../engine/sim/types';
import { formatNumber } from '../../../utils/format';
import {
    clampCursorIndex,
    cursorIndexAt,
    defaultCursorIndex,
    scopedValue,
    timelineCursor,
    TIMELINE_METRICS,
    TIMELINE_SYSTEM_SCOPE,
} from '../../../utils/timeline';
import type { TimelineMetric } from '../../../utils/timeline';
import './Timeline.css';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 150;
const PADDING_TOP = 10;
const PADDING_BOTTOM = 18;
const TICK_COUNT = 5;

export type { TimelineMetric };

interface Point {
    timeSec: number;
    value: number;
    breach: boolean;
}

interface Series {
    points: Point[];
    limit: number | null;
    limitLabel: string;
}

interface TimelineProps {
    timeline: TimelineResult;
    labelOf: (nodeId: string) => string;
}

function limitFor(timeline: TimelineResult, scope: string, metric: TimelineMetric): number | null {
    if (metric === 'utilization') return 1;
    if (metric === 'errors') return 0.01;

    if (metric === 'lambda' && scope !== TIMELINE_SYSTEM_SCOPE) {
        const capacities = timeline.samples
            .map((sample) => sample.nodes[scope]?.capacity ?? 0)
            .filter((value) => Number.isFinite(value) && value > 0);

        return capacities.length > 0 ? Math.min(...capacities) : null;
    }

    return null;
}

function buildSeries(timeline: TimelineResult, scope: string, metric: TimelineMetric): Series {
    const points = timeline.samples.map((sample) => ({
        timeSec: sample.timeSec,
        value: scopedValue(sample, scope, metric),
        breach: sample.breach,
    }));

    const limit = limitFor(timeline, scope, metric);

    return { points, limit, limitLabel: limit === null ? '' : formatNumber(limit) };
}

function formatTime(seconds: number): string {
    if (seconds >= 172_800) return `${Math.round(seconds / 86_400)}d`;
    if (seconds >= 7200) return `${Math.round(seconds / 3600)}h`;
    if (seconds >= 120) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds)}s`;
}

function scaleY(value: number, top: number): number {
    const usable = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
    const share = top > 0 ? Math.min(value / top, 1) : 0;

    return CHART_HEIGHT - PADDING_BOTTOM - share * usable;
}

function scaleX(timeSec: number, horizonSec: number): number {
    return horizonSec > 0 ? (timeSec / horizonSec) * CHART_WIDTH : 0;
}

interface BreachSpan {
    fromSec: number;
    toSec: number;
}

function breachSpans(points: Point[], stepSec: number): BreachSpan[] {
    const spans: BreachSpan[] = [];

    for (const point of points) {
        if (!point.breach) continue;

        const last = spans[spans.length - 1];
        if (last && Math.abs(last.toSec - point.timeSec) < stepSec / 2) {
            last.toSec = point.timeSec + stepSec;
            continue;
        }

        spans.push({ fromSec: point.timeSec, toSec: point.timeSec + stepSec });
    }

    return spans;
}

export default function Timeline({ timeline, labelOf }: TimelineProps) {
    const { t } = useTranslation('common');
    const [metric, setMetric] = useState<TimelineMetric>('utilization');
    const [scope, setScope] = useState<string>(TIMELINE_SYSTEM_SCOPE);
    const [pinned, setPinned] = useState<{ timeline: TimelineResult; index: number } | null>(null);
    const cursorIndex = pinned?.timeline === timeline ? pinned.index : defaultCursorIndex(timeline);

    const nodeIds = useMemo(() => {
        const first = timeline.samples[0];
        if (!first) return [];

        return Object.keys(first.nodes).filter((nodeId) =>
            timeline.samples.some((sample) => (sample.nodes[nodeId]?.lambda ?? 0) > 0),
        );
    }, [timeline]);

    const activeScope = nodeIds.includes(scope) ? scope : TIMELINE_SYSTEM_SCOPE;
    const series = useMemo(() => buildSeries(timeline, activeScope, metric), [timeline, activeScope, metric]);
    const cursor = timelineCursor(timeline, cursorIndex, activeScope, metric);

    const horizonSec = Math.max(timeline.horizonSec, timeline.stepSec);
    const peak = series.points.reduce((max, point) => Math.max(max, point.value), 0);
    const top = Math.max(peak, series.limit ?? 0) * 1.15 || 1;

    const line = series.points
        .map((point) => `${scaleX(point.timeSec, horizonSec).toFixed(2)},${scaleY(point.value, top).toFixed(2)}`)
        .join(' ');

    const area = series.points.length > 0 ? `${line} ${CHART_WIDTH},${CHART_HEIGHT - PADDING_BOTTOM} 0,${CHART_HEIGHT - PADDING_BOTTOM}` : '';
    const spans = breachSpans(series.points, timeline.stepSec);
    const ticks = Array.from({ length: TICK_COUNT }, (_, index) => (horizonSec * index) / (TICK_COUNT - 1));
    const cursorX = cursor ? scaleX(cursor.sample.timeSec, horizonSec) : 0;
    const lastIndex = Math.max(timeline.samples.length - 1, 0);

    const moveCursorTo = (index: number): void => {
        setPinned({ timeline, index: clampCursorIndex(timeline, index) });
    };

    return (
        <div className="dash-timeline">
            <div className="dash-timeline-controls">
                <select
                    className="dash-timeline-select"
                    value={metric}
                    onChange={(event) => setMetric(event.target.value as TimelineMetric)}
                    aria-label={t('timeline.metric.label')}
                >
                    {TIMELINE_METRICS.map((item) => (
                        <option key={item} value={item}>
                            {t(`timeline.metric.${item}`)}
                        </option>
                    ))}
                </select>

                <select
                    className="dash-timeline-select"
                    value={activeScope}
                    onChange={(event) => setScope(event.target.value)}
                    aria-label={t('timeline.scope')}
                >
                    <option value={TIMELINE_SYSTEM_SCOPE}>{t('timeline.system')}</option>
                    {nodeIds.map((nodeId) => (
                        <option key={nodeId} value={nodeId}>
                            {labelOf(nodeId)}
                        </option>
                    ))}
                </select>

                <span className="dash-timeline-meta">
                    {t('timeline.peak', { value: formatNumber(peak) })}
                    {timeline.breachFromSec !== null && (
                        <span className="dash-tone-hot">
                            {t('timeline.breachAt', { value: formatTime(timeline.breachFromSec) })}
                        </span>
                    )}
                    {timeline.recoveredAtSec !== null && (
                        <span>{t('timeline.recoveredAt', { value: formatTime(timeline.recoveredAtSec) })}</span>
                    )}
                </span>
            </div>

            <svg
                className="dash-timeline-chart"
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={t(`timeline.metric.${metric}`)}
                onMouseMove={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    if (box.width > 0) moveCursorTo(cursorIndexAt(timeline, (event.clientX - box.left) / box.width));
                }}
            >
                {spans.map((span) => (
                    <rect
                        key={span.fromSec}
                        className="dash-timeline-breach"
                        x={scaleX(span.fromSec, horizonSec)}
                        y={PADDING_TOP}
                        width={Math.max(scaleX(span.toSec - span.fromSec, horizonSec), 1)}
                        height={CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM}
                    />
                ))}

                <line
                    className="dash-timeline-axis"
                    x1={0}
                    y1={CHART_HEIGHT - PADDING_BOTTOM}
                    x2={CHART_WIDTH}
                    y2={CHART_HEIGHT - PADDING_BOTTOM}
                    vectorEffect="non-scaling-stroke"
                />

                {series.limit !== null && (
                    <line
                        className="dash-timeline-limit"
                        x1={0}
                        y1={scaleY(series.limit, top)}
                        x2={CHART_WIDTH}
                        y2={scaleY(series.limit, top)}
                        vectorEffect="non-scaling-stroke"
                    />
                )}

                {area && <polygon className="dash-timeline-area" points={area} />}
                <polyline className="dash-timeline-line" points={line} vectorEffect="non-scaling-stroke" />

                {cursor && (
                    <line
                        className="dash-timeline-cursor"
                        x1={cursorX}
                        y1={PADDING_TOP}
                        x2={cursorX}
                        y2={CHART_HEIGHT - PADDING_BOTTOM}
                        vectorEffect="non-scaling-stroke"
                    />
                )}
                {cursor && (
                    <circle
                        className="dash-timeline-cursor-dot"
                        cx={cursorX}
                        cy={scaleY(cursor.value, top)}
                        r={2.5}
                        vectorEffect="non-scaling-stroke"
                    />
                )}
            </svg>

            <div className="dash-timeline-axis-labels">
                {ticks.map((tick) => (
                    <span key={tick}>{formatTime(tick)}</span>
                ))}
            </div>

            <input
                className="dash-timeline-scrubber"
                type="range"
                min={0}
                max={lastIndex}
                step={1}
                value={cursor ? cursor.index : 0}
                disabled={lastIndex === 0}
                aria-label={t('timeline.scrub')}
                onChange={(event) => moveCursorTo(Number(event.target.value))}
            />

            {cursor && (
                <div className="dash-timeline-readout">
                    <span className="dash-timeline-readout-time">
                        {t('timeline.at', { value: formatTime(cursor.sample.timeSec) })}
                    </span>
                    <span className="dash-timeline-readout-value">
                        {t(`timeline.metric.${metric}`)} {formatNumber(cursor.value)}
                    </span>
                    {cursor.worstNodeId !== null && (
                        <span className="dash-timeline-readout-worst">
                            {t('timeline.worst', {
                                node: labelOf(cursor.worstNodeId),
                                value: formatNumber(cursor.worstValue),
                            })}
                        </span>
                    )}
                    {cursor.sample.breach && (
                        <span className="dash-tone-hot">{t('timeline.breach')}</span>
                    )}
                </div>
            )}

            <div className="dash-timeline-legend">
                <span className="dash-timeline-legend-line" />
                {t(`timeline.metric.${metric}`)}
                {series.limit !== null && (
                    <>
                        <span className="dash-timeline-legend-limit" />
                        {t('timeline.limit', { value: series.limitLabel })}
                    </>
                )}
                <span className="dash-timeline-legend-breach" />
                {t('timeline.breach')}
                <span className="dash-timeline-step">{t('timeline.step', { value: formatTime(timeline.stepSec) })}</span>
            </div>
        </div>
    );
}
