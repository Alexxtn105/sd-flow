import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';
import ResizeHandle from '../../common/ResizeHandle/ResizeHandle';
import ParamInput from '../../common/ParamInput/ParamInput';
import ParamReset from '../../common/ParamInput/ParamReset';
import registry from '../../../engine/ComponentRegistry';
import {
    applyInstancePreset,
    detectInstancePreset,
    INSTANCE_PRESETS,
    supportsInstancePreset,
} from '../../../engine/instancePresets';
import type { InstancePreset } from '../../../engine/instancePresets';
import { protocolOptions } from '../../../engine/ports';
import { clientRpsOf, dauForRps } from '../../../engine/sim/flows';
import type { ComponentParams, Protocol } from '../../../engine/types/component';
import type { EdgeKind, MixMode } from '../../../engine/types/scheme';
import useParamHelp from '../../../hooks/useParamHelp';
import useReference from '../../../hooks/useReference';
import { useGraphStore } from '../../../store/graphStore';
import { useNodeResult } from '../../../store/simStore';
import { useUiStore } from '../../../store/uiStore';
import { formatNumber } from '../../../utils/format';
import { rangeStatus } from '../../../utils/paramRange';
import { groupParams } from '../../../utils/paramSections';
import './Inspector.css';

const EDGE_KINDS: EdgeKind[] = ['sync', 'async', 'replication', 'stream', 'cdc', 'batch'];
const MIX_MODES: MixMode[] = ['inherit', 'manual'];
const CUSTOM_PRESET = 'custom';

function utilizationTone(utilization: number): string {
    if (utilization >= 1) return 'ins-metric-hot';
    if (utilization >= 0.8) return 'ins-metric-warm';

    return '';
}

