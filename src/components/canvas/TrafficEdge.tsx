import { memo } from 'react';
import { EdgeLabelRenderer, getBezierPath, useStore } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { CallOperation, CallProfile, EdgeKind } from '../../engine/types/scheme';
import type { SdEdge } from '../../store/graphStore';
import { useEdgeResult, useNodeResult } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { formatRps } from '../../utils/format';

const STRAND_OFFSET = 2.5;
const MIN_VISIBLE_SHARE = 0.02;
const MIN_WIDTH = 1;
const MAX_WIDTH = 8;
const SATURATION_THRESHOLD = 0.8;
const MIN_LABEL_ZOOM = 0.5;

const OPERATION_COLOR: Record<CallOperation, string> = {
    read: 'var(--traffic-read)',
    write: 'var(--traffic-write)',
    delete: 'var(--traffic-write)',
    scan: 'var(--traffic-read)',
    publish: 'var(--traffic-event)',
    consume: 'var(--traffic-event)',
    transfer: 'var(--traffic-stream)',
};

const KIND_DASH: Record<EdgeKind, string | undefined> = {
    sync: undefined,
    async: '5 5',
    replication: undefined,
    stream: undefined,
    cdc: '8 3',
    batch: '12 4 2 4',
};

function strandColor(call: CallProfile, kind: EdgeKind): string {
    if (kind === 'replication') return 'var(--traffic-replication)';
    if (kind === 'batch') return 'var(--traffic-batch)';
    if (kind === 'stream') return 'var(--traffic-stream)';
    return OPERATION_COLOR[call.op];
}

function visibleStrands(calls: CallProfile[]): CallProfile[] {
    return [...calls]
        .filter((call) => call.share >= MIN_VISIBLE_SHARE)
        .sort((a, b) => b.share - a.share)
        .slice(0, 2);
}

function widthForRps(rps: number): number {
    if (!Number.isFinite(rps) || rps <= 0) return MIN_WIDTH;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, 1 + 1.6 * Math.log10(rps)));
}

function throughputParts(bytesPerSec: number): { value: string; unitKey: string } {
    if (bytesPerSec >= 1e12) return { value: (bytesPerSec / 1e12).toFixed(2), unitKey: 'tbPerSec' };
    if (bytesPerSec >= 1e9) return { value: (bytesPerSec / 1e9).toFixed(2), unitKey: 'gbPerSec' };
    if (bytesPerSec >= 1e6) return { value: (bytesPerSec / 1e6).toFixed(1), unitKey: 'mbPerSec' };
    if (bytesPerSec >= 1e3) return { value: (bytesPerSec / 1e3).toFixed(0), unitKey: 'kbPerSec' };
    return { value: String(Math.round(bytesPerSec)), unitKey: 'bPerSec' };
}

function TrafficEdgeView({
    id,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
}: EdgeProps<SdEdge>) {
    const [path, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const { t } = useTranslation('params');
    const metrics = useEdgeResult(id);
    const targetMetrics = useNodeResult(target);
    const xray = useUiStore((state) => state.xray);
    const readable = useStore((state) => state.transform[2] >= MIN_LABEL_ZOOM);
    const throughput = throughputParts(metrics?.bytesPerSec ?? 0);

    const kind = data?.kind ?? 'sync';
    const calls = data?.calls ?? [];
    const strands = visibleStrands(calls);
    const dash = KIND_DASH[kind];

    const saturated = (targetMetrics?.utilization ?? 0) > SATURATION_THRESHOLD;
    const baseWidth = metrics ? widthForRps(metrics.rps) : 2;
    const width = selected ? baseWidth + 1 : baseWidth;

    const name = data?.label ?? '';
    const showMetrics = xray && metrics != null && metrics.rps > 0;
    const label =
        readable && (name || showMetrics) ? (
            <EdgeLabelRenderer>
                <div
                    className="sd-edge-label nodrag nopan"
                    style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
                >
                    {name && <span className="sd-edge-label-name">{name}</span>}
                    {showMetrics && metrics && (
                        <>
                            <span className="sd-edge-label-rps">
                                {formatRps(metrics.rps)} {t('units.rps')}
                            </span>
                            <span className="sd-edge-label-bytes">
                                {throughput.value} {t(`units.${throughput.unitKey}`)}
                            </span>
                            {metrics.networkMs > 0 && (
                                <span className="sd-edge-label-latency">
                                    {metrics.networkMs.toFixed(1)} {t('units.ms')}
                                </span>
                            )}
                        </>
                    )}
                </div>
            </EdgeLabelRenderer>
        ) : null;

    if (strands.length === 0) {
        return (
            <>
                <path
                    id={id}
                    className="react-flow__edge-path sd-edge-path"
                    d={path}
                    fill="none"
                    strokeWidth={width}
                    style={{ stroke: 'var(--traffic-stream)', strokeDasharray: dash }}
                />
                {label}
            </>
        );
    }

    const offsets = strands.length > 1 ? [-STRAND_OFFSET, STRAND_OFFSET] : [0];

    return (
        <>
            <path className="react-flow__edge-interaction" d={path} fill="none" stroke="transparent" strokeWidth={20} />
            {strands.map((call, index) => {
                const strandRps = metrics ? (metrics.byOperation[call.op] ?? 0) : 0;
                const strandWidth = metrics ? widthForRps(strandRps) : width;

                return (
                    <g key={call.id} transform={`translate(0, ${offsets[index] ?? 0})`}>
                        <path
                            id={index === 0 ? id : undefined}
                            className="react-flow__edge-path sd-edge-path"
                            d={path}
                            fill="none"
                            strokeWidth={selected ? strandWidth + 1 : strandWidth}
                            style={{
                                stroke: saturated ? 'var(--util-hot)' : strandColor(call, kind),
                                strokeDasharray: dash,
                                opacity: 0.35 + 0.65 * call.share,
                            }}
                        />
                    </g>
                );
            })}
            {kind === 'replication' && (
                <g transform={`translate(0, ${STRAND_OFFSET})`}>
                    <path
                        className="react-flow__edge-path sd-edge-path"
                        d={path}
                        fill="none"
                        strokeWidth={width}
                        style={{ stroke: 'var(--traffic-replication)', opacity: 0.9 }}
                    />
                </g>
            )}
            {label}
        </>
    );
}

export default memo(TrafficEdgeView);
