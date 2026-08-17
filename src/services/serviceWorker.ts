import i18n, { DEFAULT_LANGUAGE } from '../locales/i18n';
import { loadReference } from './referenceBundle';

const SERVICE_WORKER_URL = `${import.meta.env.BASE_URL}sw.js`;

function loadedUrls(): string[] {
    const document = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);

    return [document, ...resources].filter((url) => url.startsWith(window.location.origin));
}

export async function warmOfflineCache(): Promise<void> {
    await loadReference(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE, ['help', 'hints']).catch(() => undefined);

    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'warm-cache', version: __APP_VERSION__, urls: loadedUrls() });
}

function whenIdle(task: () => void): void {
    const idle = (window as unknown as { requestIdleCallback?: (callback: () => void) => number })
        .requestIdleCallback;

    if (idle) idle(task);
    else window.setTimeout(task, 1500);
}

export function registerServiceWorker(): void {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(SERVICE_WORKER_URL, { scope: import.meta.env.BASE_URL })
            .then(() => whenIdle(() => void warmOfflineCache()))
            .catch(() => undefined);
    });
}
