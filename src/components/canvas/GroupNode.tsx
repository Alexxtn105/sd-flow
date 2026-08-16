import { memo } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import registry from '../../engine/ComponentRegistry';
import { useGraphStore } from '../../store/graphStore';
import type { SdNode } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { COLLAPSED_HANDLES } from '../../utils/canvasView';
import { blockName, roleName } from '../../utils/nodeName';
import './GroupNode.css';

const MIN_SIZE: Record<string, { width: number; height: number }> = {
    region: { width: 320, height: 220 },
    az: { width: 200, height: 180 },
};

function GroupNodeView({ id, data, selected }: NodeProps<SdNode>) {
    const { t } = useTranslation(['blocks', 'nodes', 'params', 'common']);
    const beginTransaction = useGraphStore((state) => state.beginTransaction);
    const commitTransaction = useGraphStore((state) => state.commitTransaction);
    const toggleGroupCollapsed = useUiStore((state) => state.toggleGroupCollapsed);
    const definition = registry.get(data.componentType);
    if (!definition) return null;

    const kindName = blockName(data.componentType, t);
    const code = typeof data.params.code === 'string' ? data.params.code : '';
    const title = data.label || code || roleName(id, t) || kindName;
    const minSize = MIN_SIZE[data.componentType] ?? { width: 200, height: 160 };
    const collapsed = data.collapsed === true;
    const hiddenCount = typeof data.collapsedCount === 'number' ? data.collapsedCount : 0;
    const mirrorOf = typeof data.params.mirrorOf === 'string' ? data.params.mirrorOf : '';

    return (
        <div
            className={`sd-group sd-group-${data.componentType} ${selected ? 'selected' : ''} ${
                collapsed ? 'sd-group-collapsed' : ''
            }`}
        >
            {collapsed && (
                <>
                    <Handle
                        type="target"
                        id={COLLAPSED_HANDLES.in}
                        position={Position.Left}
                        className="sd-group-handle"
                    />
                    <Handle
                        type="source"
                        id={COLLAPSED_HANDLES.out}
                        position={Position.Right}
                        className="sd-group-handle"
                    />
                </>
            )}

            {!collapsed && (
                <NodeResizer
                    isVisible={selected}
                    minWidth={minSize.width}
                    minHeight={minSize.height}
                    onResizeStart={beginTransaction}
                    onResizeEnd={commitTransaction}
                    lineClassName="sd-group-resize-line"
                    handleClassName="sd-group-resize-handle"
                />
            )}
            <div className="sd-group-label">
                <Icon name={definition.icon} size="small" />
                <span className="sd-group-title">{title}</span>
                <span className="sd-group-kind">{kindName}</span>
                {mirrorOf.length > 0 && (
                    <span className="sd-group-mirror" title={t('canvas.mirrorOf', { ns: 'common', source: mirrorOf })}>
                        <Icon name="content_copy" size="small" />
                    </span>
                )}
                {collapsed && <span className="sd-group-count">{hiddenCount}</span>}
                <button
                    type="button"
                    className="sd-group-collapse nodrag nopan"
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleGroupCollapsed(id);
                    }}
                    title={t(collapsed ? 'canvas.expandGroup' : 'canvas.collapseGroup', { ns: 'common' })}
                    aria-label={t(collapsed ? 'canvas.expandGroup' : 'canvas.collapseGroup', { ns: 'common' })}
                    aria-pressed={collapsed}
                >
                    <Icon name={collapsed ? 'unfold_more' : 'unfold_less'} size="small" />
                </button>
            </div>
        </div>
    );
}

export default memo(GroupNodeView);
