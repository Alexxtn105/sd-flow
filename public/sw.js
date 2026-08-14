const CACHE_VERSION = 'sd-flow-cache-v1';
const APP_SHELL_URL = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(dropStaleCaches().then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'warm-cache' || !Array.isArray(message.urls)) return;

    event.waitUntil(warmCache(message.urls));
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(respondFromCacheFirst(event));
});

async function warmCache(urls) {
    const cache = await caches.open(CACHE_VERSION);
    const sameOrigin = urls.filter((url) => new URL(url).origin === self.location.origin);
    const missing = await Promise.all(sameOrigin.map(async (url) => ((await cache.match(url)) ? null : url)));

    await Promise.all(missing.filter(Boolean).map((url) => cache.add(url).catch(() => undefined)));
}

async function dropStaleCaches() {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
}

async function respondFromCacheFirst(event) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(event.request);

    if (cached) {
        if (event.request.mode === 'navigate') {
            event.waitUntil(revalidate(cache, event.request));
        }
        return cached;
    }

    return fetchAndStore(cache, event.request);
}

async function fetchAndStore(cache, request) {
    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
            await cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const shell = await cache.match(APP_SHELL_URL);
        if (request.mode === 'navigate' && shell) return shell;
        throw error;
    }
}

async function revalidate(cache, request) {
    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
            await cache.put(request, response.clone());
        }
    } catch {
        await Promise.resolve();
    }
}
