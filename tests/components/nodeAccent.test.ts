import { beforeAll, describe, expect, it } from 'vitest';
import css from '../../src/components/canvas/SdNode.css?raw';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';

beforeAll(() => {
    registry.reset();
    initComponents();
});

function ruleBody(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) return '';

    return css.slice(start, css.indexOf('}', start));
}

function groupsOnCanvas(): string[] {
    const groups = registry
        .list()
        .filter((definition) => definition.shape === 'node')
        .map((definition) => definition.group);

    return [...new Set(groups)];
}

describe('цветная грань блока', () => {
    it('есть у каждой группы каталога', () => {
        const missing = groupsOnCanvas().filter(
            (group) => !ruleBody(`.sd-node-${group}`).includes('border-left-color'),
        );

        expect(missing).toEqual([]);
    });

    it('тёмная тема перекрашивает только три остальные грани', () => {
        const dark = ruleBody('.dark-theme .sd-node');

        expect(dark).not.toBe('');
        expect(dark).toContain('border-top-color');
        expect(dark).toContain('border-right-color');
        expect(dark).toContain('border-bottom-color');
        expect(dark).not.toContain('border-left-color');
        expect(dark).not.toMatch(/border-color\s*:/);
    });
});
