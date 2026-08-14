import { useTranslation } from 'react-i18next';

interface LegendRow {
    labelKey: string;
    color: string;
    dash?: string;
    doubled?: boolean;
}

const ROWS: LegendRow[] = [
    { labelKey: 'legend.read', color: 'var(--traffic-read)' },
    { labelKey: 'legend.write', color: 'var(--traffic-write)' },
    { labelKey: 'legend.replication', color: 'var(--traffic-replication)', doubled: true },
    { labelKey: 'legend.event', color: 'var(--traffic-event)', dash: '5 5' },
    { labelKey: 'legend.stream', color: 'var(--traffic-stream)' },
    { labelKey: 'legend.batch', color: 'var(--traffic-batch)', dash: '12 4 2 4' },
];

export default function TrafficLegend() {
    const { t } = useTranslation();

    return (
        <div className="pal-legend-panel">
            {ROWS.map((row) => (
                <div key={row.labelKey} className="pal-legend-item">
                    <svg width="34" height="8" aria-hidden="true">
                        <line
                            x1="0"
                            y1={row.doubled ? 2 : 4}
                            x2="34"
                            y2={row.doubled ? 2 : 4}
                            stroke={row.color}
                            strokeWidth="2"
                            strokeDasharray={row.dash}
                        />
                        {row.doubled && <line x1="0" y1="6" x2="34" y2="6" stroke={row.color} strokeWidth="2" />}
                    </svg>
                    <span className="pal-legend-label">{t(row.labelKey)}</span>
                </div>
            ))}
            <div className="pal-legend-note">{t('legend.thickness')}</div>
        </div>
    );
}
