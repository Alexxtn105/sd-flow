import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProbeReading } from '../../engine/sim/types';
import { useGraphStore } from '../../store/graphStore';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { formatNumber } from '../../utils/format';
import Icon from '../common/Icons/Icon';
import './ProbeWindows.css';

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
    reading: ProbeReading;
    title: string;
    index: number;
    nodeLabels: Map<string, string>;
}

const EMPTY_READINGS: Record<string, ProbeReading> = {};

function shownInput(value: string | number, nodeLabels: Map<string, string>): string {
    if (typeof value === 'number') return formatNumber(value);
    return nodeLabels.get(value) ?? value;
}

function ProbeWindowCard({ reading, title, index, nodeLabels }: ProbeWindowCardProps) {
    const { t } = useTranslation('common');
    const close = useUiStore((state) => state.closeProbeWindow);
    const focusWaterfall = useSimStore((state) => state.focusWaterfall);
    const cardRef = useRef<HTMLElement>(null);
    const [position, setPosition] = useState<WindowPosition | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);

    const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
        const card = cardRef.current;
        const container = card?.parentElement;
        if (!card || !container) return;

        const cardRect = card.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const current = { x: cardRect.left - containerRect.left, y: cardRect.top - containerRect.top };
        setPosition(current);
        setDrag({
            pointerId: event.pointerId,
            offsetX: event.clientX - cardRect.left,
            offsetY: event.clientY - cardRect.top,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const card = cardRef.current;
        const container = card?.parentElement;
        if (!card || !container) return;

        const bounds = container.getBoundingClientRect();
        const width = card.offsetWidth;
        const height = card.offsetHeight;
        setPosition({
            x: Math.max(0, Math.min(bounds.width - width, event.clientX - bounds.left - drag.offsetX)),
            y: Math.max(0, Math.min(bounds.height - height, event.clientY - bounds.top - drag.offsetY)),
        });
    };

    const stopDrag = (event: ReactPointerEvent<HTMLElement>) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        setDrag(null);
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const inputs = Object.entries(reading.explain.inputs).slice(0, 8);

    return (
        <article
            ref={cardRef}
            className={`probe-window probe-window-${reading.status}`}
            style={position ? { left: position.x, top: position.y } : { right: 18, top: 18 + index * 36 }}
        >
            <header
                className="probe-window-header"
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
            >
                <span className="probe-window-title">{title}</span>
                <span className="probe-window-status">{t(`probe.status.${reading.status}`)}</span>
                <button
                    type="button"
                    className="probe-window-close"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => close(reading.probeId)}
                    title={t('probe.closeWindow')}
                    aria-label={t('probe.closeWindow')}
                >
                    <Icon name="close" size="small" />
                </button>
            </header>

            <div className="probe-window-body">
                {reading.status === 'no-data' ? (
                    <p className="probe-window-reason">
                        {t(`probe.reason.${reading.reason ?? 'unattached'}`)}
                    </p>
                ) : (
                    <>
                        <div className="probe-window-value">
                            {formatNumber(reading.value)}
                            <span>{t(`probe.unit.${reading.unit}`)}</span>
                        </div>
                        <p className="probe-window-formula">{reading.explain.formula}</p>
                        {inputs.length > 0 && (
                            <dl className="probe-window-inputs">
                                {inputs.map(([key, value]) => (
                                    <div key={key}>
                                        <dt>{key}</dt>
                                        <dd>{shownInput(value, nodeLabels)}</dd>
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
    const { t } = useTranslation(['blocks']);
    const nodes = useGraphStore((state) => state.nodes);
    const readings = useSimStore((state) => state.result?.probes ?? EMPTY_READINGS);
    const openIds = useUiStore((state) => state.probeWindowIds);

    const nodeLabels = useMemo(
        () =>
            new Map(
                nodes.map((node) => [
                    node.id,
                    node.data.label || t(node.data.componentType, { ns: 'blocks', defaultValue: node.data.componentType }),
                ]),
            ),
        [nodes, t],
    );

    const windows = openIds
        .map((id) => ({ node: nodes.find((node) => node.id === id), reading: readings[id] }))
        .filter((item): item is { node: (typeof nodes)[number]; reading: ProbeReading } =>
            Boolean(item.node && item.reading),
        );

    if (windows.length === 0) return null;

    return (
        <div className="probe-windows" aria-live="polite">
            {windows.map(({ node, reading }, index) => (
                <ProbeWindowCard
                    key={node.id}
                    reading={reading}
                    title={
                        node.data.label ||
                        t(node.data.componentType, { ns: 'blocks', defaultValue: node.data.componentType })
                    }
                    index={index}
                    nodeLabels={nodeLabels}
                />
            ))}
        </div>
    );
}
