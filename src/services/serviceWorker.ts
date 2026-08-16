const SERVICE_WORKER_URL = `${import.meta.env.BASE_URL}sw.js`;

function loadedUrls(): string[] {
    const document = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);

    return [document, ...resources].filter((url) => url.startsWith(window.location.origin));
}

async function warmOfflineCache(): Promise<void> {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'warm-cache', version: __APP_VERSION__, urls: loadedUrls() });
}

export function registerServiceWorker(): void {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(SERVICE_WORKER_URL, { scope: import.meta.env.BASE_URL })
            .then(() => warmOfflineCache())
            .catch(() => undefined);
    });
}
