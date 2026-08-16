import { memo } from 'react';
import { NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import registry from '../../engine/ComponentRegistry';
import { useGraphStore } from '../../store/graphStore';
import type { SdNode } from '../../store/graphStore';
import { blockName, roleName } from '../../utils/nodeName';
import './GroupNode.css';

const MIN_SIZE: Record<string, { width: number; height: number }> = {
    region: { width: 320, height: 220 },
    az: { width: 200, height: 180 },
};

function GroupNodeView({ id, data, selected }: NodeProps<SdNode>) {
    const { t } = useTranslation(['blocks', 'nodes', 'params']);
    const beginTransaction = useGraphStore((state) => state.beginTransaction);
    const commitTransaction = useGraphStore((state) => state.commitTransaction);
    const definition = registry.get(data.componentType);
    if (!definition) return null;

    const kindName = blockName(data.componentType, t);
    const code = typeof data.params.code === 'string' ? data.params.code : '';
    const title = data.label || code || roleName(id, t) || kindName;
    const minSize = MIN_SIZE[data.componentType] ?? { width: 200, height: 160 };

    return (
        <div className={`sd-group sd-group-${data.componentType} ${selected ? 'selected' : ''}`}>
            <NodeResizer
                isVisible={selected}
                minWidth={minSize.width}
                minHeight={minSize.height}
                onResizeStart={beginTransaction}
                onResizeEnd={commitTransaction}
                lineClassName="sd-group-resize-line"
                handleClassName="sd-group-resize-handle"
            />
            <div className="sd-group-label">
                <Icon name={definition.icon} size="small" />
                <span className="sd-group-title">{title}</span>
                <span className="sd-group-kind">{kindName}</span>
            </div>
        </div>
    );
}

export default memo(GroupNodeView);
