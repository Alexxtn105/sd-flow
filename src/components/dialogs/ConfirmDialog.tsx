import { useTranslation } from 'react-i18next';
import Dialog from '../common/Dialog/Dialog';

interface ConfirmDialogProps {
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog
            title={title}
            onClose={onCancel}
            footer={
                <>
                    <button className="dlg-btn" onClick={onCancel}>
                        {t('dialog.cancel')}
                    </button>
                    <button className="dlg-btn dlg-btn-danger" onClick={onConfirm}>
                        {t('dialog.confirm')}
                    </button>
                </>
            }
        >
            {message}
        </Dialog>
    );
}
