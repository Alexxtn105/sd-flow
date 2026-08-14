import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import {
    buildShareUrl,
    clearShareHash,
    decodeScheme,
    encodeScheme,
    isCompressionSupported,
    isShareUrlTooLong,
    readSharePayload,
} from '../../src/services/shareLink';
import { buildScheme } from '../helpers/scheme';
import type { SchemeV1 } from '../../src/engine/types/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function sampleScheme(): SchemeV1 {
    return buildScheme({
        name: 'Схема для ссылки',
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'svc', type: 'service', params: { instances: 7 } },
            { id: 'db', type: 'postgres' },
        ],
        links: [
            { from: 'client', to: 'svc' },
            { from: 'svc', to: 'db' },
        ],
    });
}

describe('ссылка-шаринг', () => {
    it('круговой рейс возвращает исходную схему', async () => {
        const scheme = sampleScheme();
        const payload = await encodeScheme(scheme);

        expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
        await expect(decodeScheme(payload)).resolves.toEqual(scheme);
    });

    it('без CompressionStream кодирует несжатым base64url и читается обратно', async () => {
        vi.stubGlobal('CompressionStream', undefined);
        vi.stubGlobal('DecompressionStream', undefined);

        expect(isCompressionSupported()).toBe(false);

        const scheme = sampleScheme();
        const payload = await encodeScheme(scheme);

        await expect(decodeScheme(payload)).resolves.toEqual(scheme);
    });

    it('сжатая ссылка короче несжатой, когда браузер умеет deflate-raw', async () => {
        if (!isCompressionSupported()) return;

        const scheme = sampleScheme();
        const compressed = await encodeScheme(scheme);

        vi.stubGlobal('CompressionStream', undefined);
        const plain = await encodeScheme(scheme);

        expect(compressed.length).toBeLessThan(plain.length);
    });

    it('битый payload даёт null, а не исключение', async () => {
        await expect(decodeScheme('не base64!!')).resolves.toBeNull();
        await expect(decodeScheme('')).resolves.toBeNull();
        await expect(decodeScheme('AQ')).resolves.toBeNull();
        await expect(decodeScheme(btoa('{"version":1}'))).resolves.toBeNull();
    });

    it('распознаёт схему только по полному формату', async () => {
        const payload = await encodeScheme(sampleScheme());
        const damaged = `${payload.slice(0, payload.length - 6)}AAAAAA`;

        await expect(decodeScheme(damaged)).resolves.toBeNull();
    });

    it('собирает ссылку вида origin + base + #s=', async () => {
        const payload = await encodeScheme(sampleScheme());
        const url = buildShareUrl(payload);

        expect(url).toBe(`${window.location.origin}${import.meta.env.BASE_URL}#s=${payload}`);
        expect(isShareUrlTooLong(url)).toBe(false);
        expect(isShareUrlTooLong(`x${'y'.repeat(8000)}`)).toBe(true);
    });

    it('читает payload из хэша и вычищает его из адреса', () => {
        expect(readSharePayload('#s=abc')).toBe('abc');
        expect(readSharePayload('#s=')).toBeNull();
        expect(readSharePayload('#settings')).toBeNull();
        expect(readSharePayload('')).toBeNull();

        window.history.replaceState(null, '', `${window.location.pathname}#s=abc`);
        clearShareHash();

        expect(window.location.hash).toBe('');
    });
});
