export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

export interface YamlFailure {
    ok: false;
    code: string;
    line: number;
}

export interface YamlSuccess {
    ok: true;
    value: YamlValue;
}

export type YamlResult = YamlSuccess | YamlFailure;

interface Line {
    number: number;
    indent: number;
    text: string;
    raw: string;
    blank: boolean;
}

const NUMBER_PATTERN = /^-?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?$/;
const BOOLEAN_TRUE = new Set(['true', 'yes', 'on']);
const BOOLEAN_FALSE = new Set(['false', 'no', 'off']);
const EMPTY_VALUES = new Set(['null', '~', '']);
const UNSUPPORTED_PREFIXES = ['&', '*', '!', '%'];
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', '0': '\0' };

class YamlFault extends Error {
    code: string;
    line: number;

    constructor(code: string, line: number) {
        super(`${code}:${line}`);
        this.code = code;
        this.line = line;
    }
}

function fault(code: string, line: number): never {
    throw new YamlFault(code, line);
}

function indentOf(raw: string): number {
    let count = 0;
    while (count < raw.length && raw[count] === ' ') count += 1;
    return count;
}

function stripComment(text: string): string {
    let quote = '';

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (quote) {
            if (char === '\\' && quote === '"') index += 1;
            else if (char === quote) quote = '';
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (char === '#' && (index === 0 || text[index - 1] === ' ')) return text.slice(0, index);
    }

    return text;
}

function keySeparator(text: string): number {
    let quote = '';
    let depth = 0;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (quote) {
            if (char === '\\' && quote === '"') index += 1;
            else if (char === quote) quote = '';
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (char === '[' || char === '{') depth += 1;
        else if (char === ']' || char === '}') depth -= 1;
        else if (char === ':' && depth === 0 && (index + 1 === text.length || text[index + 1] === ' ')) return index;
    }

    return -1;
}

function pushLine(lines: Line[], number: number, indent: number, text: string, raw: string): void {
    let column = indent;
    let rest = text;

    while (rest.startsWith('- ') || rest === '-') {
        const marker = rest === '-' ? '' : rest.slice(2).trimStart();
        if (marker === '' || keySeparator(marker) < 0) break;

        lines.push({ number, indent: column, text: '-', raw, blank: false });
        column += rest.length - marker.length;
        rest = marker;
    }

    lines.push({ number, indent: column, text: rest, raw, blank: false });
}

function readLines(source: string): Line[] {
    const lines: Line[] = [];

    source.split(/\r?\n/).forEach((raw, index) => {
        const number = index + 1;

        if (raw.slice(0, raw.length - raw.trimStart().length).includes('\t')) fault('tab-indent', number);

        const text = stripComment(raw).trimEnd();

        if (text.trim() === '' || text.trim() === '---') {
            lines.push({ number, indent: 0, text: '', raw, blank: true });
            return;
        }

        pushLine(lines, number, indentOf(text), text.trim(), raw);
    });

    return lines;
}

function unquote(text: string, line: number): string {
    if (text.length > 1 && text.startsWith("'") && text.endsWith("'")) {
        return text.slice(1, -1).replace(/''/g, "'");
    }

    if (!(text.length > 1 && text.startsWith('"') && text.endsWith('"'))) return text;

    let out = '';

    for (let index = 1; index < text.length - 1; index += 1) {
        const char = text[index];

        if (char !== '\\') {
            out += char;
            continue;
        }

        const next = text[index + 1];
        const decoded = ESCAPES[next];
        if (decoded === undefined) fault('bad-escape', line);

        out += decoded;
        index += 1;
    }

    return out;
}

function isQuoted(text: string): boolean {
    const quoted = (quote: string) => text.length > 1 && text.startsWith(quote) && text.endsWith(quote);
    return quoted('"') || quoted("'");
}

function parseScalar(text: string, line: number): YamlValue {
    if (isQuoted(text)) return unquote(text, line);

    if (UNSUPPORTED_PREFIXES.includes(text[0])) fault('unsupported-yaml', line);

    const lowered = text.toLowerCase();
    if (EMPTY_VALUES.has(lowered)) return null;
    if (BOOLEAN_TRUE.has(lowered)) return true;
    if (BOOLEAN_FALSE.has(lowered)) return false;
    if (NUMBER_PATTERN.test(text)) return Number(text.replace(/_/g, ''));

    return text;
}

function splitFlow(body: string, line: number): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote = '';
    let start = 0;

    for (let index = 0; index < body.length; index += 1) {
        const char = body[index];

        if (quote) {
            if (char === '\\' && quote === '"') index += 1;
            else if (char === quote) quote = '';
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (char === '[' || char === '{') depth += 1;
        else if (char === ']' || char === '}') depth -= 1;
        else if (char === ',' && depth === 0) {
            parts.push(body.slice(start, index).trim());
            start = index + 1;
        }

        if (depth < 0) fault('unbalanced-flow', line);
    }

    if (depth !== 0 || quote) fault('unbalanced-flow', line);

    parts.push(body.slice(start).trim());
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();

    return parts;
}

