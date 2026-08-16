import type { Node } from '@xyflow/react';

export interface NodeDimensions {
    width: number;
    height: number;
}

export const CONTAINER_SIZE: Record<string, NodeDimensions> = {
    region: { width: 620, height: 420 },
    az: { width: 280, height: 320 },
    vpc: { width: 660, height: 460 },
    'k8s-cluster': { width: 480, height: 340 },
};

function pick(explicit: number | undefined, styled: unknown, measured: number | undefined): number {
    if (typeof explicit === 'number') return explicit;
    if (typeof styled === 'number') return styled;
    return measured ?? 0;
}

export function nodeDimensions(node: Node): NodeDimensions {
    return {
        width: pick(node.width, node.style?.width, node.measured?.width),
        height: pick(node.height, node.style?.height, node.measured?.height),
    };
}
