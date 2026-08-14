import { formatNumber } from '../../../utils/format';
import { layoutSparkline } from '../../../utils/series';
import './Sparkline.css';

interface SparklineProps {
    values: number[];
    unit?: string;
    warn?: number;
    alarm?: number;
    compact?: boolean;
    label?: string;
    formatValue?: (value: number) => string;
}

export default function Sparkline({
    values,
    unit = '',
    warn,
    alarm,
    compact = false,
    label,
    formatValue = formatNumber,
}: SparklineProps) {
    const layout = layoutSparkline(values, { warn, alarm });
    const scale = (value: number | null): string => (value === null ? '—' : formatValue(value));

    return (
        <div className={`sd-sparkline ${compact ? 'sd-sparkline-compact' : ''}`}>
            <svg
                className="sd-sparkline-chart"
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={label ?? unit}
            >
                {layout.spans.map((span) => (
                    <rect
                        key={`${span.level}-${span.fromIndex}`}
                        className={`sd-sparkline-span sd-sparkline-span-${span.level}`}
                        x={span.x}
                        y={0}
                        width={span.width}
                        height={layout.height}
                    />
                ))}

                {layout.warnY !== null && (
                    <line
                        className="sd-sparkline-threshold sd-sparkline-threshold-warn"
                        x1={0}
                        y1={layout.warnY}
                        x2={layout.width}
                        y2={layout.warnY}
                        vectorEffect="non-scaling-stroke"
                    />
                )}

                {layout.alarmY !== null && (
                    <line
                        className="sd-sparkline-threshold sd-sparkline-threshold-alarm"
                        x1={0}
                        y1={layout.alarmY}
                        x2={layout.width}
                        y2={layout.alarmY}
                        vectorEffect="non-scaling-stroke"
                    />
                )}

                {layout.area && <polygon className="sd-sparkline-area" points={layout.area} />}

                {layout.line && (
                    <polyline
                        className={`sd-sparkline-line sd-sparkline-line-${layout.lastLevel}`}
                        points={layout.line}
                        vectorEffect="non-scaling-stroke"
                    />
                )}
            </svg>

            <div className="sd-sparkline-scale">
                <span>{scale(layout.min)}</span>
                <span className="sd-sparkline-top">
                    {scale(layout.max)}
                    {unit && <span className="sd-sparkline-unit">{unit}</span>}
                </span>
            </div>
        </div>
    );
}
