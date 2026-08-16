import { describe, expect, it } from 'vitest';
import enBlocks from '../../src/locales/en/blocks.json';
import enCommon from '../../src/locales/en/common.json';
import enGroups from '../../src/locales/en/groups.json';
import enNodes from '../../src/locales/en/nodes.json';
import enParams from '../../src/locales/en/params.json';
import ruBlocks from '../../src/locales/ru/blocks.json';
import ruCommon from '../../src/locales/ru/common.json';
import ruGroups from '../../src/locales/ru/groups.json';
import ruNodes from '../../src/locales/ru/nodes.json';
import ruParams from '../../src/locales/ru/params.json';

type Dictionary = Record<string, unknown>;

const RU: Record<string, Dictionary> = {
    blocks: ruBlocks,
    common: ruCommon,
    groups: ruGroups,
    nodes: ruNodes,
    params: ruParams,
};

const EN: Record<string, Dictionary> = {
    blocks: enBlocks,
    common: enCommon,
    groups: enGroups,
    nodes: enNodes,
    params: enParams,
};

const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const KEY_PATTERN = /\bt\(\s*'([^'${}]+)'/g;

const LOOKAHEAD = 140;

function resolves(namespaces: Record<string, Dictionary>, key: string): boolean {
    return Object.values(namespaces).some((namespace) => {
        let node: unknown = namespace;

        for (const part of key.split('.')) {
            if (typeof node !== 'object' || node === null || !(part in node)) return false;
            node = (node as Dictionary)[part];
        }

        return typeof node === 'string';
    });
}

function staticKeys(source: string): string[] {
    return [...source.matchAll(KEY_PATTERN)]
        .filter((match) => !source.slice(match.index, match.index + LOOKAHEAD).includes('defaultValue'))
        .map((match) => match[1]);
}

function flatten(node: unknown, prefix: string): string[] {
    if (typeof node !== 'object' || node === null) return [prefix];
    return Object.entries(node as Dictionary).flatMap(([key, value]) =>
        flatten(value, prefix ? `${prefix}.${key}` : key),
    );
}

describe('локали интерфейса', () => {
    it('находит ключи в исходниках, а не проверяет пустоту', () => {
        const total = Object.values(SOURCES).reduce((sum, source) => sum + staticKeys(source).length, 0);
        expect(total).toBeGreaterThan(100);
    });

    it('каждый статический ключ t() есть в обоих языках', () => {
        const missing: string[] = [];

        for (const [path, source] of Object.entries(SOURCES)) {
            for (const key of staticKeys(source)) {
                if (!resolves(RU, key)) missing.push(`ru: ${key} (${path})`);
                if (!resolves(EN, key)) missing.push(`en: ${key} (${path})`);
            }
        }

        expect(missing).toEqual([]);
    });

    it('у каждого поля связи есть подсказка на обоих языках', () => {
        const fields = ['label', 'kind', 'protocol', 'mixMode', 'call', 'timeoutMs', 'retries'];
        const missing: string[] = [];

        for (const field of fields) {
            const key = `inspector.edgeHint.${field}`;

            if (!resolves(RU, key)) missing.push(`ru: ${key}`);
            if (!resolves(EN, key)) missing.push(`en: ${key}`);
        }

        expect(missing).toEqual([]);
    });

    it('русский и английский словари совпадают по набору ключей', () => {
        for (const namespace of Object.keys(RU)) {
            const ruKeys = flatten(RU[namespace], '').sort();
            const enKeys = flatten(EN[namespace], '').sort();

            expect(ruKeys.filter((key) => !enKeys.includes(key)), `${namespace}: нет в en`).toEqual([]);
            expect(enKeys.filter((key) => !ruKeys.includes(key)), `${namespace}: нет в ru`).toEqual([]);
        }
    });
});
