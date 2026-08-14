import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../src/store/uiStore';

describe('проекция тепловой карты на схему', () => {
    beforeEach(() => {
        useUiStore.setState({ probeWindowIds: [], heatmapProbeId: null });
    });

    it('красит схему одной пробой за раз', () => {
        useUiStore.getState().toggleHeatmapProbe('heat-a');
        expect(useUiStore.getState().heatmapProbeId).toBe('heat-a');

        useUiStore.getState().toggleHeatmapProbe('heat-b');
        expect(useUiStore.getState().heatmapProbeId).toBe('heat-b');
    });

    it('повторное нажатие снимает раскраску', () => {
        useUiStore.getState().toggleHeatmapProbe('heat-a');
        useUiStore.getState().toggleHeatmapProbe('heat-a');

        expect(useUiStore.getState().heatmapProbeId).toBeNull();
    });

    it('закрытие окна пробы снимает её раскраску, чтобы её было чем выключить', () => {
        useUiStore.getState().toggleProbeWindow('heat-a');
        useUiStore.getState().toggleHeatmapProbe('heat-a');
        useUiStore.getState().closeProbeWindow('heat-a');

        expect(useUiStore.getState().probeWindowIds).toEqual([]);
        expect(useUiStore.getState().heatmapProbeId).toBeNull();
    });

    it('закрытие чужого окна не трогает раскраску', () => {
        useUiStore.getState().toggleProbeWindow('heat-a');
        useUiStore.getState().toggleProbeWindow('other');
        useUiStore.getState().toggleHeatmapProbe('heat-a');
        useUiStore.getState().closeProbeWindow('other');

        expect(useUiStore.getState().probeWindowIds).toEqual(['heat-a']);
        expect(useUiStore.getState().heatmapProbeId).toBe('heat-a');
    });

    it('переключатель окна тоже снимает раскраску, когда закрывает окно', () => {
        useUiStore.getState().toggleProbeWindow('heat-a');
        useUiStore.getState().toggleHeatmapProbe('heat-a');
        useUiStore.getState().toggleProbeWindow('heat-a');

        expect(useUiStore.getState().heatmapProbeId).toBeNull();
    });

    it('открытие окна не включает раскраску само по себе', () => {
        useUiStore.getState().toggleProbeWindow('heat-a');

        expect(useUiStore.getState().probeWindowIds).toEqual(['heat-a']);
        expect(useUiStore.getState().heatmapProbeId).toBeNull();
    });
});
