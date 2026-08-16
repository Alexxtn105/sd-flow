const CACHE_VERSION = 'sd-flow-cache-v1';
const APP_SHELL_URL = new URL('./', self.location).href;
const BUILD_MARK_URL = new URL('./build-mark', self.location).href;

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(dropStaleCaches().then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'warm-cache' || !Array.isArray(message.urls)) return;

    event.waitUntil(dropOutdatedBuild(message.version).then(() => warmCache(message.urls)));
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        event.request.mode === 'navigate'
            ? respondNetworkFirst(event.request)
            : respondCacheFirst(event.request),
    );
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

async function dropOutdatedBuild(version) {
    if (typeof version !== 'string' || version.length === 0) return;

    const cache = await caches.open(CACHE_VERSION);
    const mark = await cache.match(BUILD_MARK_URL);
    if (mark && (await mark.text()) === version) return;

    await caches.delete(CACHE_VERSION);
    const fresh = await caches.open(CACHE_VERSION);
    await fresh.put(BUILD_MARK_URL, new Response(version));
}

async function respondNetworkFirst(request) {
    const cache = await caches.open(CACHE_VERSION);

    try {
        const response = await fetch(request);
        if (isStorable(response)) await cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = (await cache.match(request)) ?? (await cache.match(APP_SHELL_URL));
        if (cached) return cached;
        throw error;
    }
}

async function respondCacheFirst(request) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (isStorable(response)) await cache.put(request, response.clone());
    return response;
}

function isStorable(response) {
    return response.ok && response.type === 'basic';
}