function parseFlow(text: string, line: number): YamlValue {
    if (text.startsWith('[')) {
        if (!text.endsWith(']')) fault('unbalanced-flow', line);

        const body = text.slice(1, -1).trim();
        if (body === '') return [];

        return splitFlow(body, line).map((part) => parseValue(part, line));
    }

    if (!text.endsWith('}')) fault('unbalanced-flow', line);

    const body = text.slice(1, -1).trim();
    const map: Record<string, YamlValue> = {};
    if (body === '') return map;

    for (const part of splitFlow(body, line)) {
        const separator = keySeparator(part);
        if (separator < 0) fault('expected-key', line);

        const key = unquote(part.slice(0, separator).trim(), line);
        map[key] = parseValue(part.slice(separator + 1).trim(), line);
    }

    return map;
}

function parseValue(text: string, line: number): YamlValue {
    if (text.startsWith('[') || text.startsWith('{')) return parseFlow(text, line);
    return parseScalar(text, line);
}

class Reader {
    private lines: Line[];
    private index = 0;

    constructor(lines: Line[]) {
        this.lines = lines;
    }

    private skipBlank(): void {
        while (this.index < this.lines.length && this.lines[this.index].blank) this.index += 1;
    }

    private peek(): Line | null {
        this.skipBlank();
        return this.index < this.lines.length ? this.lines[this.index] : null;
    }

    private blockScalar(header: string, indent: number, line: number): string {
        const style = header[0];
        const chomping = header.slice(1);
        if (chomping !== '' && chomping !== '-') fault('unsupported-chomping', line);

        const collected: string[] = [];
        let taken = 0;

        while (this.index < this.lines.length) {
            const current = this.lines[this.index];
            if (!current.blank && indentOf(current.raw) <= indent) break;

            if (current.number !== taken) collected.push(current.blank ? '' : current.raw);
            taken = current.number;
            this.index += 1;
        }

        while (collected.length > 0 && collected[collected.length - 1].trim() === '') collected.pop();
        if (collected.length === 0) return '';

        const margin = collected
            .filter((row) => row.trim() !== '')
            .reduce((least, row) => Math.min(least, indentOf(row)), Number.MAX_SAFE_INTEGER);

        const body = collected.map((row) => (row.trim() === '' ? '' : row.slice(margin)));

        if (style === '|') return body.join('\n');

        return body.reduce((folded, row) => {
            if (folded === '') return row;
            if (row === '') return `${folded}\n`;
            return folded.endsWith('\n') ? `${folded}${row}` : `${folded} ${row}`;
        }, '');
    }

    private child(parentIndent: number): YamlValue {
        const next = this.peek();
        if (!next || next.indent <= parentIndent) return null;

        return this.block(next.indent);
    }

    private inline(text: string, indent: number, line: number): YamlValue {
        if (text.startsWith('|') || text.startsWith('>')) return this.blockScalar(text, indent, line);
        return parseValue(text, line);
    }

    private sequence(indent: number): YamlValue[] {
        const items: YamlValue[] = [];

        for (;;) {
            const line = this.peek();
            if (!line || line.indent !== indent || (line.text !== '-' && !line.text.startsWith('- '))) break;

            const rest = line.text === '-' ? '' : line.text.slice(2).trim();
            this.index += 1;

            items.push(rest === '' ? this.child(indent) : this.inline(rest, indent, line.number));
        }

        return items;
    }

    private mapping(indent: number): Record<string, YamlValue> {
        const map: Record<string, YamlValue> = {};

        for (;;) {
            const line = this.peek();
            if (!line || line.indent < indent) break;
            if (line.indent > indent) fault('bad-indent', line.number);
            if (line.text === '-' || line.text.startsWith('- ')) break;

            const separator = keySeparator(line.text);
            if (separator < 0) fault('expected-key', line.number);

            const key = unquote(line.text.slice(0, separator).trim(), line.number);
            if (key === '') fault('empty-key', line.number);
            if (key in map) fault('duplicate-key', line.number);

            const rest = line.text.slice(separator + 1).trim();
            this.index += 1;

            map[key] = rest === '' ? this.child(indent) : this.inline(rest, indent, line.number);
        }

        return map;
    }

    private block(indent: number): YamlValue {
        const line = this.peek();
        if (!line) return null;

        if (line.text === '-' || line.text.startsWith('- ')) return this.sequence(indent);
        if (keySeparator(line.text) >= 0) return this.mapping(indent);

        this.index += 1;
        return this.inline(line.text, indent, line.number);
    }

    read(): YamlValue {
        const first = this.peek();
        if (!first) return null;

        const value = this.block(first.indent);
        const trailing = this.peek();
        if (trailing) fault('bad-indent', trailing.number);

        return value;
    }
}

export function parseYaml(source: string): YamlResult {
    try {
        if (source.trim().startsWith('{')) return { ok: true, value: JSON.parse(source) as YamlValue };

        return { ok: true, value: new Reader(readLines(source)).read() };
    } catch (error) {
        if (error instanceof YamlFault) return { ok: false, code: error.code, line: error.line };
        if (error instanceof SyntaxError) return { ok: false, code: 'bad-json', line: 1 };

        return { ok: false, code: 'unparsable', line: 1 };
    }
}
