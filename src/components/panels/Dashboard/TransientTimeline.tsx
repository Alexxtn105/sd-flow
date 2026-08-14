import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TransientResult } from '../../../engine/sim/types';
import { formatNumber } from '../../../utils/format';

interface TransientTimelineProps {
    result: TransientResult;
    labelOf: (nodeId: string) => string;
}

function polyline(values: number[], maximum: number, width: number, height: number): string {
    if (values.length === 0) return '';
    return values
        .map((value, index) => {
            const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
            const y = height - (Math.max(0, value) / Math.max(maximum, 1)) * height;
            return `${x},${y}`;
        })
        .join(' ');
}

function clock(totalSec: number): string {
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function TransientTimeline({ result, labelOf }: TransientTimelineProps) {
    const { t } = useTranslation('common');
    const [index, setIndex] = useState(0);
    const point = result.points[Math.min(index, result.points.length - 1)];
    const chart = useMemo(() => {
        const offered = result.points.map((item) => item.offeredRps);
        const throughput = result.points.map((item) => item.throughputRps);
        const maximum = Math.max(1, ...offered);
        return {
            offered: polyline(offered, maximum, 760, 88),
            throughput: polyline(throughput, maximum, 760, 88),
        };
    }, [result]);

    if (!point) return null;

    return (
        <section className="dash-section dash-section-wide transient">
            <div className="transient-heading">
                <h3 className="dash-section-title">{t('transient.title')}</h3>
                <span>{t('transient.pattern', { pattern: t(`scenario.${result.pattern}`) })}</span>
                <strong>{clock(point.timeSec)}</strong>
            </div>

            <svg className="transient-chart" viewBox="0 0 760 88" preserveAspectRatio="none" role="img">
                <polyline className="transient-offered" points={chart.offered} />
                <polyline className="transient-throughput" points={chart.throughput} />
                <line
                    className="transient-cursor"
                    x1={(index / Math.max(result.points.length - 1, 1)) * 760}
                    x2={(index / Math.max(result.points.length - 1, 1)) * 760}
                    y1="0"
                    y2="88"
                />
            </svg>

            <input
                className="transient-scrubber"
                type="range"
                min="0"
                max={Math.max(0, result.points.length - 1)}
                value={index}
                onChange={(event) => setIndex(Number(event.target.value))}
                aria-label={t('transient.scrubber')}
            />

            <div className="transient-legend">
                <span className="transient-legend-offered">{t('transient.offered')}</span>
                <span className="transient-legend-throughput">{t('transient.throughput')}</span>
            </div>

            <div className="dash-metrics transient-metrics">
                <div className="dash-metric">
                    <span className="dash-metric-label">{t('transient.load')}</span>
                    <span className="dash-metric-value">×{formatNumber(point.multiplier)}</span>
                    <span className="dash-metric-hint">{formatNumber(point.offeredRps)} RPS</span>
                </div>
                <div className="dash-metric">
                    <span className="dash-metric-label">{t('transient.queue')}</span>
                    <span className="dash-metric-value">{formatNumber(point.queueDepth)}</span>
                </div>
                <div className="dash-metric">
                    <span className="dash-metric-label">{t('transient.p99')}</span>
                    <span className="dash-metric-value">{formatNumber(point.p99Ms)} мс</span>
                </div>
                <div className="dash-metric">
                    <span className="dash-metric-label">{t('transient.instances')}</span>
                    <span className="dash-metric-value">{formatNumber(point.activeInstances)}</span>
                </div>
                <div className="dash-metric">
                    <span className="dash-metric-label">{t('transient.cacheWarmth')}</span>
                    <span className="dash-metric-value">{formatNumber(point.cacheWarmth * 100)}%</span>
                </div>
                <div className="dash-metric">
                    <span className="dash-metric-label">{t('transient.bottleneck')}</span>
                    <span className="dash-metric-value transient-bottleneck">
                        {point.bottleneckNodeId ? labelOf(point.bottleneckNodeId) : '—'}
                    </span>
                    <span className="dash-metric-hint">
                        {t('transient.errors', { value: formatNumber(point.errorRate * 100) })}
                    </span>
                </div>
            </div>
        </section>
    );
}
