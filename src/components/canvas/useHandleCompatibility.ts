import { useCallback } from 'react';
import { isConnectionAllowed } from '../../engine/ports';
import { useUiStore } from '../../store/uiStore';

export type HandleDirection = 'in' | 'out';

export type HandleCompatibility = (portId: string, direction: HandleDirection) => string;

export function useHandleCompatibility(nodeId: string, componentType: string): HandleCompatibility {
    const source = useUiStore((state) => state.connectionSource);

    return useCallback(
        (portId, direction) => {
            if (!source || source.nodeId === nodeId) return '';

            const reachable =
                source.handleType === 'source'
                    ? direction === 'in' &&
                      isConnectionAllowed(source.componentType, source.handleId, componentType, portId)
                    : direction === 'out' &&
                      isConnectionAllowed(componentType, portId, source.componentType, source.handleId);

            return reachable ? 'sd-handle-compatible' : 'sd-handle-incompatible';
        },
        [source, nodeId, componentType],
    );
}
