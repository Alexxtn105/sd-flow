import { PANEL_BOUNDS } from './panelSize';

export interface PopoverAnchor {
    nodeLeft: number;
    nodeRight: number;
    canvasLeft: number;
    canvasRight: number;
    gap: number;
    wanted: number;
}

export interface PopoverPlacement {
    flipped: boolean;
    room: number;
}

export const FREE_PLACEMENT: PopoverPlacement = { flipped: false, room: Number.POSITIVE_INFINITY };

export function placePopover(anchor: PopoverAnchor): PopoverPlacement {
    const toRight = anchor.canvasRight - anchor.nodeRight - anchor.gap;
    const toLeft = anchor.nodeLeft - anchor.canvasLeft - anchor.gap;
    const flipped = toRight < anchor.wanted && toLeft > toRight;

    return { flipped, room: Math.max(flipped ? toLeft : toRight, PANEL_BOUNDS.popover.min) };
}
