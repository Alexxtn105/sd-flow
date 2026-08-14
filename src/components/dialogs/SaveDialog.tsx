import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '../common/Dialog/Dialog';

interface SaveDialogProps {
    initialName: string;
    onClose: () => void;
    onSave: (name: string) => boolean;
}

export default function SaveDialog({ initialName, onClose, onSave }: SaveDialogProps) {
    const { t } = useTranslation();
    const [name, setName] = useState(initialName);
    const [error, setError] = useState('');

    const submit = () => {
        const trimmed = name.trim();
        if (!trimmed) {
            setError(t('dialog.save.nameRequired'));
            return;
        }
        if (!onSave(trimmed)) {
            setError(t('dialog.save.failed'));
            return;
        }
        onClose();
    };

    return (
        <Dialog
            title={t('dialog.save.title')}
            onClose={onClose}
            footer={
                <>
                    <button className="dlg-btn" onClick={onClose}>
                        {t('dialog.cancel')}
                    </button>
                    <button className="dlg-btn dlg-btn-primary" onClick={submit}>
                        {t('dialog.save.action')}
                    </button>
                </>
            }
        >
            <label className="dlg-field-label" htmlFor="save-scheme-name">
                {t('dialog.save.name')}
            </label>
            <input
                id="save-scheme-name"
                autoFocus
                className="dlg-input"
                value={name}
                placeholder={t('dialog.save.placeholder')}
                onChange={(event) => {
                    setName(event.target.value);
                    setError('');
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') submit();
                }}
            />
            {error && <div className="dlg-error">{error}</div>}
        </Dialog>
    );
}
