import { describe, expect, it } from 'vitest';
import swSource from '../../public/sw.js?raw';

const ORIGIN = 'https://alexxtn105.github.io';
const SHELL = `${ORIGIN}/sd-flow/`;
const BUILD_MARK = `${ORIGIN}/sd-flow/build-mark`;
const BUNDLE = `${ORIGIN}/sd-flow/assets/index-new.js`;
const CACHE_NAME = 'sd-flow-cache-v1';

class TestResponse {
    ok = true;
    type = 'basic';

    constructor(readonly body: string) {}

    clone(): TestResponse {
        return new TestResponse(this.body);
    }

    text(): Promise<string> {
        return Promise.resolve(this.body);
    }
}

interface TestRequest {
    url: string;
    method: string;
    mode: string;
}

function request(url: string, mode = 'no-cors'): TestRequest {
    return { url, method: 'GET', mode };
}

function keyOf(target: TestRequest | string): string {
    return typeof target === 'string' ? target : target.url;
}

class TestCache {
    readonly entries = new Map<string, TestResponse>();

    constructor(private readonly load: (url: string) => Promise<TestResponse>) {}

    async match(target: TestRequest | string): Promise<TestResponse | undefined> {
        return this.entries.get(keyOf(target));
    }

    async put(target: TestRequest | string, response: TestResponse): Promise<void> {
        this.entries.set(keyOf(target), response);
    }

    async add(url: string): Promise<void> {
        this.entries.set(url, await this.load(url));
    }
}

interface Worker {
    listeners: Map<string, (event: unknown) => void>;
    open: () => Promise<TestCache>;
    cache: () => TestCache;
    fetched: string[];
    navigate: (url: string) => Promise<TestResponse>;
    load: (url: string) => Promise<TestResponse>;
    announce: (version: string, urls: string[]) => Promise<void>;
}

function createWorker(options: { network?: (url: string) => TestResponse | null } = {}): Worker {
    const listeners = new Map<string, (event: unknown) => void>();
    const caches = new Map<string, TestCache>();
    const fetched: string[] = [];

    const network = options.network ?? ((url: string) => new TestResponse(`network:${url}`));
    const fetchMock = async (target: TestRequest | string): Promise<TestResponse> => {
        const url = keyOf(target);
        fetched.push(url);
        const response = network(url);
        if (!response) throw new Error('offline');
        return response;
    };

    const cacheStorage = {
        open: async (name: string): Promise<TestCache> => {
            if (!caches.has(name)) caches.set(name, new TestCache((url) => fetchMock(url)));
            return caches.get(name) as TestCache;
        },
        keys: async (): Promise<string[]> => [...caches.keys()],
        delete: async (name: string): Promise<boolean> => caches.delete(name),
    };

    const href = `${ORIGIN}/sd-flow/sw.js`;
    const scope = {
        location: { href, origin: ORIGIN, toString: () => href },
        addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
        skipWaiting: async () => undefined,
        clients: { claim: async () => undefined },
    };

    new Function('self', 'caches', 'fetch', 'Response', swSource)(scope, cacheStorage, fetchMock, TestResponse);

    const respond = async (url: string, mode: string): Promise<TestResponse> => {
        let responded: Promise<TestResponse> | null = null;
        listeners.get('fetch')?.({
            request: request(url, mode),
            respondWith: (result: Promise<TestResponse>) => {
                responded = result;
            },
            waitUntil: () => undefined,
        });
        if (!responded) throw new Error('обработчик fetch не ответил');
        return responded;
    };

    return {
        listeners,
        open: () => cacheStorage.open(CACHE_NAME),
        cache: () => caches.get(CACHE_NAME) as TestCache,
        fetched,
        navigate: (url) => respond(url, 'navigate'),
        load: (url) => respond(url, 'no-cors'),
        announce: async (version, urls) => {
            const waits: Promise<unknown>[] = [];
            listeners.get('message')?.({
                data: { type: 'warm-cache', version, urls },
                waitUntil: (result: Promise<unknown>) => waits.push(result),
            });
            await Promise.all(waits);
        },
    };
}

async function seed(worker: Worker, entries: Record<string, string>): Promise<void> {
    const cache = await worker.open();
    for (const [url, body] of Object.entries(entries)) await cache.put(url, new TestResponse(body));
}

describe('офлайн-кеш приложения', () => {
    it('навигация берёт свежий документ, а не сохранённый прошлым релизом', async () => {
        const worker = createWorker({ network: () => new TestResponse('новая сборка') });
        await seed(worker, { [SHELL]: 'прошлый релиз' });

        const response = await worker.navigate(SHELL);

        expect(await response.text()).toBe('новая сборка');
        expect(await (await worker.cache().match(SHELL))?.text()).toBe('новая сборка');
    });

    it('без сети навигация отдаёт сохранённый документ', async () => {
        const worker = createWorker({ network: () => null });
        await seed(worker, { [SHELL]: 'сохранённая оболочка' });

        const response = await worker.navigate(SHELL);

        expect(await response.text()).toBe('сохранённая оболочка');
    });

    it('файл с хэшем в имени отдаётся из кеша без сети', async () => {
        const worker = createWorker();
        await seed(worker, { [BUNDLE]: 'бандл из кеша' });

        const response = await worker.load(BUNDLE);

        expect(await response.text()).toBe('бандл из кеша');
        expect(worker.fetched).toEqual([]);
    });

    it('новая версия приложения чистит кеш и греет его заново', async () => {
        const worker = createWorker();
        await seed(worker, {
            [BUILD_MARK]: '1.4.1',
            [`${ORIGIN}/sd-flow/assets/index-old.js`]: 'бандл прошлого релиза',
        });

        await worker.announce('1.4.2', [SHELL, BUNDLE]);
        const cache = worker.cache();

        expect(await cache.match(`${ORIGIN}/sd-flow/assets/index-old.js`)).toBeUndefined();
        expect(await (await cache.match(BUILD_MARK))?.text()).toBe('1.4.2');
        expect(await (await cache.match(BUNDLE))?.text()).toBe(`network:${BUNDLE}`);
    });

    it('та же версия кеш не сбрасывает', async () => {
        const worker = createWorker();
        await seed(worker, { [BUILD_MARK]: '1.4.2', [BUNDLE]: 'бандл из кеша' });

        await worker.announce('1.4.2', [SHELL]);

        expect(await (await worker.cache().match(BUNDLE))?.text()).toBe('бандл из кеша');
    });
});