export default function Inspector() {
    const { t } = useTranslation(['common', 'params', 'blocks', 'groups', 'hints']);
    const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
    const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
    const toggleInspector = useUiStore((state) => state.toggleInspector);
    const openBlockHelp = useUiStore((state) => state.openBlockHelp);
    const paramHints = useUiStore((state) => state.paramHints);
    const toggleParamHints = useUiStore((state) => state.toggleParamHints);
    const width = useUiStore((state) => state.panels.inspector);

    const nodes = useGraphStore((state) => state.nodes);
    const edges = useGraphStore((state) => state.edges);
    const updateNodeParam = useGraphStore((state) => state.updateNodeParam);
    const beginTransaction = useGraphStore((state) => state.beginTransaction);
    const commitTransaction = useGraphStore((state) => state.commitTransaction);
    const updateNodeLabel = useGraphStore((state) => state.updateNodeLabel);
    const updateEdgeCall = useGraphStore((state) => state.updateEdgeCall);
    const updateEdgeMixMode = useGraphStore((state) => state.updateEdgeMixMode);
    const updateEdgeKind = useGraphStore((state) => state.updateEdgeKind);
    const updateEdgeProtocol = useGraphStore((state) => state.updateEdgeProtocol);
    const updateEdgeLabel = useGraphStore((state) => state.updateEdgeLabel);

    const node = selectedNodeIds.length === 1 ? nodes.find((item) => item.id === selectedNodeIds[0]) : undefined;
    const edge = selectedEdgeIds.length === 1 ? edges.find((item) => item.id === selectedEdgeIds[0]) : undefined;
    const definition = node ? registry.get(node.data.componentType) : null;

    useReference(['hints'], Boolean(node));
    const paramHelp = useParamHelp();
    const metrics = useNodeResult(node?.id);

    const sections = useMemo(
        () => (node && definition ? groupParams(node.data.params, definition.paramSchema) : []),
        [definition, node],
    );

    const edgeProtocols = useMemo(() => {
        if (!edge) return [];

        const source = nodes.find((item) => item.id === edge.source);
        const target = nodes.find((item) => item.id === edge.target);
        if (!source || !target) return [];

        return protocolOptions(
            source.data.componentType,
            edge.sourceHandle ?? '',
            target.data.componentType,
            edge.targetHandle ?? '',
        );
    }, [edge, nodes]);

    const defaults: ComponentParams = definition ? registry.getDefaultParams(definition.id) : {};
    const presetSupported = definition !== null && supportsInstancePreset(defaults);
    const preset = presetSupported && node ? detectInstancePreset(defaults, node.data.params) : null;
    const clientRps = node && definition?.group === 'clients' ? clientRpsOf(definition.id, node.data.params) : null;
    const rpsEditable = node !== undefined && dauForRps(node?.data.params ?? {}, 1) !== null;

    const applyPreset = (value: InstancePreset) => {
        if (!node) return;

        beginTransaction();
        for (const [key, patched] of Object.entries(applyInstancePreset(defaults, value))) {
            updateNodeParam(node.id, key, patched);
        }
        commitTransaction();
    };

    const mirrorSource = node && typeof node.data.mirrorOf === 'string' ? node.data.mirrorOf : '';
    const mirrorParam = node && typeof node.data.params.mirrorOf === 'string' ? node.data.params.mirrorOf : '';

    const edgeHint = (key: string): string => t(`inspector.edgeHint.${key}`);

    const applyRps = (rps: number) => {
        if (!node) return;

        const dau = dauForRps(node.data.params, rps);
        if (dau !== null) updateNodeParam(node.id, 'dau', Math.round(dau));
    };

    return (
        <aside className="ins" style={{ width }}>
            <ResizeHandle panel="inspector" side="left" label={t('resize.inspector')} />

            <div className="ins-header">
                <span className="ins-title">{t('inspector.title')}</span>
                <button className="ins-close" onClick={toggleInspector} aria-label={t('dialog.close')}>
                    <Icon name="chevron_right" size="small" />
                </button>
            </div>

            <div className="ins-body">
                {!node && !edge && (
                    <div className="ins-empty">
                        {selectedNodeIds.length + selectedEdgeIds.length > 1
                            ? t('inspector.multiple', { count: selectedNodeIds.length + selectedEdgeIds.length })
                            : t('inspector.empty')}
                    </div>
                )}

                {node && definition && (
                    <>
                        <div className="ins-node-head">
                            <span className="ins-node-icon">
                                <Icon name={definition.icon} size="medium" />
                            </span>
                            <div className="ins-node-meta">
                                <span className="ins-node-type">
                                    {t(definition.id, { ns: 'blocks', defaultValue: definition.id })}
                                </span>
                                <span className="ins-node-group">
                                    {t(definition.group, { ns: 'groups', defaultValue: definition.group })}
                                </span>
                            </div>
                            <button
                                className="ins-help-btn"
                                onClick={() => openBlockHelp(definition.id)}
                                title={t('inspector.help')}
                                aria-label={t('inspector.help')}
                            >
                                <Icon name="help_outline" size="small" />
                            </button>
                        </div>

                        {metrics && (
                            <div className="ins-metrics">
                                <div className="ins-metric">
                                    <span className="ins-metric-label">{t('inspector.metric.lambda')}</span>
                                    <span className="ins-metric-value">
                                        {formatNumber(metrics.throughput)}
                                        <span className="ins-metric-unit">{t('dashboard.unit.rps')}</span>
                                    </span>
                                </div>
                                <div className="ins-metric">
                                    <span className="ins-metric-label">{t('inspector.metric.utilization')}</span>
                                    <span className={`ins-metric-value ${utilizationTone(metrics.utilization)}`}>
                                        {formatNumber(Math.round(metrics.utilization * 100) / 100)}
                                    </span>
                                </div>
                                <div className="ins-metric">
                                    <span className="ins-metric-label">{t('inspector.metric.response')}</span>
                                    <span className="ins-metric-value">
                                        {formatNumber(
                                            Math.round((metrics.serviceSec + metrics.waitSec) * 100000) / 100,
                                        )}
                                        <span className="ins-metric-unit">{t('units.ms', { ns: 'params' })}</span>
                                    </span>
                                </div>
                                <div className="ins-metric">
                                    <span className="ins-metric-label">{t('inspector.metric.cost')}</span>
                                    <span className="ins-metric-value">
                                        {formatNumber(metrics.cost.total)}
                                        <span className="ins-metric-unit">{t('dashboard.unit.usdMonth')}</span>
                                    </span>
                                </div>
                                <p className="ins-metrics-bound">
                                    {t('inspector.metric.boundBy', {
                                        bound: t(`bound.${metrics.boundBy}`, { defaultValue: metrics.boundBy }),
                                        capacity: formatNumber(metrics.capacity),
                                        instances: metrics.instances,
                                    })}
                                </p>
                            </div>
                        )}

                        <button
                            className={`ins-descriptions ${paramHints ? 'active' : ''}`}
                            onClick={toggleParamHints}
                            title={t('inspector.descriptionsTitle')}
                            aria-pressed={paramHints}
                        >
                            <Icon name={paramHints ? 'visibility' : 'visibility_off'} size="small" />
                            <span className="ins-descriptions-text">{t('inspector.descriptions')}</span>
                        </button>

                        <div className="ins-row">
                            <label className="ins-label" htmlFor="ins-label-input">
                                {t('inspector.label')}
                            </label>
                            <input
                                id="ins-label-input"
                                type="text"
                                className="ins-input"
                                value={node.data.label}
                                placeholder={t('inspector.labelPlaceholder')}
                                onChange={(event) => updateNodeLabel(node.id, event.target.value)}
                            />
                        </div>

                        {mirrorSource.length > 0 && (
                            <p className="ins-note">{t('inspector.mirrorNote', { source: mirrorSource })}</p>
                        )}

                        {mirrorParam.length > 0 && (
                            <button
                                type="button"
                                className="ins-descriptions"
                                onClick={() => updateNodeParam(node.id, 'mirrorOf', '')}
                            >
                                <Icon name="link_off" size="small" />
                                <span className="ins-descriptions-text">{t('inspector.unlinkMirror')}</span>
                            </button>
                        )}

                        {presetSupported && (
                            <div className="ins-row">
                                <label className="ins-label" htmlFor="ins-preset">
                                    {t('inspector.preset')}
                                </label>
                                <select
                                    id="ins-preset"
                                    className="ins-input"
                                    value={preset ?? CUSTOM_PRESET}
                                    onChange={(event) => applyPreset(event.target.value as InstancePreset)}
                                >
                                    {preset === null && (
                                        <option value={CUSTOM_PRESET}>{t('inspector.presetCustom')}</option>
                                    )}
                                    {INSTANCE_PRESETS.map((item) => (
                                        <option key={item} value={item}>
                                            {t(`inspector.presetSize.${item}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {clientRps !== null && rpsEditable && (
                            <div className="ins-param">
                                <div className="ins-row">
                                    <label className="ins-label" htmlFor="ins-derived-rps">
                                        {t('inspector.derivedRps')}
                                    </label>
                                    <span className="ins-field">
                                        <input
                                            id="ins-derived-rps"
                                            type="number"
                                            className="ins-input"
                                            min={0}
                                            step="any"
                                            value={Math.round(clientRps * 100) / 100}
                                            onChange={(event) => {
                                                const parsed = Number.parseFloat(event.target.value);
                                                if (Number.isFinite(parsed) && parsed >= 0) applyRps(parsed);
                                            }}
                                        />
                                        <span className="ins-unit">{t('dashboard.unit.rps')}</span>
                                    </span>
                                </div>
                                <p className="ins-hint">{t('inspector.derivedRpsHint')}</p>
                            </div>
                        )}

                        {sections.map(({ section, entries }) => (
                            <section key={section} className="ins-section">
                                <h3 className="ins-section-title">{t(`section.${section}`)}</h3>
                                {entries.map(({ key, value, field }) => {
                                    const help = paramHelp(key, field);
                                    const span = help.realistic || help.limits;
                                    const spanLabel = help.realistic
                                        ? t('inspector.realistic')
                                        : t('inspector.limits');
                                    const spanText = span
                                        ? `${spanLabel}: ${span}${help.unit ? ` ${help.unit}` : ''}`
                                        : '';
                                    const labelTitle = [`${help.name} · ${key}`, help.hint, spanText]
                                        .filter(Boolean)
                                        .join('\n');

                                    return (
                                        <div key={key} className="ins-param">
                                            <div className="ins-row">
                                                <label
                                                    className="ins-label ins-label-help"
                                                    htmlFor={`ins-param-${key}`}
                                                    title={labelTitle}
                                                >
                                                    {help.name}
                                                </label>
                                                <span className="ins-field">
                                                    <ParamInput
                                                        id={`ins-param-${key}`}
                                                        field={field}
                                                        value={value}
                                                        label={help.name}
                                                        defaultValue={definition.defaultParams[key]}
                                                        withSlider
                                                        onChange={(next) => updateNodeParam(node.id, key, next)}
                                                    />
                                                    <span className="ins-unit">{help.unit}</span>
                                                    <ParamReset
                                                        value={value}
                                                        defaultValue={definition.defaultParams[key]}
                                                        onReset={(next) => updateNodeParam(node.id, key, next)}
                                                    />
                                                </span>
                                            </div>
                                            {rangeStatus(value, field) !== 'ok' && (
                                                <p className={`ins-warn ins-warn-${rangeStatus(value, field)}`}>
                                                    {t(
                                                        rangeStatus(value, field) === 'error'
                                                            ? 'inspector.outOfLimits'
                                                            : 'inspector.outOfRealistic',
                                                        { span: spanText || (help.realistic || help.limits) },
                                                    )}
                                                </p>
                                            )}
                                            {paramHints && (help.hint || spanText) && (
                                                <p className="ins-hint">
                                                    {help.hint}
                                                    {spanText && (
                                                        <span className="ins-hint-span">{spanText}</span>
                                                    )}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </section>
                        ))}

                        <section className="ins-section">
                            <h3 className="ins-section-title">{t('inspector.ports')}</h3>
                            <div className="ins-ports">
                                <span className="ins-port-label">{t('inspector.portsIn')}</span>
                                <span className="ins-port-list">
                                    {definition.ports.in.map((port) => port.id).join(', ') || '—'}
                                </span>
                                <span className="ins-port-label">{t('inspector.portsOut')}</span>
                                <span className="ins-port-list">
                                    {definition.ports.out.map((port) => port.id).join(', ') || '—'}
                                </span>
                            </div>
                        </section>

                        {!definition.model && <p className="ins-note">{t('inspector.noModel')}</p>}
                    </>
                )}

                {edge && (
                    <>
                        <div className="ins-node-head">
                            <span className="ins-node-icon">
                                <Icon name="sd-link" size="medium" />
                            </span>
                            <div className="ins-node-meta">
                                <span className="ins-node-type">{t('inspector.edge')}</span>
                                <span className="ins-node-group">
                                    {edge.source} → {edge.target}
                                </span>
                            </div>
                        </div>

                        <button
                            className={`ins-descriptions ${paramHints ? 'active' : ''}`}
                            onClick={toggleParamHints}
                            title={t('inspector.descriptionsTitle')}
                            aria-pressed={paramHints}
                        >
                            <Icon name={paramHints ? 'visibility' : 'visibility_off'} size="small" />
                            <span className="ins-descriptions-text">{t('inspector.descriptions')}</span>
                        </button>

                        <div className="ins-param">
                            <div className="ins-row">
                                <label
                                    className="ins-label ins-label-help"
                                    htmlFor="ins-edge-label-input"
                                    title={edgeHint('label')}
                                >
                                    {t('inspector.edgeLabel')}
                                </label>
                                <input
                                    id="ins-edge-label-input"
                                    type="text"
                                    className="ins-input"
                                    value={edge.data?.label ?? ''}
                                    placeholder={t('inspector.edgeLabelPlaceholder')}
                                    onChange={(event) => updateEdgeLabel(edge.id, event.target.value)}
                                />
                            </div>
                            {paramHints && <p className="ins-hint">{edgeHint('label')}</p>}
                        </div>

                        <div className="ins-param">
                            <div className="ins-row">
                                <label
                                    className="ins-label ins-label-help"
                                    htmlFor="ins-edge-kind"
                                    title={edgeHint('kind')}
                                >
                                    {t('inspector.edgeKind')}
                                </label>
                                <select
                                    id="ins-edge-kind"
                                    className="ins-input"
                                    value={edge.data?.kind ?? 'sync'}
                                    onChange={(event) => updateEdgeKind(edge.id, event.target.value as EdgeKind)}
                                >
                                    {EDGE_KINDS.map((kind) => (
                                        <option key={kind} value={kind}>
                                            {t(`edgeKind.${kind}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {paramHints && <p className="ins-hint">{edgeHint('kind')}</p>}
                        </div>

                        {edgeProtocols.length > 0 && (
                            <div className="ins-param">
                                <div className="ins-row">
                                    <label
                                        className="ins-label ins-label-help"
                                        htmlFor="ins-edge-protocol"
                                        title={edgeHint('protocol')}
                                    >
                                        {t('inspector.edgeProtocol')}
                                    </label>
                                    <select
                                        id="ins-edge-protocol"
                                        className="ins-input"
                                        value={edge.data?.protocol ?? edgeProtocols[0]}
                                        onChange={(event) =>
                                            updateEdgeProtocol(edge.id, event.target.value as Protocol)
                                        }
                                    >
                                        {edgeProtocols.map((protocol) => (
                                            <option key={protocol} value={protocol}>
                                                {t(`protocol.${protocol}`)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {paramHints && <p className="ins-hint">{edgeHint('protocol')}</p>}
                            </div>
                        )}

                        <section className="ins-section">
                            <h3 className="ins-section-title">{t('inspector.calls')}</h3>

                            <div className="ins-param">
                                <div className="ins-row">
                                    <label
                                        className="ins-label ins-label-help"
                                        htmlFor="ins-edge-mix"
                                        title={edgeHint('mixMode')}
                                    >
                                        {t('inspector.edgeMix')}
                                    </label>
                                    <select
                                        id="ins-edge-mix"
                                        className="ins-input"
                                        value={edge.data?.mixMode ?? 'inherit'}
                                        onChange={(event) =>
                                            updateEdgeMixMode(edge.id, event.target.value as MixMode)
                                        }
                                    >
                                        {MIX_MODES.map((mode) => (
                                            <option key={mode} value={mode}>
                                                {t(
                                                    mode === 'inherit'
                                                        ? 'inspector.edgeMixInherit'
                                                        : 'inspector.edgeMixManual',
                                                )}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {paramHints && <p className="ins-hint">{edgeHint('mixMode')}</p>}
                            </div>

                            {(edge.data?.calls ?? []).map((call) => (
                                <div key={call.id} className="ins-call" title={edgeHint('call')}>
                                    <div className="ins-call-head">
                                        <span className={`ins-call-dot ins-call-${call.op}`} />
                                        <span className="ins-call-name">{t(`op.${call.op}`)}</span>
                                        <span className="ins-call-share">{Math.round(call.share * 100)}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        className="ins-slider"
                                        min={0}
                                        max={100}
                                        value={Math.round(call.share * 100)}
                                        onChange={(event) =>
                                            updateEdgeCall(edge.id, call.id, Number(event.target.value) / 100)
                                        }
                                    />
                                </div>
                            ))}
                            {paramHints && (edge.data?.calls ?? []).length > 0 && (
                                <p className="ins-hint">{edgeHint('call')}</p>
                            )}
                        </section>

                        <section className="ins-section">
                            <h3 className="ins-section-title">{t('inspector.policy')}</h3>
                            <div className="ins-param">
                                <div className="ins-row">
                                    <span className="ins-label ins-label-help" title={edgeHint('timeoutMs')}>
                                        {t('policy.timeoutMs')}
                                    </span>
                                    <span className="ins-static">{edge.data?.policy.timeoutMs}</span>
                                </div>
                                {paramHints && <p className="ins-hint">{edgeHint('timeoutMs')}</p>}
                            </div>
                            <div className="ins-param">
                                <div className="ins-row">
                                    <span className="ins-label ins-label-help" title={edgeHint('retries')}>
                                        {t('policy.retries')}
                                    </span>
                                    <span className="ins-static">{edge.data?.policy.retries}</span>
                                </div>
                                {paramHints && <p className="ins-hint">{edgeHint('retries')}</p>}
                            </div>
                        </section>
                    </>
                )}
            </div>
        </aside>
    );
}
