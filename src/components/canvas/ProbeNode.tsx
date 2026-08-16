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
import { nodeName } from '../../utils/nodeName';
import { useHandleCompatibility } from './useHandleCompatibility';
import './ProbeNode.css';

function ProbeNodeView({ id, data, selected }: NodeProps<SdNode>) {
    const { t } = useTranslation(['blocks', 'nodes', 'common']);
    const definition = registry.get(data.componentType);
    const reading = useProbeReading(id);
    const opened = useUiStore((state) => state.probeWindowIds.includes(id));
    const toggleProbeWindow = useUiStore((state) => state.toggleProbeWindow);
    const compatibility = useHandleCompatibility(id, data.componentType);

    if (!definition) return null;

    const name = nodeName({ id, componentType: data.componentType, label: data.label }, t);
    const status = reading?.status ?? 'no-data';
    const unit = reading ? t(`probe.unit.${reading.unit}`, { ns: 'common', defaultValue: '' }) : '';

    const value =
        reading && reading.status !== 'no-data'
            ? `${formatNumber(reading.value)} ${unit}`.trim()
            : t('probe.noData', { ns: 'common' });

    const hint =
        reading?.reason === 'unattached'
            ? t('probe.attachHint', { ns: 'common' })
            : t('probe.openWindow', { ns: 'common' });

    return (
        <div
            className={`sd-probe nopan sd-probe-${status} ${selected ? 'selected' : ''} ${opened ? 'opened' : ''}`}
            onDoubleClick={() => toggleProbeWindow(id)}
            title={hint}
        >
            <Handle
                id="attach"
                type="target"
                position={Position.Left}
                className={`sd-handle sd-handle-attach ${compatibility('attach', 'in')}`}
            />
            <span className="sd-probe-icon">
                <Icon name={definition.icon} size="medium" />
            </span>
            <span className="sd-probe-body">
                <span className="sd-probe-name">{name}</span>
                <span className="sd-probe-reading">{value}</span>
            </span>
        </div>
    );
}

export default memo(ProbeNodeView);
