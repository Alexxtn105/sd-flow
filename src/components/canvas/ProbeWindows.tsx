import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Histogram from '../common/Histogram/Histogram';
import Icon from '../common/Icons/Icon';
import Sparkline from '../common/Sparkline/Sparkline';
import Waterfall from '../common/Waterfall/Waterfall';
import type {
    FlowWaterfall,
    LatencyHistogram,
    ProbeHeatmap,
    ProbeReading,
    Timeline,
    TimelineNodeSample,
} from '../../engine/sim/types';
import type { ComponentParams } from '../../engine/types/component';
import { useGraphStore } from '../../store/graphStore';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { formatNumber } from '../../utils/format';
import { heatLevel, heatScale } from '../../utils/heatmap';
import type { HeatStop } from '../../utils/heatmap';
import { WATERFALL_PERCENTILES } from '../../utils/waterfall';
import type { WaterfallPercentile } from '../../utils/waterfall';
import './ProbeWindows.css';

const WATERFALL_PROBE = 'probe-waterfall';

const UTILIZATION_PROBE = 'probe-utilization';

const LATENCY_PROBE = 'probe-latency';

const HEATMAP_PROBE = 'probe-heatmap';

const HOTTEST_COUNT = 3;

const MAX_INPUTS = 10;

const CARD_STEP_PX = 34;

const CARD_MARGIN_PX = 16;

const HISTORY_METRICS: Record<string, (sample: TimelineNodeSample) => number> = {
    'probe-utilization': (sample) => sample.utilization * 100,
    'probe-rps': (sample) => sample.throughput,
};

interface WindowPosition {
    x: number;
    y: number;
}

interface DragState {
    pointerId: number;
    offsetX: number;
    offsetY: number;
}

interface HistoryThresholds {
    warn?: number;
    alarm?: number;
}

interface ProbeWindowCardProps {
    probeId: string;
    reading: ProbeReading | null;
    title: string;
    params: ComponentParams;
    index: number;
    waterfall: FlowWaterfall | null;
    timeline: Timeline | null;
    labelOf: (nodeId: string) => string;
}

function percentileOf(params: ComponentParams): WaterfallPercentile {
    const value = params.percentile;
    return WATERFALL_PERCENTILES.find((item) => item === value) ?? 'p99';
}

function topHopsOf(params: ComponentParams): number {
    const value = params.topHops;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value)) : 12;
}

function sharePercentOf(params: ComponentParams, key: string, fallback: number): number {
    const value = params[key];
    return (typeof value === 'number' && Number.isFinite(value) ? value : fallback) * 100;
}

function thresholdsOf(componentType: string, params: ComponentParams): HistoryThresholds {
    if (componentType !== UTILIZATION_PROBE) return {};

    return {
        warn: sharePercentOf(params, 'warnThreshold', 0.7),
        alarm: sharePercentOf(params, 'alarmThreshold', 0.9),
    };
}

function tracksHistory(componentType: string): boolean {
    return componentType in HISTORY_METRICS;
}

function percentOf(share: number): string {
    return `${formatNumber(share * 100)}%`;
}

function rangeOf(stop: HeatStop): string {
    if (stop.to === null) return `≥ ${percentOf(stop.from)}`;
    if (stop.to === stop.from) return percentOf(stop.from);

    return `${percentOf(stop.from)} – ${percentOf(stop.to)}`;
}

function historyOf(reading: ProbeReading, timeline: Timeline | null): number[] {
    const metric = HISTORY_METRICS[reading.componentType];
    const nodeId = reading.targetNodeId;
    if (!metric || !timeline || !nodeId) return [];

    const values = timeline.samples.map((sample) => {
        const node = sample.nodes[nodeId];
        return node ? metric(node) : Number.NaN;
    });

    return values.some((value) => Number.isFinite(value)) ? values : [];
}

interface HistogramPanelProps {
    histogram: LatencyHistogram | undefined;
}

function HistogramPanel({ histogram }: HistogramPanelProps) {
    const { t } = useTranslation('common');

    const notes = histogram
        ? [
              t(`probe.axis.${histogram.scale}`),
              t('probe.samples', { value: formatNumber(histogram.total) }),
              ...(histogram.zeroCount > 0
                  ? [t('probe.zeroSamples', { value: formatNumber(histogram.zeroCount) })]
                  : []),
          ]
        : [];

    return (
        <section className="probe-window-histogram">
            <span className="probe-window-section">{t('probe.distribution')}</span>
            {histogram && histogram.total > 0 ? (
                <>
                    <Histogram
                        compact
                        histogram={histogram}
                        unit={t('probe.unit.ms')}
                        label={t('probe.distribution')}
                    />
                    <span className="probe-window-note">{notes.join(' · ')}</span>
                </>
            ) : (
                <p className="probe-window-reason">{t('probe.noDistribution')}</p>
            )}
        </section>
    );
}

