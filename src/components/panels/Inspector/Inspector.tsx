import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';
import registry from '../../../engine/ComponentRegistry';
import type { ParamField, ParamSection, ParamValue } from '../../../engine/types/component';
import type { EdgeKind } from '../../../engine/types/scheme';
import { useGraphStore } from '../../../store/graphStore';
import { useUiStore } from '../../../store/uiStore';
import './Inspector.css';

const SECTION_ORDER: ParamSection[] = [
    'scale',
    'performance',
    'capacity',
    'behaviour',
    'consistency',
    'data',
    'reliability',
    'topology',
    'cost',
];

const EDGE_KINDS: EdgeKind[] = ['sync', 'async', 'replication', 'stream', 'cdc', 'batch'];

export default function Inspector() {
    const { t } = useTranslation(['common', 'params', 'blocks', 'groups']);
    const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
    const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
    const toggleInspector = useUiStore((state) => state.toggleInspector);

    const nodes = useGraphStore((state) => state.nodes);
    const edges = useGraphStore((state) => state.edges);
    const updateNodeParam = useGraphStore((state) => state.updateNodeParam);
    const updateNodeLabel = useGraphStore((state) => state.updateNodeLabel);
    const updateEdgeCall = useGraphStore((state) => state.updateEdgeCall);
    const updateEdgeKind = useGraphStore((state) => state.updateEdgeKind);

    const node = selectedNodeIds.length === 1 ? nodes.find((item) => item.id === selectedNodeIds[0]) : undefined;
    const edge = selectedEdgeIds.length === 1 ? edges.find((item) => item.id === selectedEdgeIds[0]) : undefined;
    const definition = node ? registry.get(node.data.componentType) : null;

    const sections = useMemo(() => {
        if (!node || !definition) return [];
        const grouped = new Map<ParamSection, [string, ParamValue][]>();

        for (const [key, value] of Object.entries(node.data.params)) {
            const field: ParamField | undefined = definition.paramSchema[key];
            const section = field?.section ?? 'behaviour';
            const bucket = grouped.get(section) ?? [];
            bucket.push([key, value]);
            grouped.set(section, bucket);
        }

        return SECTION_ORDER.filter((section) => grouped.has(section)).map((section) => ({
            section,
            entries: grouped.get(section) ?? [],
        }));
    }, [definition, node]);

    const renderField = (key: string, value: ParamValue) => {
        if (!node || !definition) return null;
        const field: ParamField | undefined = definition.paramSchema[key];

        if (field?.kind === 'boolean') {
            return (
                <input
                    type="checkbox"
                    className="ins-checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => updateNodeParam(node.id, key, event.target.checked)}
                />
            );
        }

        if (field?.kind === 'enum') {
            return (
                <select
                    className="ins-input"
                    value={String(value)}
                    onChange={(event) => updateNodeParam(node.id, key, event.target.value)}
                >
                    {field.options.map((option) => (
                        <option key={option} value={option}>
                            {t(`enum.${option}`, { ns: 'params', defaultValue: option })}
                        </option>
                    ))}
                </select>
            );
        }

        if (field?.kind === 'number') {
            return (
                <input
                    type="number"
                    className="ins-input"
                    value={Number(value)}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 'any'}
                    onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value);
                        if (Number.isFinite(parsed)) updateNodeParam(node.id, key, parsed);
                    }}
                />
            );
        }

        return (
            <input
                type="text"
                className="ins-input"
                value={String(value)}
                onChange={(event) => updateNodeParam(node.id, key, event.target.value)}
            />
        );
    };

    return (
        <aside className="ins">
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
                        </div>

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

                        {sections.map(({ section, entries }) => (
                            <section key={section} className="ins-section">
                                <h3 className="ins-section-title">{t(`section.${section}`)}</h3>
                                {entries.map(([key, value]) => {
                                    const label = t(key, { ns: 'params', defaultValue: key });
                                    return (
                                        <div key={key} className="ins-row">
                                            <label className="ins-label" title={`${label} · ${key}`}>
                                                {label}
                                            </label>
                                            {renderField(key, value)}
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

                        <p className="ins-note">{t('inspector.modelPending')}</p>
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

                        <div className="ins-row">
                            <label className="ins-label">{t('inspector.edgeKind')}</label>
                            <select
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

                        <section className="ins-section">
                            <h3 className="ins-section-title">{t('inspector.calls')}</h3>
                            {(edge.data?.calls ?? []).map((call) => (
                                <div key={call.id} className="ins-call">
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
                        </section>

                        <section className="ins-section">
                            <h3 className="ins-section-title">{t('inspector.policy')}</h3>
                            <div className="ins-row">
                                <span className="ins-label">{t('policy.timeoutMs')}</span>
                                <span className="ins-static">{edge.data?.policy.timeoutMs}</span>
                            </div>
                            <div className="ins-row">
                                <span className="ins-label">{t('policy.retries')}</span>
                                <span className="ins-static">{edge.data?.policy.retries}</span>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </aside>
    );
}
