import { describe, expect, it } from 'vitest';
import { parseYaml } from '../../src/engine/authoring/yaml';

function parse(source: string): unknown {
    const result = parseYaml(source);
    if (!result.ok) throw new Error(`${result.code} на строке ${result.line}`);

    return result.value;
}

function failure(source: string): { code: string; line: number } {
    const result = parseYaml(source);
    if (result.ok) throw new Error('ожидалась ошибка разбора');

    return { code: result.code, line: result.line };
}

describe('разбор YAML-подмножества', () => {
    it('читает вложенные наборы полей', () => {
        expect(parse('a: 1\nb:\n  c: два\n  d: true\n')).toEqual({ a: 1, b: { c: 'два', d: true } });
    });

    it('читает списки скаляров и вложенные наборы в списке', () => {
        expect(parse('items:\n  - one\n  - two\n')).toEqual({ items: ['one', 'two'] });
        expect(parse('items:\n  - id: R1\n    kind: slo\n  - id: R2\n    kind: budget\n')).toEqual({
            items: [
                { id: 'R1', kind: 'slo' },
                { id: 'R2', kind: 'budget' },
            ],
        });
    });

    it('различает числа, логические значения и пустоту', () => {
        expect(parse('a: 1_000_000\nb: 0.25\nc: 1e3\nd: false\ne: null\nf: ~\ng:\n')).toEqual({
            a: 1000000,
            b: 0.25,
            c: 1000,
            d: false,
            e: null,
            f: null,
            g: null,
        });
    });

    it('сохраняет строки в кавычках как строки', () => {
        expect(parse('a: "1000"\nb: \'да: нет\'\nc: "перенос\\nстроки"\n')).toEqual({
            a: '1000',
            b: 'да: нет',
            c: 'перенос\nстроки',
        });
    });

    it('читает потоковые списки и наборы, в том числе вложенные', () => {
        expect(parse('tags: [cache, cost]\nmatcher: { group: storage, type: s3 }\n')).toEqual({
            tags: ['cache', 'cost'],
            matcher: { group: 'storage', type: 's3' },
        });
        expect(parse('notVia: [{ group: sql }, { group: cache }]\n')).toEqual({
            notVia: [{ group: 'sql' }, { group: 'cache' }],
        });
        expect(parse('empty: []\nnothing: {}\n')).toEqual({ empty: [], nothing: {} });
    });

    it('читает блочные скаляры и складывает свёрнутые', () => {
        expect(parse('text: |\n  первая\n  вторая\n')).toEqual({ text: 'первая\nвторая' });
        expect(parse('text: >\n  первая\n  вторая\n')).toEqual({ text: 'первая вторая' });
        expect(parse('text: |\n  - id: R1\n  - id: R2\nnext: 1\n')).toEqual({
            text: '- id: R1\n- id: R2',
            next: 1,
        });
    });

    it('выбрасывает комментарии и разделители документа', () => {
        expect(parse('---\n# заголовок\na: 1 # хвост\nb: "# не комментарий"\n')).toEqual({
            a: 1,
            b: '# не комментарий',
        });
    });

    it('принимает JSON как есть', () => {
        expect(parse('{ "a": 1, "b": [2, 3] }')).toEqual({ a: 1, b: [2, 3] });
    });

    it('сообщает строку и причину ошибки', () => {
        expect(failure('a: 1\n\tb: 2\n')).toEqual({ code: 'tab-indent', line: 2 });
        expect(failure('a: 1\n  b: 2\n')).toEqual({ code: 'bad-indent', line: 2 });
        expect(failure('a: 1\nпросто строка\n')).toEqual({ code: 'expected-key', line: 2 });
        expect(failure('a: [1, 2\n')).toEqual({ code: 'unbalanced-flow', line: 1 });
        expect(failure('a: &anchor\n')).toEqual({ code: 'unsupported-yaml', line: 1 });
        expect(failure('a: 1\na: 2\n')).toEqual({ code: 'duplicate-key', line: 2 });
        expect(failure('{ "a": ')).toEqual({ code: 'bad-json', line: 1 });
    });

    it('считает пустой текст пустым значением', () => {
        expect(parse('')).toBeNull();
        expect(parse('# только комментарий\n')).toBeNull();
    });
});
