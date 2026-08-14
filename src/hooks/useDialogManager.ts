import { useCallback, useState } from 'react';

export type DialogName = 'save' | 'saveAs' | 'load' | 'settings' | 'help';

export interface ConfirmRequest {
    messageKey: string;
    titleKey: string;
    onConfirm: () => void;
}

export interface DialogManager {
    openDialog: DialogName | null;
    confirmRequest: ConfirmRequest | null;
    open: (name: DialogName) => void;
    close: () => void;
    requestConfirm: (request: ConfirmRequest) => void;
    resolveConfirm: () => void;
    dismissConfirm: () => void;
}

export function useDialogManager(): DialogManager {
    const [openDialog, setOpenDialog] = useState<DialogName | null>(null);
    const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

    const open = useCallback((name: DialogName) => setOpenDialog(name), []);
    const close = useCallback(() => setOpenDialog(null), []);
    const requestConfirm = useCallback((request: ConfirmRequest) => setConfirmRequest(request), []);
    const dismissConfirm = useCallback(() => setConfirmRequest(null), []);

    const resolveConfirm = useCallback(() => {
        setConfirmRequest((request) => {
            request?.onConfirm();
            return null;
        });
    }, []);

    return { openDialog, confirmRequest, open, close, requestConfirm, resolveConfirm, dismissConfirm };
}
