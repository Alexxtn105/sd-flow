import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { compareModelVersions, migrateScheme, SCHEME_VERSION } from '../../src/services/schemeMigrations';
import { isScheme, toScheme } from '../../src/services/schemeSerializer';
import { DEFAULT_SETTINGS, MODEL_VERSION } from '../../src/engine/types/scheme';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';
import { buildScheme } from '../helpers/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

function current() {
    return buildScheme({
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'api', type: 'service' },
            { id: 'db', type: 'postgres' },
        ],
        links: [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'db' },
        ],
    });
}

function ok(raw: unknown) {
    const read = migrateScheme(raw);
    if (!read.ok) throw new Error(`ожидалась схема, получено ${read.reason}`);
    return read;
}

describe('чтение схемы', () => {
    it('принимает схему текущей версии без замечаний', () => {
        const read = ok(current());

        expect(read.report.version).toBe(SCHEME_VERSION);
        expect(read.report.modelVersion).toBe(MODEL_VERSION);
        expect(read.report.notes).toHaveLength(0);
    });

    it('отвергает то, что схемой не является', () => {
        for (const raw of [null, 42, 'scheme', {}, { version: 1 }, { version: 0, nodes: [], edges: [] }]) {
            expect(migrateScheme(raw)).toEqual({ ok: false, reason: 'not-a-scheme' });
        }
    });

    it('отвергает схему из будущей версии формата', () => {
        expect(migrateScheme({ ...current(), version: SCHEME_VERSION + 1 })).toEqual({
            ok: false,
            reason: 'future-version',
        });
    });

    it('isScheme отвечает тем же вердиктом', () => {
        expect(isScheme(current())).toBe(true);
        expect(isScheme({ ...current(), version: 99 })).toBe(false);
        expect(isScheme({ hello: 'world' })).toBe(false);
    });
});

describe('миграция схемы', () => {
    it('сообщает о выброшенных незнакомых блоках и осиротевших связях', () => {
        const scheme = current();
        const broken = {
            ...scheme,
            nodes: [...scheme.nodes, { id: 'ghost', type: 'quantum-db', position: { x: 0, y: 0 }, params: {} }],
            edges: [
                ...scheme.edges,
                { ...scheme.edges[0], id: 'edge-ghost', source: 'db', target: 'ghost' },
            ],
        };

        const read = ok(broken);
        const dropped = read.report.notes.find((note) => note.code === 'unknown-blocks');
        const orphans = read.report.notes.find((note) => note.code === 'dropped-links');

        expect(dropped?.values).toEqual({ count: 1, types: 'quantum-db' });
        expect(orphans?.values).toEqual({ count: 1 });
        expect(read.scheme.nodes.map((node) => node.id)).not.toContain('ghost');
        expect(read.scheme.edges.map((edge) => edge.id)).not.toContain('edge-ghost');
    });

    it('замечает, что схема сохранена на другой версии модели', () => {
        const older = ok({ ...current(), modelVersion: '0.0.9' }).report.notes;
        const newer = ok({ ...current(), modelVersion: '9.0.0' }).report.notes;

        expect(older[0]).toEqual({ code: 'model-behind', values: { saved: '0.0.9', current: MODEL_VERSION } });
        expect(newer[0]).toEqual({ code: 'model-ahead', values: { saved: '9.0.0', current: MODEL_VERSION } });
    });

    it('версия модели без поля считается самой старой', () => {
        const scheme: Record<string, unknown> = { ...current() };
        delete scheme.modelVersion;

        expect(ok(scheme).report.modelVersion).toBe('0.0.0');
        expect(ok(scheme).scheme.modelVersion).toBe(MODEL_VERSION);
    });

    it('сравнивает версии модели по числам, а не по строкам', () => {
        expect(compareModelVersions('0.10.0', '0.9.0')).toBe(1);
        expect(compareModelVersions('0.1.0', '0.1')).toBe(0);
        expect(compareModelVersions('1.0.0', '1.0.1')).toBe(-1);
    });

    it('дополняет недостающие настройки и политику связи значениями по умолчанию', () => {
        const scheme = current();
        const stripped = {
            version: 1,
            nodes: scheme.nodes,
            edges: scheme.edges.map((edge) => ({ ...edge, policy: { retries: 3 } })),
        };

        const read = ok(stripped);

        expect(read.scheme.settings).toEqual(DEFAULT_SETTINGS);
        expect(read.scheme.edges[0].policy).toEqual({
            timeoutMs: 1000,
            retries: 3,
            circuitBreaker: false,
            idempotent: false,
        });
        expect(read.scheme.ui.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
        expect(read.scheme.meta.id).toBe('scheme');
    });

    it('переживает круг сохранение → чтение без потерь', () => {
        const scheme = current();
        const read = ok(toScheme({ meta: scheme.meta, nodes: [], edges: [], settings: scheme.settings }));

        expect(read.report.notes).toHaveLength(0);
        expect(read.scheme.settings).toEqual(scheme.settings);
    });

    it('каждое замечание переведено на оба языка', () => {
        for (const code of ['model-behind', 'model-ahead', 'unknown-blocks', 'dropped-links']) {
            expect(ruCommon.storage.migration).toHaveProperty(code);
            expect(enCommon.storage.migration).toHaveProperty(code);
        }

        for (const reason of ['not-a-scheme', 'future-version']) {
            expect(ruCommon.dialog.importFailed).toHaveProperty(reason);
            expect(enCommon.dialog.importFailed).toHaveProperty(reason);
        }
    });
});
