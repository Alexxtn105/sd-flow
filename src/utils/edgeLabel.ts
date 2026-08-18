import type { Protocol } from '../engine/types/component';

export type EdgeLabelMode = 'both' | 'name' | 'protocol' | 'off';

export const EDGE_LABEL_MODES: EdgeLabelMode[] = ['both', 'name', 'protocol', 'off'];

export const DEFAULT_EDGE_LABEL_MODE: EdgeLabelMode = 'both';

export const PROTOCOL_NAMESPACE = 'common';

export interface EdgeLabelParts {
    name: string;
    protocol: Protocol | '';
}

export function isEdgeLabelMode(value: unknown): value is EdgeLabelMode {
    return EDGE_LABEL_MODES.some((mode) => mode === value);
}

export function protocolLabelKey(protocol: Protocol): string {
    return `${PROTOCOL_NAMESPACE}:protocol.${protocol}`;
}

export function edgeLabelParts(
    mode: EdgeLabelMode,
    name: string,
    protocol: Protocol | '',
): EdgeLabelParts {
    return {
        name: mode === 'both' || mode === 'name' ? name : '',
        protocol: mode === 'both' || mode === 'protocol' ? protocol : '',
    };
}
