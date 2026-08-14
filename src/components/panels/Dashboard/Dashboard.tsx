import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';
import ResizeHandle from '../../common/ResizeHandle/ResizeHandle';
import type { Finding, FlowWaterfall } from '../../../engine/sim/types';
import { useGraphStore } from '../../../store/graphStore';
import { useSimStore } from '../../../store/simStore';
import { useUiStore } from '../../../store/uiStore';
import { formatNumber } from '../../../utils/format';
import TransientTimeline from './TransientTimeline';
import './Dashboard.css';

type MetricTone = 'default' | 'accent' | 'warn' | 'hot';

interface MetricProps {
    label: string;
    value: string;
    unit?: string;
    hint?: string;
    tone?: MetricTone;
}

function Metric({ label, value, unit, hint, tone = 'default' }: MetricProps) {
    return (
        <div className="dash-metric">
            <span className="dash-metric-label">{label}</span>
            <span className={`dash-metric-value dash-tone-${tone}`}>
                {value}
                {unit ? <span className="dash-metric-unit">{unit}</span> : null}
            </span>
            {hint ? <span className="dash-metric-hint">{hint}</span> : null}
        </div>
    );
}

function percent(value: number, digits: number): string {
    if (!Number.isFinite(value)) return '—';
    return (value * 100).toFixed(digits);
}

type WaterfallPercentile = 'p50' | 'p95' | 'p99';

interface WaterfallViewProps {
    waterfall: FlowWaterfall;
    all: FlowWaterfall[];
    labelOf: (nodeId: string) => string;
    onSelect: (flowId: string) => void;
}

