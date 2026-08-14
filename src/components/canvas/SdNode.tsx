import { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import registry from '../../engine/ComponentRegistry';
import type { ParamField, ParamValue, PortDefinition } from '../../engine/types/component';
import { useGraphStore } from '../../store/graphStore';
import type { SdNode as SdNodeType } from '../../store/graphStore';
import { useNodeResult, useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { formatParamValue, formatPercent, formatRps, utilizationLevel } from '../../utils/format';
import { heatLevel, heatValueOf } from '../../utils/heatmap';
import { useHandleCompatibility } from './useHandleCompatibility';
import type { HandleCompatibility, HandleDirection } from './useHandleCompatibility';
import './SdNode.css';

const MAX_VISIBLE_PARAMS = 3;

function handleOffset(index: number, total: number): string {
    return `${((index + 1) * 100) / (total + 1)}%`;
}

function renderHandles(
    ports: PortDefinition[],
    position: Position,
    type: 'target' | 'source',
    compatibility: HandleCompatibility,
) {
    const direction: HandleDirection = type === 'target' ? 'in' : 'out';

    return ports.map((port, index) => (
        <Handle
            key={port.id}
            id={port.id}
            type={type}
            position={position}
            className={`sd-handle sd-handle-${port.role} ${compatibility(port.id, direction)}`}
            style={ports.length > 1 ? { top: handleOffset(index, ports.length) } : undefined}
        />
    ));
}

function SdNodeView({ id, data, selected }: NodeProps<SdNodeType>) {
    const { t } = useTranslation(['params', 'blocks', 'groups', 'common']);
    const updateNodeParam = useGraphStore((state) => state.updateNodeParam);
    const metrics = useNodeResult(id);
    const heatmapProbeId = useUiStore((state) => state.heatmapProbeId);
    const heatmap = useSimStore((state) =>
        heatmapProbeId ? (state.result?.probes[heatmapProbeId]?.heatmap ?? null) : null,
    );
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const compatibility = useHandleCompatibility(id, data.componentType);

    const definition = registry.get(data.componentType);
    if (!definition) return null;

    const displayName = data.label || t(data.componentType, { ns: 'blocks', defaultValue: data.componentType });
    const groupName = t(definition.group, { ns: 'groups', defaultValue: definition.group });
    const entries = Object.entries(data.params).slice(0, MAX_VISIBLE_PARAMS);
    const hiddenCount = Object.keys(data.params).length - entries.length;

    const commit = (key: string, raw: string) => {
        const field: ParamField | undefined = definition.paramSchema[key];
        const current = data.params[key];
        let next: ParamValue = raw;

        if (field?.kind === 'number') {
            const parsed = Number.parseFloat(raw);
            next = Number.isFinite(parsed) ? parsed : current;
        } else if (field?.kind === 'boolean') {
            next = raw === 'true';
        }

        updateNodeParam(id, key, next);
        setEditing(null);
    };

    const renderValue = (key: string, value: ParamValue) => {
        const field: ParamField | undefined = definition.paramSchema[key];

        if (editing === key) {
            if (field?.kind === 'enum' || field?.kind === 'boolean') {
                const options = field.kind === 'enum' ? field.options : ['true', 'false'];
                return (
                    <select
                        autoFocus
                        className="sd-param-edit nodrag nopan"
                        value={draft}
                        onChange={(event) => commit(key, event.target.value)}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        {options.map((option) => (
                            <option key={option} value={option}>
                                {t(`enum.${option}`, { ns: 'params', defaultValue: option })}
                            </option>
                        ))}
                    </select>
                );
            }

            return (
                <input
                    autoFocus
                    type={field?.kind === 'number' ? 'number' : 'text'}
                    step="any"
                    className="sd-param-edit nodrag nopan"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commit(key, draft)}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') commit(key, draft);
                        if (event.key === 'Escape') setEditing(null);
                    }}
                />
            );
        }

        return (
            <span
                className="sd-param-value"
                onDoubleClick={(event) => {
                    event.stopPropagation();
                    setEditing(key);
                    setDraft(String(value));
                }}
            >
                {formatParamValue(value, field, (unitKey) => t(`units.${unitKey}`, { ns: 'params', defaultValue: '' }))}
            </span>
        );
    };

    const showMetrics = metrics !== null && metrics.lambdaOffered > 0;
    const bounded = showMetrics && Number.isFinite(metrics.capacity);
    const loadLevel = bounded ? utilizationLevel(metrics.utilization) : 'idle';
    const projected = heatmap ? heatValueOf(heatmap, id) : null;
    const level = heatmap && projected !== null ? heatLevel(projected, heatmap) : loadLevel;
    const tinted = projected !== null || showMetrics;

    return (
        <div
            className={`sd-node sd-node-${definition.group} ${selected ? 'selected' : ''} ${tinted ? `sd-node-load-${level}` : ''} ${projected !== null ? 'sd-node-heat' : ''}`}
        >
            {renderHandles(definition.ports.in, Position.Left, 'target', compatibility)}

            <div className="sd-node-header">
                <span className="sd-node-icon">
                    <Icon name={definition.icon} size="medium" />
                </span>
                <span className="sd-node-title">
                    <span className="sd-node-name">{displayName}</span>
                    <span className="sd-node-group">{groupName}</span>
                </span>
            </div>

            {entries.length > 0 && (
                <div className="sd-node-params">
                    {entries.map(([key, value]) => (
                        <div key={key} className="sd-node-param">
                            <span className="sd-param-label">
                                {t(key, { ns: 'params', defaultValue: key })}
                            </span>
                            {renderValue(key, value)}
                        </div>
                    ))}
                    {hiddenCount > 0 && <div className="sd-node-more">+{hiddenCount}</div>}
                </div>
            )}

            {showMetrics && (
                <div className={`sd-node-metrics sd-metrics-${loadLevel}`}>
                    {bounded && (
                        <div className="sd-util-track">
                            <div
                                className="sd-util-fill"
                                style={{ width: `${Math.min(metrics.utilization, 1) * 100}%` }}
                            />
                        </div>
                    )}
                    <div className="sd-metric-row">
                        <span className="sd-metric-rps" title={t('metric.throughput', { ns: 'common' })}>
                            {formatRps(metrics.throughput)}
                        </span>
                        <span className="sd-metric-bound" title={t('metric.boundBy', { ns: 'common' })}>
                            {t(`bound.${metrics.boundBy}`, { ns: 'common', defaultValue: metrics.boundBy })}
                        </span>
                        {bounded && (
                            <span className="sd-metric-util" title={t('metric.utilization', { ns: 'common' })}>
                                {formatPercent(metrics.utilization)}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {renderHandles(definition.ports.out, Position.Right, 'source', compatibility)}
        </div>
    );
}

export default memo(SdNodeView);
