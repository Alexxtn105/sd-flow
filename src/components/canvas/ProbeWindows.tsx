import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import Waterfall from '../common/Waterfall/Waterfall';
import type { FlowWaterfall, ProbeReading } from '../../engine/sim/types';
import type { ComponentParams } from '../../engine/types/component';
import { useGraphStore } from '../../store/graphStore';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { formatNumber } from '../../utils/format';
import { WATERFALL_PERCENTILES } from '../../utils/waterfall';
import type { WaterfallPercentile } from '../../utils/waterfall';
import './ProbeWindows.css';

const WATERFALL_PROBE = 'probe-waterfall';

const MAX_INPUTS = 10;

const CARD_STEP_PX = 34;

const CARD_MARGIN_PX = 16;

interface WindowPosition {
    x: number;
    y: number;
}

interface DragState {
    pointerId: number;
    offsetX: number;
    offsetY: number;
}

interface ProbeWindowCardProps {
    probeId: string;
    reading: ProbeReading | null;
    title: string;
    params: ComponentParams;
    index: number;
    waterfall: FlowWaterfall | null;
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

function ProbeWindowCard({ probeId, reading, title, params, index, waterfall, labelOf }: ProbeWindowCardProps) {
    const { t } = useTranslation('common');
    const closeProbeWindow = useUiStore((state) => state.closeProbeWindow);
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
    const placement = position
        ? { left: position.x, top: position.y }
        : { right: CARD_MARGIN_PX, top: CARD_MARGIN_PX + index * CARD_STEP_PX };

    return (
        <article ref={cardRef} className={`probe-window probe-window-${status}`} style={placement}>
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
                    labelOf={labelOf}
                />
            ))}
        </div>
    );
}
