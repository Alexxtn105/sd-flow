import { describe, expect, it } from 'vitest';
import { PANEL_BOUNDS } from '../../src/utils/panelSize';
import { placePopover } from '../../src/utils/popoverPlacement';

const CANVAS = { canvasLeft: 0, canvasRight: 1200 };
const GAP = 10;
const WANTED = 340;

function place(nodeLeft: number, nodeRight: number, canvas = CANVAS, wanted = WANTED) {
    return placePopover({ ...canvas, nodeLeft, nodeRight, gap: GAP, wanted });
}

describe('сторона карточки параметров', () => {
    it('справа от блока, когда места хватает', () => {
        expect(place(100, 260)).toEqual({ flipped: false, room: 930 });
    });

    it('уходит влево, когда справа не помещается, а слева просторнее', () => {
        expect(place(800, 960)).toEqual({ flipped: true, room: 790 });
    });

    it('остаётся справа, когда тесно с обеих сторон, но справа шире', () => {
        expect(place(100, 260, { canvasLeft: 90, canvasRight: 500 })).toEqual({
            flipped: false,
            room: PANEL_BOUNDS.popover.min,
        });
    });

    it('не обещает меньше минимальной ширины на узком холсте', () => {
        expect(place(140, 200, { canvasLeft: 0, canvasRight: 300 })).toEqual({
            flipped: true,
            room: PANEL_BOUNDS.popover.min,
        });
    });

    it('учитывает запрошенную ширину: узкой карточке места хватает, широкой — нет', () => {
        expect(place(800, 960, CANVAS, 200).flipped).toBe(false);
        expect(place(800, 960, CANVAS, 500).flipped).toBe(true);
    });
});