interface HeatmapPanelProps {
    heatmap: ProbeHeatmap;
    projecting: boolean;
    labelOf: (nodeId: string) => string;
    onToggle: () => void;
}

function HeatmapPanel({ heatmap, projecting, labelOf, onToggle }: HeatmapPanelProps) {
    const { t } = useTranslation('common');

    return (
        <section className="probe-window-heatmap">
            <span className="probe-window-section">{t('probe.heatmapLegend')}</span>
            <ul className="probe-heat-scale">
                {heatScale(heatmap).map((stop) => (
                    <li key={stop.level} className={`probe-heat-stop probe-heat-${stop.level}`}>
                        <span className="probe-heat-swatch" />
                        <span className="probe-heat-label">{t(`probe.heatLevel.${stop.level}`)}</span>
                        <span className="probe-heat-range">{rangeOf(stop)}</span>
                    </li>
                ))}
            </ul>

            <span className="probe-window-section">{t('probe.heatmapHottest')}</span>
            <ul className="probe-heat-top">
                {heatmap.cells.slice(0, HOTTEST_COUNT).map((cell) => (
                    <li key={cell.nodeId}>
                        <span className="probe-heat-node">{labelOf(cell.nodeId)}</span>
                        <span className={`probe-heat-value probe-heat-${heatLevel(cell.value, heatmap)}`}>
                            {percentOf(cell.value)}
                        </span>
                    </li>
                ))}
            </ul>

            <button type="button" className="probe-window-project" aria-pressed={projecting} onClick={onToggle}>
                {projecting ? t('probe.heatmapStop') : t('probe.heatmapProject')}
            </button>
            {projecting && <span className="probe-window-note">{t('probe.heatmapActive')}</span>}
        </section>
    );
}

