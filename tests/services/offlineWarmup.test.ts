import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../src/locales/i18n';
import { isReferenceReady } from '../../src/services/referenceBundle';
import { warmOfflineCache } from '../../src/services/serviceWorker';

interface WarmMessage {
    type: string;
    version: string;
    urls: string[];
}

function stubWorker(): WarmMessage[] {
    const posted: WarmMessage[] = [];

    vi.stubGlobal('navigator', {
        serviceWorker: {
            ready: Promise.resolve({
                active: { postMessage: (message: WarmMessage) => posted.push(message) },
            }),
        },
    });

    return posted;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('прогрев офлайн-кеша', () => {
    it('догружает ленивые словари справки, чтобы они попали в кеш до потери сети', async () => {
        const language = i18n.resolvedLanguage ?? 'en';

        expect(isReferenceReady(language, ['help', 'hints'])).toBe(false);

        stubWorker();
        await warmOfflineCache();

        expect(isReferenceReady(language, ['help', 'hints'])).toBe(true);
        expect(i18n.getResource(language, 'help', 'postgres.summary')).toBeTruthy();
    });

    it('сообщает воркеру версию сборки и список загруженного', async () => {
        const posted = stubWorker();

        await warmOfflineCache();

        expect(posted).toHaveLength(1);
        expect(posted[0].type).toBe('warm-cache');
        expect(posted[0].version).toBe(__APP_VERSION__);
        expect(posted[0].urls[0]).toContain(window.location.origin);
    });
});
