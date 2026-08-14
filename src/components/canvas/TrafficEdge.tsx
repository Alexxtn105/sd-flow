import { memo } from 'react';
import { getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { CallOperation, CallProfile, EdgeKind } from '../../engine/types/scheme';
import type { SdEdge } from '../../store/graphStore';

const STRAND_OFFSET = 2.5;
const MIN_VISIBLE_SHARE = 0.02;

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

function TrafficEdgeView({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
}: EdgeProps<SdEdge>) {
    const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

    const kind = data?.kind ?? 'sync';
    const calls = data?.calls ?? [];
    const strands = visibleStrands(calls);
    const dash = KIND_DASH[kind];
    const width = selected ? 3 : 2;

    if (strands.length === 0) {
        return (
            <path
                id={id}
                className="react-flow__edge-path sd-edge-path"
                d={path}
                fill="none"
                strokeWidth={width}
                style={{ stroke: 'var(--traffic-stream)', strokeDasharray: dash }}
            />
        );
    }

    const offsets = strands.length > 1 ? [-STRAND_OFFSET, STRAND_OFFSET] : [0];

    return (
        <>
            <path className="react-flow__edge-interaction" d={path} fill="none" stroke="transparent" strokeWidth={20} />
            {strands.map((call, index) => (
                <g key={call.id} transform={`translate(0, ${offsets[index] ?? 0})`}>
                    <path
                        id={index === 0 ? id : undefined}
                        className="react-flow__edge-path sd-edge-path"
                        d={path}
                        fill="none"
                        strokeWidth={width}
                        style={{
                            stroke: strandColor(call, kind),
                            strokeDasharray: dash,
                            opacity: 0.35 + 0.65 * call.share,
                        }}
                    />
                </g>
            ))}
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
        </>
    );
}

export default memo(TrafficEdgeView);
