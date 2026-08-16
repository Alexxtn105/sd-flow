import { useTranslation } from 'react-i18next';
import type { FlowWaterfall, WaterfallHop } from '../../../engine/sim/types';
import { formatNumber } from '../../../utils/format';
import { layoutWaterfall } from '../../../utils/waterfall';
import type { WaterfallPercentile } from '../../../utils/waterfall';
import './Waterfall.css';

const INDENT_PX = 9;

const RESIDUAL_EPSILON_MS = 0.05;

interface WaterfallProps {
    waterfall: FlowWaterfall;
    percentile: WaterfallPercentile;
    labelOf: (nodeId: string) => string;
    limit?: number;
    compact?: boolean;
}

export default function Waterfall({ waterfall, percentile, labelOf, limit, compact = false }: WaterfallProps) {
    const { t } = useTranslation('common');
    const layout = layoutWaterfall(waterfall, percentile, limit);

    const notesOf = (hop: WaterfallHop): string => {
        const notes = [t(`waterfall.arm.${hop.arm}`)];

        if (hop.visitsPerRequest < 0.999) {
            notes.push(t('waterfall.shareOfRequests', { value: formatNumber(hop.visitsPerRequest * 100) }));
        }
        if (hop.cacheMissShare !== null) {
            notes.push(t('waterfall.cacheMiss', { value: formatNumber(hop.cacheMissShare * 100) }));
        }
        if (hop.trafficShare < 1) {
            notes.push(t('waterfall.split', { value: formatNumber(hop.trafficShare * 100) }));
        }
        if (hop.callsPerRequest > 1) {
            notes.push(t('waterfall.fanout', { value: formatNumber(hop.callsPerRequest) }));
        }

        return notes.join(' · ');
    };

    return (
        <div className={`sd-waterfall ${compact ? 'sd-waterfall-compact' : ''}`}>
            <div className="sd-waterfall-summary">
                <span className="sd-waterfall-covered">
                    {t('waterfall.covered', {
                        covered: formatNumber(layout.coveredMs),
                        total: formatNumber(layout.totalMs),
                    })}
                </span>
                {!compact && <span className="sd-waterfall-legend">{t('waterfall.legend')}</span>}
            </div>

            <div className="sd-waterfall-rows">
                {layout.bars.map((bar) => (
                    <div key={bar.key} className="sd-waterfall-row" title={notesOf(bar.hop)}>
                        <span
                            className="sd-waterfall-name"
                            style={{ paddingLeft: Math.min(bar.hop.depth, 6) * INDENT_PX }}
                        >
                            {labelOf(bar.hop.nodeId)}
                        </span>
                        <span className="sd-waterfall-track">
                            <span
                                className={`sd-waterfall-bar sd-waterfall-${bar.hop.arm}`}
                                style={{ left: `${bar.offsetPercent}%`, width: `${bar.widthPercent}%` }}
                            />
                        </span>
                        <span className="sd-waterfall-value">
                            {t('waterfall.contribution', { value: formatNumber(bar.contributionMs) })}
                        </span>
                    </div>
                ))}

                {layout.hiddenCount > 0 && (
                    <div className="sd-waterfall-row sd-waterfall-row-folded">
                        <span className="sd-waterfall-name">
                            {t('waterfall.hidden', { value: layout.hiddenCount })}
                        </span>
                        <span className="sd-waterfall-track" />
                        <span className="sd-waterfall-value">
                            {t('waterfall.contribution', { value: formatNumber(layout.hiddenMs) })}
                        </span>
                    </div>
                )}

                {layout.residualMs > RESIDUAL_EPSILON_MS && (
                    <div className="sd-waterfall-row sd-waterfall-row-residual">
                        <span className="sd-waterfall-name">{t('waterfall.residualLabel')}</span>
                        <span className="sd-waterfall-track">
                            <span
                                className="sd-waterfall-bar sd-waterfall-residual"
                                style={{
                                    left: `${layout.residualOffsetPercent}%`,
                                    width: `${layout.residualWidthPercent}%`,
                                }}
                            />
                        </span>
                        <span className="sd-waterfall-value">
                            {t('waterfall.residual', { value: formatNumber(layout.residualMs) })}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
