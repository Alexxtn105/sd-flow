import { useTranslation } from 'react-i18next';
import Dialog from '../common/Dialog/Dialog';
import Icon from '../common/Icons/Icon';
import { formatDateTime } from '../../utils/format';
import type { StoredSchemeInfo } from '../../store/schemeStore';

interface LoadDialogProps {
    items: StoredSchemeInfo[];
    onClose: () => void;
    onPick: (id: string) => void;
    onRemove: (item: StoredSchemeInfo) => void;
}

export default function LoadDialog({ items, onClose, onPick, onRemove }: LoadDialogProps) {
    const { t, i18n } = useTranslation();

    return (
        <Dialog title={t('dialog.load.title')} onClose={onClose} width={460}>
            {items.length === 0 ? (
                <div className="dlg-empty">{t('dialog.load.empty')}</div>
            ) : (
                <div className="dlg-list">
                    {items.map((item) => (
                        <div key={item.id} className="dlg-list-item" onClick={() => onPick(item.id)}>
                            <div className="dlg-list-main">
                                <div className="dlg-list-name">{item.name}</div>
                                <div className="dlg-list-meta">
                                    {formatDateTime(item.updatedAt, i18n.language)} ·{' '}
                                    {t('dialog.load.nodes', { count: item.nodeCount })}
                                </div>
                            </div>
                            <button
                                className="dlg-list-remove"
                                title={t('dialog.load.remove')}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRemove(item);
                                }}
                            >
                                <Icon name="delete_outline" size="small" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </Dialog>
    );
}
