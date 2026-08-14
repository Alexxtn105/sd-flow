import type { LatencyHistogram } from '../../../engine/sim/types';
import { formatNumber } from '../../../utils/format';
import { layoutHistogram } from '../../../utils/histogram';
import './Histogram.css';

const COMPACT_TICKS = 2;

interface HistogramProps {
    histogram: LatencyHistogram;
    unit?: string;
    compact?: boolean;
    label?: string;
    formatValue?: (value: number) => string;
}

export default function Histogram({
    histogram,
    unit = '',
    compact = false,
    label,
    formatValue = formatNumber,
}: HistogramProps) {
    const layout = layoutHistogram(histogram, compact ? { ticks: COMPACT_TICKS } : {});

    return (
        <div className={`sd-histogram ${compact ? 'sd-histogram-compact' : ''}`}>
            <svg
                className="sd-histogram-chart"
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={label ?? unit}
            >
                {layout.tail && (
                    <rect
                        className="sd-histogram-tail"
                        x={layout.tail.x}
                        y={0}
                        width={layout.tail.width}
                        height={layout.height}
                    />
                )}

                {layout.bars.map((bar) => (
                    <rect
                        key={bar.index}
                        className={`sd-histogram-bar ${bar.tail ? 'sd-histogram-bar-tail' : ''}`}
                        x={bar.x}
                        y={bar.y}
                        width={bar.width}
                        height={bar.height}
                    />
                ))}

                {layout.markers.map((marker) => (
                    <line
                        key={marker.key}
                        className={`sd-histogram-marker sd-histogram-marker-${marker.key}`}
                        x1={marker.x}
                        y1={0}
                        x2={marker.x}
                        y2={layout.height}
                        vectorEffect="non-scaling-stroke"
                    />
                ))}
            </svg>

            <div className="sd-histogram-axis">
                {layout.ticks.map((tick) => (
                    <span key={tick.index} className="sd-histogram-tick">
                        {formatValue(tick.value)}
                    </span>
                ))}
                {unit && <span className="sd-histogram-unit">{unit}</span>}
            </div>

            <div className="sd-histogram-markers">
                {layout.markers.map((marker) => (
                    <span key={marker.key} className={`sd-histogram-tag sd-histogram-tag-${marker.key}`}>
                        {marker.key} {formatValue(marker.value)}
                    </span>
                ))}
            </div>
        </div>
    );
}
