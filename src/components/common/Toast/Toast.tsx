import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icons/Icon';
import './Toast.css';

export type ToastTone = 'info' | 'warn' | 'error';

export interface ToastProps {
    text: string;
    tone?: ToastTone;
    durationMs?: number;
    onDismiss: () => void;
}

const DEFAULT_DURATION_MS = 4500;

export default function Toast({ text, tone = 'info', durationMs = DEFAULT_DURATION_MS, onDismiss }: ToastProps) {
    const { t } = useTranslation();

    useEffect(() => {
        const timer = window.setTimeout(onDismiss, durationMs);
        return () => window.clearTimeout(timer);
    }, [durationMs, onDismiss]);

    return (
        <div className={`toast toast-${tone}`} role="status" aria-live="polite">
            <span className="toast-text">{text}</span>
            <button className="toast-close" onClick={onDismiss} title={t('dialog.close')} aria-label={t('dialog.close')}>
                <Icon name="close" size="small" />
            </button>
        </div>
    );
}
