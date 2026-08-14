import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import registry from '../../engine/ComponentRegistry';
import type { SdNode } from '../../store/graphStore';
import { useProbeReading } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { formatNumber } from '../../utils/format';
import './ProbeNode.css';

function ProbeNodeView({ id, data, selected }: NodeProps<SdNode>) {
    const { t } = useTranslation(['blocks', 'common']);
    const definition = registry.get(data.componentType);
    const reading = useProbeReading(id);
    const toggleWindow = useUiStore((state) => state.toggleProbeWindow);
    if (!definition) return null;

    const name = data.label || t(data.componentType, { ns: 'blocks', defaultValue: data.componentType });

    return (
        <div
            className={`sd-probe sd-probe-${reading?.status ?? 'no-data'} ${selected ? 'selected' : ''}`}
            onDoubleClick={() => toggleWindow(id)}
            title={t('probe.openWindow', { ns: 'common' })}
        >
            <Handle id="attach" type="target" position={Position.Left} className="sd-handle sd-handle-attach" />
            <span className="sd-probe-icon">
                <Icon name={definition.icon} size="medium" />
            </span>
            <span className="sd-probe-body">
                <span className="sd-probe-name">{name}</span>
                <span className="sd-probe-reading">
                    {reading && reading.status !== 'no-data'
                        ? `${formatNumber(reading.value)} ${t(`probe.unit.${reading.unit}`, { ns: 'common' })}`
                        : t('probe.noData', { ns: 'common' })}
                </span>
            </span>
        </div>
    );
}

export default memo(ProbeNodeView);
