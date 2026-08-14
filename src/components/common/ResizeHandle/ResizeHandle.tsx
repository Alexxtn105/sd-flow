import { useRef } from 'react';
import { PANEL_BOUNDS } from '../../../utils/panelSize';
import type { PanelKey } from '../../../utils/panelSize';
import { useUiStore } from '../../../store/uiStore';
import './ResizeHandle.css';

export type ResizeSide = 'right' | 'left' | 'top';

interface ResizeHandleProps {
    panel: PanelKey;
    side: ResizeSide;
    label: string;
}

const KEYBOARD_STEP = 16;

const GROW_TOWARDS: Record<ResizeSide, number> = { right: 1, left: -1, top: -1 };

export default function ResizeHandle({ panel, side, label }: ResizeHandleProps) {
    const bounds = PANEL_BOUNDS[panel];
    const size = useUiStore((state) => state.panels[panel]);
    const setPanelSize = useUiStore((state) => state.setPanelSize);
    const resetPanelSize = useUiStore((state) => state.resetPanelSize);
    const persistPanels = useUiStore((state) => state.persistPanels);

    const origin = useRef<{ pointer: number; size: number } | null>(null);

    const pointerCoordinate = (event: React.PointerEvent<HTMLDivElement>): number =>
        bounds.axis === 'x' ? event.clientX : event.clientY;

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { pointer: pointerCoordinate(event), size };
        document.body.classList.add(`is-resizing-${bounds.axis}`);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const start = origin.current;
        if (!start) return;
        const delta = (pointerCoordinate(event) - start.pointer) * GROW_TOWARDS[side];
        setPanelSize(panel, start.size + delta);
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!origin.current) return;
        origin.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.classList.remove('is-resizing-x', 'is-resizing-y');
        persistPanels();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const forward = bounds.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        const backward = bounds.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';

        if (event.key === 'Home') {
            event.preventDefault();
            resetPanelSize(panel);
            return;
        }

        if (event.key !== forward && event.key !== backward) return;

        event.preventDefault();
        const step = (event.key === forward ? KEYBOARD_STEP : -KEYBOARD_STEP) * GROW_TOWARDS[side];
        setPanelSize(panel, size + step);
        persistPanels();
    };

    return (
        <div
            className={`resize-handle resize-handle-${side}`}
            role="separator"
            aria-orientation={bounds.axis === 'x' ? 'vertical' : 'horizontal'}
            aria-label={label}
            aria-valuenow={size}
            aria-valuemin={bounds.min}
            aria-valuemax={bounds.max}
            tabIndex={0}
            title={label}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={() => resetPanelSize(panel)}
            onKeyDown={handleKeyDown}
        />
    );
}