function ProbeWindowCard({ probeId, reading, title, params, index, waterfall, timeline, labelOf }: ProbeWindowCardProps) {
    const { t } = useTranslation('common');
    const closeProbeWindow = useUiStore((state) => state.closeProbeWindow);
    const toggleHeatmapProbe = useUiStore((state) => state.toggleHeatmapProbe);
    const projecting = useUiStore((state) => state.heatmapProbeId === probeId);
    const focusWaterfall = useSimStore((state) => state.focusWaterfall);
    const cardRef = useRef<HTMLElement>(null);
    const [position, setPosition] = useState<WindowPosition | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);

    const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
        const card = cardRef.current;
        const container = card?.parentElement;
        if (!card || !container) return;

        const bounds = card.getBoundingClientRect();
        const containerBounds = container.getBoundingClientRect();

        setPosition({ x: bounds.left - containerBounds.left, y: bounds.top - containerBounds.top });
        setDrag({
            pointerId: event.pointerId,
            offsetX: event.clientX - bounds.left,
            offsetY: event.clientY - bounds.top,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
        const card = cardRef.current;
        const container = card?.parentElement;
        if (!drag || event.pointerId !== drag.pointerId || !card || !container) return;

        const bounds = container.getBoundingClientRect();

        setPosition({
            x: Math.max(0, Math.min(bounds.width - card.offsetWidth, event.clientX - bounds.left - drag.offsetX)),
            y: Math.max(0, Math.min(bounds.height - card.offsetHeight, event.clientY - bounds.top - drag.offsetY)),
        });
    };

    const stopDrag = (event: ReactPointerEvent<HTMLElement>) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        setDrag(null);
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const status = reading?.status ?? 'no-data';
    const inputs = reading ? Object.entries(reading.explain.inputs).slice(0, MAX_INPUTS) : [];
    const target = reading?.targetNodeId ? labelOf(reading.targetNodeId) : null;
    const history = reading ? historyOf(reading, timeline) : [];
    const thresholds = reading ? thresholdsOf(reading.componentType, params) : {};
    const placement = position
        ? { left: position.x, top: position.y }
        : { right: CARD_MARGIN_PX, top: CARD_MARGIN_PX + index * CARD_STEP_PX };

    return (
        <article
            ref={cardRef}
            className={`probe-window probe-window-${status} ${projecting ? 'probe-window-projecting' : ''}`}
            style={placement}
        >
            <header
                className="probe-window-header"
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
            >
                <span className="probe-window-title">{title}</span>
                {target && <span className="probe-window-target">{target}</span>}
                <span className="probe-window-status">{t(`probe.status.${status}`)}</span>
                <button
                    type="button"
                    className="probe-window-close"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => closeProbeWindow(probeId)}
                    title={t('probe.closeWindow')}
                    aria-label={t('probe.closeWindow')}
                >
                    <Icon name="close" size="small" />
                </button>
            </header>

            <div className="probe-window-body">
                {!reading ? (
                    <p className="probe-window-reason">{t('probe.noData')}</p>
                ) : reading.status === 'no-data' ? (
                    <p className="probe-window-reason">{t(`probe.reason.${reading.reason ?? 'unattached'}`)}</p>
                ) : (
                    <>
                        <div className="probe-window-value">
                            {formatNumber(reading.value)}
                            <span>{t(`probe.unit.${reading.unit}`, { defaultValue: '' })}</span>
                        </div>

                        {tracksHistory(reading.componentType) && (
                            <section className="probe-window-history">
                                <span className="probe-window-section">{t('probe.history')}</span>
                                {history.length > 0 ? (
                                    <Sparkline
                                        compact
                                        values={history}
                                        unit={t(`probe.unit.${reading.unit}`, { defaultValue: '' })}
                                        label={t('probe.history')}
                                        warn={thresholds.warn}
                                        alarm={thresholds.alarm}
                                    />
                                ) : (
                                    <p className="probe-window-reason">{t('probe.noHistory')}</p>
                                )}
                            </section>
                        )}

                        {reading.componentType === LATENCY_PROBE && <HistogramPanel histogram={reading.histogram} />}

                        {reading.componentType === HEATMAP_PROBE && reading.heatmap && (
                            <HeatmapPanel
                                heatmap={reading.heatmap}
                                projecting={projecting}
                                labelOf={labelOf}
                                onToggle={() => toggleHeatmapProbe(probeId)}
                            />
                        )}

                        {waterfall && reading.componentType === WATERFALL_PROBE && (
                            <Waterfall
                                compact
                                waterfall={waterfall}
                                percentile={percentileOf(params)}
                                limit={topHopsOf(params)}
                                labelOf={labelOf}
                            />
                        )}

                        <p className="probe-window-formula" title={t('probe.explain')}>
                            {reading.explain.formula}
                        </p>

                        {inputs.length > 0 && (
                            <dl className="probe-window-inputs">
                                {inputs.map(([key, value]) => (
                                    <div key={key}>
                                        <dt>{key}</dt>
                                        <dd>{typeof value === 'number' ? formatNumber(value) : labelOf(value)}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}

                        {reading.flowId && (
                            <button
                                type="button"
                                className="probe-window-waterfall"
                                onClick={() => focusWaterfall(reading.flowId)}
                            >
                                {t('probe.openWaterfall')}
                            </button>
                        )}
                    </>
                )}
            </div>
        </article>
    );
}

export default function ProbeWindows() {
    const { t } = useTranslation(['blocks', 'common']);
    const nodes = useGraphStore((state) => state.nodes);
    const result = useSimStore((state) => state.result);
    const probeWindowIds = useUiStore((state) => state.probeWindowIds);

    const labels = useMemo(() => {
        const map = new Map<string, string>();

        for (const node of nodes) {
            const fallback = t(node.data.componentType, {
                ns: 'blocks',
                defaultValue: node.data.componentType,
            });
            map.set(node.id, node.data.label || fallback);
        }

        return map;
    }, [nodes, t]);

    const labelOf = useCallback((nodeId: string) => labels.get(nodeId) ?? nodeId, [labels]);

    const windows = probeWindowIds
        .map((probeId) => ({ node: nodes.find((item) => item.id === probeId), reading: result?.probes[probeId] ?? null }))
        .filter(
            (item): item is { node: (typeof nodes)[number]; reading: ProbeReading | null } => item.node !== undefined,
        );

    if (windows.length === 0) return null;

    return (
        <div className="probe-windows nopan nodrag nowheel">
            {windows.map(({ node, reading }, index) => (
                <ProbeWindowCard
                    key={node.id}
                    probeId={node.id}
                    reading={reading}
                    title={labelOf(node.id)}
                    params={node.data.params}
                    index={index}
                    waterfall={result?.waterfalls.find((item) => item.flowId === reading?.flowId) ?? null}
                    timeline={result?.timeline ?? null}
                    labelOf={labelOf}
                />
            ))}
        </div>
    );
}
