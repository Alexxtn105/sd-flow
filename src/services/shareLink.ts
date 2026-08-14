import { isScheme } from './schemeSerializer';
import type { SchemeV1 } from '../engine/types/scheme';

const SHARE_HASH_PREFIX = '#s=';
const COMPRESSION_FORMAT = 'deflate-raw';
const PLAIN_MARKER = 0;
const DEFLATE_MARKER = 1;
const BINARY_CHUNK_SIZE = 0x8000;

export const SHARE_LINK_SAFE_LENGTH = 8000;

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';

    for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK_SIZE) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + BINARY_CHUNK_SIZE));
    }

    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(payload: string): Uint8Array {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
    const padding = (4 - (base64.length % 4)) % 4;
    const binary = atob(base64 + '='.repeat(padding));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function withMarker(marker: number, body: Uint8Array): Uint8Array {
    const framed = new Uint8Array(body.length + 1);
    framed[0] = marker;
    framed.set(body, 1);
    return framed;
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
    }

    return joined;
}

function createCompressionStream(): GenericTransformStream | null {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        return new CompressionStream(COMPRESSION_FORMAT);
    } catch {
        return null;
    }
}

function createDecompressionStream(): GenericTransformStream | null {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
        return new DecompressionStream(COMPRESSION_FORMAT);
    } catch {
        return null;
    }
}

async function pipeThrough(stream: GenericTransformStream, bytes: Uint8Array): Promise<Uint8Array> {
    const writer = (stream.writable as WritableStream<Uint8Array>).getWriter();
    const written = writer
        .write(bytes)
        .then(() => writer.close())
        .catch(() => undefined);
    const reader = (stream.readable as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }

    await written;

    return joinChunks(chunks);
}

export function isCompressionSupported(): boolean {
    return createCompressionStream() !== null && createDecompressionStream() !== null;
}

export async function encodeScheme(scheme: SchemeV1): Promise<string> {
    const json = new TextEncoder().encode(JSON.stringify(scheme));
    const stream = createCompressionStream();

    if (!stream) return toBase64Url(withMarker(PLAIN_MARKER, json));

    try {
        return toBase64Url(withMarker(DEFLATE_MARKER, await pipeThrough(stream, json)));
    } catch {
        return toBase64Url(withMarker(PLAIN_MARKER, json));
    }
}

async function unpack(marker: number, body: Uint8Array): Promise<Uint8Array | null> {
    if (marker === PLAIN_MARKER) return body;
    if (marker !== DEFLATE_MARKER) return null;

    const stream = createDecompressionStream();
    if (!stream) return null;

    return pipeThrough(stream, body);
}

export async function decodeScheme(payload: string): Promise<SchemeV1 | null> {
    try {
        const framed = fromBase64Url(payload.trim());
        if (framed.length < 2) return null;

        const body = await unpack(framed[0], framed.subarray(1));
        if (!body) return null;

        const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
        return isScheme(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function buildShareUrl(payload: string): string {
    return `${window.location.origin}${import.meta.env.BASE_URL}${SHARE_HASH_PREFIX}${payload}`;
}

export function isShareUrlTooLong(url: string): boolean {
    return url.length > SHARE_LINK_SAFE_LENGTH;
}

export function readSharePayload(hash: string = window.location.hash): string | null {
    if (!hash.startsWith(SHARE_HASH_PREFIX)) return null;

    const payload = hash.slice(SHARE_HASH_PREFIX.length);
    return payload.length > 0 ? payload : null;
}

export function clearShareHash(): void {
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}`);
}
