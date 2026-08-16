import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isReferenceReady, loadReference } from '../services/referenceBundle';
import type { ReferenceNamespace } from '../services/referenceBundle';

export default function useReference(namespaces: ReferenceNamespace[], enabled = true): boolean {
    const { i18n } = useTranslation();
    const key = namespaces.join(',');
    const [ready, setReady] = useState(() => isReferenceReady(i18n.language, namespaces));

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        const wanted = key.split(',') as ReferenceNamespace[];
        setReady(isReferenceReady(i18n.language, wanted));

        void loadReference(i18n.language, wanted).then(() => {
            if (!cancelled) setReady(true);
        });

        return () => {
            cancelled = true;
        };
    }, [enabled, i18n.language, key]);

    return ready;
}
