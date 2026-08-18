import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();

    return {
        ...actual,
        useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
            selector({ transform: [0, 0, 1] }),
    };
});

import css from '../../src/components/canvas/ParamPopover.css?raw';
import ParamPopover from '../../src/components/canvas/ParamPopover';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { pricingFor } from '../../src/engine/sim/constants';
import { costDrivers } from '../../src/engine/sim/costDrivers';
import { DEFAULT_SETTINGS } from '../../src/engine/types/scheme';
import i18n from '../../src/locales/i18n';
import { useGraphStore } from '../../src/store/graphStore';
import { useUiStore } from '../../src/store/uiStore';
import { groupParams } from '../../src/utils/paramSections';

const MAX_FIELDS = 6;
const BLOCKS = ['service', 'postgres', 'redis', 'kafka', 's3', 'lb-l7'];

beforeAll(async () => {
    registry.reset();
    initComponents();
    await i18n.changeLanguage('ru');
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function render(element: ReactElement): string {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
        root.render(element);
    });
    const markup = host.innerHTML;
    act(() => root.unmount());
    host.remove();

    return markup;
}

function cardFor(componentType: string): string {
    useGraphStore.getState().clear();
    const nodeId = useGraphStore.getState().addComponent(componentType, { x: 0, y: 0 });
    if (!nodeId) return '';

    return render(createElement(ParamPopover, { nodeId, componentType }));
}

function occurrences(markup: string, marker: string): number {
    return markup.split(marker).length - 1;
}

function shownParams(componentType: string): string[] {
    const definition = registry.get(componentType);
    if (!definition) return [];

    return groupParams(definition.defaultParams, definition.paramSchema)
        .flatMap((section) => section.entries)
        .slice(0, MAX_FIELDS)
        .map((entry) => entry.key);
}

function drivers(componentType: string) {
    const definition = registry.get(componentType);
    if (!definition) return [];

    return costDrivers(definition, definition.defaultParams, pricingFor(DEFAULT_SETTINGS.pricingProfile));
}

function ruleBody(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) return '';

    return css.slice(start, css.indexOf('}', start));
}

describe('карточка параметров на холсте', () => {
    it('показывает подписи первых шести параметров целиком', () => {
        const markup = cardFor('service');

        expect(occurrences(markup, 'sd-popover-row')).toBe(MAX_FIELDS);
        for (const key of shownParams('service')) {
            expect(markup).toContain(i18n.t(key, { ns: 'params' }));
        }
    });

    it('подпись переносится, а не обрезается многоточием', () => {
        const label = ruleBody('.sd-popover-label');

        expect(label).not.toBe('');
        expect(label).not.toContain('text-overflow');
        expect(label).not.toContain('nowrap');
    });

    it('берёт ширину из размеров панелей, а не из стилей', () => {
        expect(ruleBody('.sd-popover')).not.toContain('width');
        expect(cardFor('service')).toContain(`width: ${useUiStore.getState().panels.popover}px`);
    });

    it('гасит масштаб холста, чтобы подписи не мельчали', () => {
        expect(cardFor('service')).toContain('transform: scale(1)');
    });

    it('даёт потянуть за край и вернуть ширину двойным кликом', () => {
        const markup = cardFor('service');

        expect(markup).toContain('resize-handle-right');
        expect(markup).toContain(i18n.t('resize.popover'));
    });

    it('помечает знаком $ ровно те параметры, что двигают счёт', () => {
        for (const componentType of BLOCKS) {
            const shown = new Set(shownParams(componentType));
            const expected = drivers(componentType).filter((driver) => shown.has(driver.param)).length;

            expect([componentType, occurrences(cardFor(componentType), 'sd-popover-cost')]).toEqual([
                componentType,
                expected,
            ]);
        }
    });

    it('называет статьи счёта той же подсказкой, что инспектор', () => {
        const compute = drivers('service').find((driver) => driver.param === 'instances');

        expect(compute).toBeDefined();
        expect(cardFor('service')).toContain(
            i18n.t('inspector.costDriver', {
                articles: compute!.articles.map((article) => i18n.t(`cost.article.${article}`)).join(', '),
            }),
        );
    });
});
