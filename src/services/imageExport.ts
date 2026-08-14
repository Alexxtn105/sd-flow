import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { toPng } from 'html-to-image';
import type { SdNode } from '../store/graphStore';

const VIEWPORT_SELECTOR = '.react-flow__viewport';
const IMAGE_PADDING_PX = 48;
const MIN_IMAGE_SIDE = 720;
const MAX_IMAGE_SIDE = 3200;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const PIXEL_RATIO = 2;
const FALLBACK_BACKGROUND = '#0d1117';

export type ImageExportFailure = 'empty' | 'no-canvas' | 'render-failed';

export type ImageExportResult = { ok: true; dataUrl: string } | { ok: false; reason: ImageExportFailure };

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function measuredSize(node: SdNode): { width: number; height: number } {
    const width = typeof node.style?.width === 'number' ? node.style.width : (node.measured?.width ?? 0);
    const height = typeof node.style?.height === 'number' ? node.style.height : (node.measured?.height ?? 0);
    return { width, height };
}

function absolutePosition(node: SdNode, byId: Map<string, SdNode>): { x: number; y: number } {
    let { x, y } = node.position;
    let parentId = node.parentId;

    while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) break;
        x += parent.position.x;
        y += parent.position.y;
        parentId = parent.parentId;
    }

    return { x, y };
}

function flattened(nodes: SdNode[]): SdNode[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));

    return nodes.map((node) => ({
        ...node,
        parentId: undefined,
        position: absolutePosition(node, byId),
        measured: measuredSize(node),
    }));
}

function canvasBackground(): string {
    if (typeof getComputedStyle !== 'function') return FALLBACK_BACKGROUND;

    const value = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
    return value || FALLBACK_BACKGROUND;
}

export async function renderSchemePng(nodes: SdNode[]): Promise<ImageExportResult> {
    if (nodes.length === 0) return { ok: false, reason: 'empty' };

    const bounds = getNodesBounds(flattened(nodes));
    if (bounds.width <= 0 || bounds.height <= 0) return { ok: false, reason: 'empty' };

    const element = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    if (!element) return { ok: false, reason: 'no-canvas' };

    const width = clamp(Math.round(bounds.width) + IMAGE_PADDING_PX * 2, MIN_IMAGE_SIDE, MAX_IMAGE_SIDE);
    const height = clamp(Math.round(bounds.height) + IMAGE_PADDING_PX * 2, MIN_IMAGE_SIDE, MAX_IMAGE_SIDE);
    const viewport = getViewportForBounds(bounds, width, height, MIN_ZOOM, MAX_ZOOM, `${IMAGE_PADDING_PX}px`);

    try {
        const dataUrl = await toPng(element, {
            backgroundColor: canvasBackground(),
            pixelRatio: PIXEL_RATIO,
            skipFonts: true,
            width,
            height,
            style: {
                width: `${width}px`,
                height: `${height}px`,
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            },
        });

        return { ok: true, dataUrl };
    } catch {
        return { ok: false, reason: 'render-failed' };
    }
}
