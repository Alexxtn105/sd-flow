import { useEffect } from 'react';
import type { ReactNode } from 'react';
import Icon from '../Icons/Icon';
import './Dialog.css';

export interface DialogProps {
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    width?: number;
}

export default function Dialog({ title, onClose, children, footer, width = 420 }: DialogProps) {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        document.body.classList.add('dialog-open');
        return () => {
            document.removeEventListener('keydown', handler);
            document.body.classList.remove('dialog-open');
        };
    }, [onClose]);

    return (
        <div className="dlg-overlay" onMouseDown={onClose}>
            <div
                className="dlg"
                style={{ width }}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="dlg-header">
                    <span className="dlg-title">{title}</span>
                    <button className="dlg-close" onClick={onClose} aria-label={title}>
                        <Icon name="close" size="small" />
                    </button>
                </div>
                <div className="dlg-body">{children}</div>
                {footer ? <div className="dlg-footer">{footer}</div> : null}
            </div>
        </div>
    );
}