function WaterfallView({ waterfall, all, labelOf, onSelect }: WaterfallViewProps) {
    const { t } = useTranslation('common');
    const [percentile, setPercentile] = useState<WaterfallPercentile>('p99');
    const total = waterfall.total[percentile];
    const covered = waterfall.covered[percentile];

    return (
        <section className="dash-section dash-section-wide dash-waterfall">
            <div className="dash-waterfall-heading">
                <h3 className="dash-section-title">{t('waterfall.title')}</h3>
                <label>
                    <span>{t('waterfall.flow')}</span>
                    <select value={waterfall.flowId} onChange={(event) => onSelect(event.target.value)}>
                        {all.map((item) => (
                            <option key={item.flowId} value={item.flowId}>
                                {labelOf(item.entryNodeId)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>{t('waterfall.percentile')}</span>
                    <select
                        value={percentile}
                        onChange={(event) => setPercentile(event.target.value as WaterfallPercentile)}
                    >
                        <option value="p50">p50</option>
                        <option value="p95">p95</option>
                        <option value="p99">p99</option>
                    </select>
                </label>
                <span className="dash-waterfall-covered">
                    {t('waterfall.covered', {
                        covered: formatNumber(covered),
                        total: formatNumber(total),
                    })}
                </span>
            </div>
            <p className="dash-waterfall-legend">{t('waterfall.legend')}</p>
            <div className="dash-waterfall-list">
                {waterfall.hops.map((hop, index) => {
                    const contribution = hop[`${percentile}Ms`];
                    const elapsed = waterfall.hops
                        .slice(0, index)
                        .reduce((sum, previous) => sum + previous[`${percentile}Ms`], 0);
                    const left = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
                    const width = total > 0 ? Math.max(0.75, Math.min(100 - left, (contribution / total) * 100)) : 0;

                    return (
                        <div key={`${hop.edgeId}-${hop.nodeId}-${index}`} className="dash-waterfall-hop">
                            <span className="dash-waterfall-name" title={labelOf(hop.nodeId)}>
                                {labelOf(hop.nodeId)}
                            </span>
                            <span className="dash-waterfall-track">
                                <span
                                    className={`dash-waterfall-bar dash-waterfall-${hop.arm}`}
                                    style={{ left: `${left}%`, width: `${width}%` }}
                                    title={t('waterfall.contribution', { value: formatNumber(contribution) })}
                                />
                            </span>
                            <span className="dash-waterfall-value">{formatNumber(contribution)} мс</span>
                        </div>
                    );
                })}
                {total > covered && (
                    <div className="dash-waterfall-hop dash-waterfall-residual">
                        <span className="dash-waterfall-name">{t('waterfall.residualLabel')}</span>
                        <span className="dash-waterfall-track">
                            <span
                                className="dash-waterfall-bar"
                                style={{
                                    left: `${Math.min(100, (covered / total) * 100)}%`,
                                    width: `${Math.max(0, ((total - covered) / total) * 100)}%`,
                                }}
                            />
                        </span>
                        <span className="dash-waterfall-value">
                            {t('waterfall.residual', { value: formatNumber(total - covered) })}
                        </span>
                    </div>
                )}
            </div>
        </section>
    );
}

export default function Dashboard() {
    const { t } = useTranslation(['common', 'blocks', 'params']);

    const result = useSimStore((state) => state.result);
    const status = useSimStore((state) => state.status);
    const error = useSimStore((state) => state.error);
    const toggleDashboard = useSimStore((state) => state.toggleDashboard);
    const waterfallFlowId = useSimStore((state) => state.waterfallFlowId);
    const focusWaterfall = useSimStore((state) => state.focusWaterfall);

    const nodes = useGraphStore((state) => state.nodes);
    const setSelection = useUiStore((state) => state.setSelection);
    const height = useUiStore((state) => state.panels.dashboard);

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

    const findingText = useCallback(
        (finding: Finding): string => {
            const values: Record<string, string | number> = {
                nodeNames: finding.nodeIds.map(labelOf).join(', '),
            };

            for (const [key, value] of Object.entries(finding.values)) {
                if (typeof value === 'number') {
                    values[key] = formatNumber(value);
                    values[`${key}Pct`] = formatNumber(value * 100);
                    continue;
                }

                values[key] = key === 'boundBy' ? t(`bound.${value}`, { defaultValue: value }) : value;
            }

            return t(`findings.${finding.code}`, { ...values, defaultValue: finding.code });
        },
        [labelOf, t],
    );

    const totals = result?.totals ?? null;
    const anomalies = result && result.consistency.mode === 'anomalies' ? result.consistency.anomalies : [];
    const multiRegion = result?.multiRegion ?? null;
    const selectedWaterfall = result?.waterfalls.find((item) => item.flowId === waterfallFlowId)
        ?? result?.waterfalls[0]
        ?? null;

    return (
        <section className="dash" style={{ height }}>
            <ResizeHandle panel="dashboard" side="top" label={t('resize.dashboard')} />

            <div className="dash-header">
                <span className="dash-title">{t('dashboard.title')}</span>

                {status === 'running' && (
                    <span className="dash-running">
                        <span className="dash-running-dot" />
                        {t('dashboard.running')}
                    </span>
                )}

                {result && (
                    <span className="dash-meta">
                        <span>{t('dashboard.computeMs', { value: formatNumber(result.computeMs) })}</span>
                        <span>{t('dashboard.iterations', { value: result.iterations })}</span>
                        <span>{t('dashboard.modelVersion', { version: result.modelVersion })}</span>
                        {!result.converged && (
                            <span className="dash-meta-alert">{t('dashboard.notConverged')}</span>
                        )}
                    </span>
                )}

                <button
                    className="dash-close"
                    onClick={toggleDashboard}
                    title={t('dashboard.hide')}
                    aria-label={t('dashboard.hide')}
                >
                    <Icon name="expand_more" size="small" />
                </button>
            </div>

            <div className="dash-body">
                {status === 'error' && (
                    <div className="dash-error">{t('dashboard.failed', { message: error ?? '' })}</div>
                )}

                {!result && status !== 'error' && <div className="dash-empty">{t('dashboard.empty')}</div>}

                {result && totals && (
                    <div className="dash-grid">
                        <section className="dash-section dash-section-wide">
                            <h3 className="dash-section-title">{t('dashboard.section.totals')}</h3>
                            <div className="dash-metrics">
                                <Metric
                                    label={t('dashboard.metric.rps')}
                                    value={formatNumber(totals.rps)}
                                    unit={t('dashboard.unit.rps')}
                                    tone="accent"
                                    hint={t('dashboard.metric.readWrite', {
                                        read: formatNumber(totals.readRps),
                                        write: formatNumber(totals.writeRps),
                                    })}
                                />
                                <Metric
                                    label={t('dashboard.metric.costMonth')}
                                    value={formatNumber(totals.costMonth)}
                                    unit={t('dashboard.unit.usdMonth')}
                                />
                                <Metric
                                    label={t('dashboard.metric.storage')}
                                    value={formatNumber(totals.storageGb)}
                                    unit={t('dashboard.unit.gb')}
                                    hint={t('dashboard.metric.growth', {
                                        value: formatNumber(totals.growthPbYear),
                                        unit: t('dashboard.unit.pbYear'),
                                    })}
                                />
                                <Metric
                                    label={t('dashboard.metric.egress')}
                                    value={formatNumber(totals.egressGbDay)}
                                    unit={t('dashboard.unit.gbDay')}
                                />
                                <Metric
                                    label={t('dashboard.metric.network')}
                                    value={formatNumber(totals.networkGbps)}
                                    unit={t('dashboard.unit.gbps')}
                                />
                                <Metric
                                    label={t('dashboard.metric.availability')}
                                    value={percent(totals.availability, 4)}
                                    unit={t('dashboard.unit.percent')}
                                    hint={t('dashboard.metric.errorBudget', {
                                        value: formatNumber(totals.errorBudgetMinutes),
                                        unit: t('dashboard.unit.minMonth'),
                                    })}
                                />
                            </div>
                        </section>

                        {result.transient && (
                            <TransientTimeline key={result.transient.pattern} result={result.transient} labelOf={labelOf} />
                        )}

                        <section className="dash-section dash-section-flows">
                            <h3 className="dash-section-title">{t('dashboard.section.flows')}</h3>
                            {result.flows.length === 0 ? (
                                <p className="dash-hint">{t('dashboard.noFlows')}</p>
                            ) : (
                                <div className="dash-table dash-table-flows">
                                    <div className="dash-row dash-row-head">
                                        <span>{t('dashboard.flow.entry')}</span>
                                        <span>{t('dashboard.flow.rps')}</span>
                                        <span>{t('dashboard.flow.p50')}</span>
                                        <span>{t('dashboard.flow.p95')}</span>
                                        <span>{t('dashboard.flow.p99')}</span>
                                        <span>{t('dashboard.flow.errors')}</span>
                                        <span>{t('dashboard.flow.timeouts')}</span>
                                    </div>
                                    {result.flows.map((flow) => (
                                        <div key={flow.id} className="dash-row">
                                            <span className="dash-cell-name" title={labelOf(flow.entryNodeId)}>
                                                {labelOf(flow.entryNodeId)}
                                            </span>
                                            <span>{formatNumber(flow.rps)}</span>
                                            <span>{formatNumber(flow.latency.p50)}</span>
                                            <span>{formatNumber(flow.latency.p95)}</span>
                                            <span>{formatNumber(flow.latency.p99)}</span>
                                            <span className={flow.errorRate > 0.01 ? 'dash-tone-hot' : ''}>
                                                {percent(flow.errorRate, 2)}%
                                            </span>
                                            <span className={flow.timeoutShare > 0.01 ? 'dash-tone-warn' : ''}>
                                                {percent(flow.timeoutShare, 2)}%
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {selectedWaterfall && (
                            <WaterfallView
                                waterfall={selectedWaterfall}
                                all={result.waterfalls}
                                labelOf={labelOf}
                                onSelect={focusWaterfall}
                            />
                        )}

                        <section className="dash-section dash-section-findings">
                            <h3 className="dash-section-title">{t('dashboard.section.findings')}</h3>
                            {result.findings.length === 0 ? (
                                <p className="dash-hint">{t('dashboard.noFindings')}</p>
                            ) : (
                                <ul className="dash-findings">
                                    {result.findings.map((finding, index) => (
                                        <li key={`${finding.id}-${index}`}>
                                            <button
                                                type="button"
                                                className={`dash-finding dash-finding-${finding.severity}`}
                                                onClick={() => setSelection(finding.nodeIds, finding.edgeIds)}
                                            >
                                                <span className="dash-finding-dot" />
                                                <span className="dash-finding-text">{findingText(finding)}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {anomalies.length > 0 && (
                            <section className="dash-section dash-section-anomalies">
                                <h3 className="dash-section-title">{t('dashboard.section.consistency')}</h3>
                                <div className="dash-table dash-table-anomalies">
                                    <div className="dash-row dash-row-head">
                                        <span>{t('dashboard.anomaly.code')}</span>
                                        <span>{t('dashboard.anomaly.rate')}</span>
                                        <span>{t('dashboard.anomaly.share')}</span>
                                        <span>{t('dashboard.anomaly.nodes')}</span>
                                    </div>
                                    {anomalies.map((item, index) => (
                                        <div key={`${item.code}-${index}`} className="dash-row">
                                            <span className="dash-cell-name">
                                                {t(`anomaly.${item.code}`, { defaultValue: item.code })}
                                            </span>
                                            <span>
                                                {formatNumber(item.ratePerSec)} {t('dashboard.unit.opsSec')}
                                            </span>
                                            <span>{percent(item.shareOfOperations, 3)}%</span>
                                            <span className="dash-cell-name">
                                                {item.nodeIds.map(labelOf).join(', ')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {multiRegion && (
                            <section className="dash-section dash-section-regions">
                                <h3 className="dash-section-title">{t('dashboard.section.multiRegion')}</h3>

                                <div className="dash-line">
                                    <span className="dash-line-label">{t('dashboard.region.mode')}</span>
                                    <span className="dash-line-value">
                                        {t(`enum.${multiRegion.mode}`, {
                                            ns: 'params',
                                            defaultValue: multiRegion.mode,
                                        })}
                                    </span>
                                </div>

                                <div className="dash-table dash-table-regions">
                                    <div className="dash-row dash-row-head">
                                        <span>{t('dashboard.region.region')}</span>
                                        <span>{t('dashboard.region.traffic')}</span>
                                        <span>{t('dashboard.region.rps')}</span>
                                        <span>{t('dashboard.region.cost')}</span>
                                    </div>
                                    {multiRegion.regions.map((region) => (
                                        <div key={region.nodeId} className="dash-row">
                                            <span className="dash-cell-name">
                                                {region.code || labelOf(region.nodeId)}
                                                <span className="dash-cell-sub">
                                                    {t(`enum.${region.geo}`, {
                                                        ns: 'params',
                                                        defaultValue: region.geo,
                                                    })}
                                                </span>
                                            </span>
                                            <span>{percent(region.trafficShare, 1)}%</span>
                                            <span>{formatNumber(region.rps)}</span>
                                            <span>
                                                {formatNumber(region.costMonth)} {t('dashboard.unit.usdMonth')}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div className="dash-line">
                                    <span className="dash-line-label">{t('dashboard.region.replication')}</span>
                                    <span className="dash-line-value">
                                        {t('dashboard.region.replicationValue', {
                                            rps: formatNumber(multiRegion.replicationRps),
                                            rpsUnit: t('dashboard.unit.opsSec'),
                                            bandwidth: formatNumber(multiRegion.replicationBytesPerSec / 1e6),
                                            bandwidthUnit: t('dashboard.unit.mbSec'),
                                            cost: formatNumber(multiRegion.replicationCostMonth),
                                            costUnit: t('dashboard.unit.usdMonth'),
                                        })}
                                    </span>
                                </div>

                                <div className="dash-line">
                                    <span className="dash-line-label">{t('dashboard.region.rpo')}</span>
                                    <span
                                        className={`dash-line-value ${
                                            multiRegion.rpoSec > multiRegion.rpoTargetSec ? 'dash-tone-hot' : ''
                                        }`}
                                    >
                                        {t('dashboard.region.againstTarget', {
                                            value: formatNumber(multiRegion.rpoSec),
                                            target: formatNumber(multiRegion.rpoTargetSec),
                                            unit: t('dashboard.unit.sec'),
                                        })}
                                    </span>
                                </div>

                                <div className="dash-line">
                                    <span className="dash-line-label">{t('dashboard.region.rto')}</span>
                                    <span
                                        className={`dash-line-value ${
                                            multiRegion.rtoSec > multiRegion.rtoTargetSec ? 'dash-tone-hot' : ''
                                        }`}
                                    >
                                        {t('dashboard.region.againstTarget', {
                                            value: formatNumber(multiRegion.rtoSec),
                                            target: formatNumber(multiRegion.rtoTargetSec),
                                            unit: t('dashboard.unit.sec'),
                                        })}
                                    </span>
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
