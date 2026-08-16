import { Panel } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { UTILIZATION_SCALE, formatHeatRange, heatScale } from '../../utils/heatmap';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import './HeatLegend.css';

export default function HeatLegend() {
    const { t } = useTranslation('common');
    const heatmapOn = useUiStore((state) => state.heatmapOn);
    const heatmapProbeId = useUiStore((state) => state.heatmapProbeId);
    const heatmap = useSimStore((state) =>
        heatmapProbeId ? (state.result?.probes[heatmapProbeId]?.heatmap ?? null) : null,
    );
    const hasResult = useSimStore((state) => state.result !== null);

    if (!heatmapOn || !hasResult) return null;

    const stops = heatmap ? heatScale(heatmap) : UTILIZATION_SCALE;

    return (
        <Panel position="top-right" className="sd-heat-legend">
            <span className="sd-heat-legend-title">
                {heatmap ? t('canvas.heatFromProbe') : t('canvas.heatFromUtilization')}
            </span>
            <ul className="sd-heat-legend-scale">
                {stops.map((stop) => (
                    <li key={stop.level} className={`sd-heat-stop sd-heat-${stop.level}`}>
                        <span className="sd-heat-swatch" />
                        <span className="sd-heat-name">{t(`probe.heatLevel.${stop.level}`)}</span>
                        <span className="sd-heat-range">{formatHeatRange(stop)}</span>
                    </li>
                ))}
            </ul>
        </Panel>
    );
}
