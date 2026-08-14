import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import registry from '../../engine/ComponentRegistry';
import type { SdNode } from '../../store/graphStore';
import './ProbeNode.css';

function ProbeNodeView({ data, selected }: NodeProps<SdNode>) {
    const { t } = useTranslation(['blocks', 'common']);
    const definition = registry.get(data.componentType);
    if (!definition) return null;

    const name = data.label || t(data.componentType, { ns: 'blocks', defaultValue: data.componentType });

    return (
        <div className={`sd-probe ${selected ? 'selected' : ''}`}>
            <Handle id="attach" type="target" position={Position.Left} className="sd-handle sd-handle-attach" />
            <span className="sd-probe-icon">
                <Icon name={definition.icon} size="medium" />
            </span>
            <span className="sd-probe-body">
                <span className="sd-probe-name">{name}</span>
                <span className="sd-probe-pending">{t('inspector.modelPending', { ns: 'common' })}</span>
            </span>
        </div>
    );
}

export default memo(ProbeNodeView);
