import { beforeEach, describe, expect, it, vi } from 'vitest';
import StorageService, { STORAGE_KEYS } from '../../src/services/storageService';
import { isTutorialDone, useUiStore } from '../../src/store/uiStore';
import { clampPanelSize, PANEL_BOUNDS, PANEL_KEYS, resolvePanelMax } from '../../src/utils/panelSize';

describe('clampPanelSize', () => {
    it('держит размер между минимумом и долей окна', () => {
        expect(clampPanelSize('palette', 10, 1440)).toBe(PANEL_BOUNDS.palette.min);
        expect(clampPanelSize('palette', 9000, 1440)).toBe(resolvePanelMax('palette', 1440));
        expect(clampPanelSize('palette', 300, 1440)).toBe(300);
    });

    it('на узком окне отдаёт минимум, а не отрицательную ширину', () => {
        expect(clampPanelSize('inspector', 400, 320)).toBe(PANEL_BOUNDS.inspector.min);
    });

    it('подменяет нечисловой размер значением по умолчанию', () => {
        expect(clampPanelSize('dashboard', Number.NaN, 900)).toBe(PANEL_BOUNDS.dashboard.preferred);
    });
});

describe('панели uiStore', () => {
    beforeEach(() => {
        for (const key of PANEL_KEYS) useUiStore.getState().resetPanelSize(key);
        localStorage.clear();
    });

    it('стартует с размеров по умолчанию', () => {
        for (const key of PANEL_KEYS) {
            const viewport = PANEL_BOUNDS[key].axis === 'x' ? window.innerWidth : window.innerHeight;
            expect(useUiStore.getState().panels[key]).toBe(clampPanelSize(key, PANEL_BOUNDS[key].preferred, viewport));
        }
    });

    it('обрезает перетаскивание за пределы допустимого', () => {
        const store = useUiStore.getState();

        store.setPanelSize('palette', 0);
        expect(useUiStore.getState().panels.palette).toBe(PANEL_BOUNDS.palette.min);

        store.setPanelSize('dashboard', 100000);
        expect(useUiStore.getState().panels.dashboard).toBe(resolvePanelMax('dashboard', window.innerHeight));
    });

    it('сбрасывает размер к значению по умолчанию', () => {
        useUiStore.getState().setPanelSize('inspector', 400);
        expect(useUiStore.getState().panels.inspector).toBe(clampPanelSize('inspector', 400, window.innerWidth));

        useUiStore.getState().resetPanelSize('inspector');
        expect(useUiStore.getState().panels.inspector).toBe(
            clampPanelSize('inspector', PANEL_BOUNDS.inspector.preferred, window.innerWidth),
        );
    });

    it('сохраняет размеры в localStorage только после отпускания мыши', () => {
        useUiStore.getState().setPanelSize('dashboard', 300);
        expect(StorageService.load<{ panels?: Record<string, number> }>(STORAGE_KEYS.PREFERENCES)).toBeNull();

        useUiStore.getState().persistPanels();
        const stored = StorageService.load<{ panels?: Record<string, number> }>(STORAGE_KEYS.PREFERENCES);
        expect(stored?.panels?.dashboard).toBe(300);
    });
});

describe('туториал в uiStore', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    async function freshStore() {
        const module = await import('../../src/store/uiStore');
        return module.useUiStore;
    }

    it('показывается на первом запуске', async () => {
        const store = await freshStore();
        expect(store.getState().tutorialOpen).toBe(true);
        expect(isTutorialDone()).toBe(false);
    });

    it('пройденный или закрытый больше не приходит сам', async () => {
        const store = await freshStore();
        store.getState().finishTutorial();

        expect(store.getState().tutorialOpen).toBe(false);
        expect(isTutorialDone()).toBe(true);

        vi.resetModules();
        const restarted = await freshStore();
        expect(restarted.getState().tutorialOpen).toBe(false);
    });

    it('запускается заново из шапки, не забывая отметку о прохождении', async () => {
        const store = await freshStore();
        store.getState().finishTutorial();
        store.getState().startTutorial();

        expect(store.getState().tutorialOpen).toBe(true);
        expect(isTutorialDone()).toBe(true);
    });

    it('переживает сохранение размеров панелей', async () => {
        const store = await freshStore();
        store.getState().finishTutorial();
        store.getState().persistPanels();

        expect(isTutorialDone()).toBe(true);
        expect(
            StorageService.load<{ panels?: Record<string, number> }>(STORAGE_KEYS.PREFERENCES)?.panels?.palette,
        ).toBeGreaterThan(0);
    });
});

