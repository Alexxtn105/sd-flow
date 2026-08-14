import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import './NodeContextMenu.css';

export interface ContextMenuTarget {
    nodeId: string;
    x: number;
    y: number;
    hasParent: boolean;
}

interface NodeContextMenuProps {
    target: ContextMenuTarget;
    onClose: () => void;
    onDuplicate: (nodeId: string) => void;
    onDelete: (nodeId: string) => void;
    onDetach: (nodeId: string) => void;
}

export default function NodeContextMenu({ target, onClose, onDuplicate, onDelete, onDetach }: NodeContextMenuProps) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as HTMLElement)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    const run = (action: (nodeId: string) => void) => {
        action(target.nodeId);
        onClose();
    };

    return (
        <div className="ctx-menu" ref={ref} style={{ left: target.x, top: target.y }}>
            <button className="ctx-item" onClick={() => run(onDuplicate)}>
                <Icon name="content_copy" size="small" />
                <span>{t('canvas.duplicate')}</span>
            </button>
            {target.hasParent && (
                <button className="ctx-item" onClick={() => run(onDetach)}>
                    <Icon name="logout" size="small" />
                    <span>{t('canvas.detachFromGroup')}</span>
                </button>
            )}
            <button className="ctx-item ctx-item-danger" onClick={() => run(onDelete)}>
                <Icon name="delete_outline" size="small" />
                <span>{t('canvas.delete')}</span>
            </button>
        </div>
    );
}
