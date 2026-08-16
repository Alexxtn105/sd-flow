import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import './CanvasContextMenu.css';

export interface NodeMenuTarget {
    kind: 'node';
    nodeId: string;
    x: number;
    y: number;
    hasParent: boolean;
    isProbe: boolean;
}

export interface EdgeMenuTarget {
    kind: 'edge';
    edgeId: string;
    x: number;
    y: number;
}

export interface PaneMenuTarget {
    kind: 'pane';
    x: number;
    y: number;
}

export type ContextMenuTarget = NodeMenuTarget | EdgeMenuTarget | PaneMenuTarget;

interface CanvasContextMenuProps {
    target: ContextMenuTarget;
    canPaste: boolean;
    onClose: () => void;
    onDuplicate: (nodeId: string) => void;
    onDelete: (nodeId: string) => void;
    onDetach: (nodeId: string) => void;
    onOpenProbeWindow: (nodeId: string) => void;
    onOpenHelp: (nodeId: string) => void;
    onDeleteEdge: (edgeId: string) => void;
    onPaste: () => void;
    onFitView: () => void;
}

export default function CanvasContextMenu({
    target,
    canPaste,
    onClose,
    onDuplicate,
    onDelete,
    onDetach,
    onOpenProbeWindow,
    onOpenHelp,
    onDeleteEdge,
    onPaste,
    onFitView,
}: CanvasContextMenuProps) {
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
        if (target.kind !== 'node') return;
        action(target.nodeId);
        onClose();
    };

    const call = (action: () => void) => {
        action();
        onClose();
    };

    if (target.kind === 'pane') {
        return (
            <div className="ctx-menu" ref={ref} style={{ left: target.x, top: target.y }}>
                <button className="ctx-item" onClick={() => call(onPaste)} disabled={!canPaste}>
                    <Icon name="content_paste" size="small" />
                    <span>{t('canvas.paste')}</span>
                </button>
                <button className="ctx-item" onClick={() => call(onFitView)}>
                    <Icon name="fit_screen" size="small" />
                    <span>{t('canvas.fitView')}</span>
                </button>
            </div>
        );
    }

    if (target.kind === 'edge') {
        return (
            <div className="ctx-menu" ref={ref} style={{ left: target.x, top: target.y }}>
                <button
                    className="ctx-item ctx-item-danger"
                    onClick={() => call(() => onDeleteEdge(target.edgeId))}
                >
                    <Icon name="delete_outline" size="small" />
                    <span>{t('canvas.deleteEdge')}</span>
                </button>
            </div>
        );
    }

    return (
        <div className="ctx-menu" ref={ref} style={{ left: target.x, top: target.y }}>
            {target.isProbe && (
                <button className="ctx-item" onClick={() => run(onOpenProbeWindow)}>
                    <Icon name="open_in_new" size="small" />
                    <span>{t('canvas.openProbeWindow')}</span>
                </button>
            )}
            <button className="ctx-item" onClick={() => run(onOpenHelp)}>
                <Icon name="help_outline" size="small" />
                <span>{t('canvas.blockHelp')}</span>
            </button>
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