describe('окна измерителей', () => {
    beforeEach(() => {
        for (const probeId of [...useUiStore.getState().probeWindowIds]) {
            useUiStore.getState().closeProbeWindow(probeId);
        }
    });

    it('двойной клик открывает окно, повторный — закрывает', () => {
        useUiStore.getState().toggleProbeWindow('probe-1');
        expect(useUiStore.getState().probeWindowIds).toEqual(['probe-1']);

        useUiStore.getState().toggleProbeWindow('probe-1');
        expect(useUiStore.getState().probeWindowIds).toEqual([]);
    });

    it('держит несколько окон в порядке открытия', () => {
        useUiStore.getState().toggleProbeWindow('probe-1');
        useUiStore.getState().toggleProbeWindow('probe-2');
        useUiStore.getState().toggleProbeWindow('probe-3');

        expect(useUiStore.getState().probeWindowIds).toEqual(['probe-1', 'probe-2', 'probe-3']);
    });

    it('закрытие одного окна не трогает остальные', () => {
        useUiStore.getState().toggleProbeWindow('probe-1');
        useUiStore.getState().toggleProbeWindow('probe-2');
        useUiStore.getState().closeProbeWindow('probe-1');

        expect(useUiStore.getState().probeWindowIds).toEqual(['probe-2']);
    });

    it('закрытие неоткрытого окна ничего не меняет', () => {
        useUiStore.getState().toggleProbeWindow('probe-1');
        useUiStore.getState().closeProbeWindow('probe-9');

        expect(useUiStore.getState().probeWindowIds).toEqual(['probe-1']);
    });
});

describe('справка по блоку', () => {
    it('открывается по типу блока и закрывается', () => {
        useUiStore.getState().openBlockHelp('redis');
        expect(useUiStore.getState().helpBlockType).toBe('redis');

        useUiStore.getState().openBlockHelp('postgres');
        expect(useUiStore.getState().helpBlockType).toBe('postgres');

        useUiStore.getState().closeBlockHelp();
        expect(useUiStore.getState().helpBlockType).toBeNull();
    });
});

describe('описания параметров', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('выключены по умолчанию и переживают перезагрузку включёнными', () => {
        expect(useUiStore.getState().paramHints).toBe(false);

        useUiStore.getState().toggleParamHints();
        expect(useUiStore.getState().paramHints).toBe(true);
        expect(StorageService.load<{ paramHints?: boolean }>(STORAGE_KEYS.PREFERENCES)?.paramHints).toBe(true);

        useUiStore.getState().toggleParamHints();
        expect(useUiStore.getState().paramHints).toBe(false);
    });
});

describe('тепловая карта и фокус', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('заливка включена по умолчанию и переживает перезагрузку выключенной', () => {
        expect(useUiStore.getState().heatmapOn).toBe(true);

        useUiStore.getState().toggleHeatmap();
        expect(useUiStore.getState().heatmapOn).toBe(false);
        expect(StorageService.load<{ heatmapOn?: boolean }>(STORAGE_KEYS.PREFERENCES)?.heatmapOn).toBe(false);

        useUiStore.getState().toggleHeatmap();
        expect(useUiStore.getState().heatmapOn).toBe(true);
    });

    it('запрос фокуса меняет выделение и увеличивает счётчик', () => {
        const before = useUiStore.getState().focusRequest;

        useUiStore.getState().focusNodes(['svc'], []);

        expect(useUiStore.getState().selectedNodeIds).toEqual(['svc']);
        expect(useUiStore.getState().focusRequest).toBe(before + 1);

        useUiStore.getState().focusNodes(['svc'], []);
        expect(useUiStore.getState().focusRequest).toBe(before + 2);
    });
});
