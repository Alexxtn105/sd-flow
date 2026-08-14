import registry from './ComponentRegistry';
import type { ComponentTypeId, PortDefinition, Protocol } from './types/component';

export function sharedProtocol(source: PortDefinition, target: PortDefinition): Protocol | null {
    return source.protocols.find((protocol) => target.protocols.includes(protocol)) ?? null;
}

export function findPort(type: ComponentTypeId, direction: 'in' | 'out', portId: string): PortDefinition | null {
    return registry.getPorts(type)[direction].find((port) => port.id === portId) ?? null;
}

export function isConnectionAllowed(
    sourceType: ComponentTypeId,
    sourcePortId: string,
    targetType: ComponentTypeId,
    targetPortId: string,
): boolean {
    const source = findPort(sourceType, 'out', sourcePortId);
    const target = findPort(targetType, 'in', targetPortId);
    if (!source || !target) return false;
    return sharedProtocol(source, target) !== null;
}

export interface PortPair {
    sourceHandle: string;
    targetHandle: string;
    protocol: Protocol;
}

export function firstCompatiblePair(sourceType: ComponentTypeId, targetType: ComponentTypeId): PortPair | null {
    for (const source of registry.getPorts(sourceType).out) {
        for (const target of registry.getPorts(targetType).in) {
            const protocol = sharedProtocol(source, target);
            if (protocol) {
                return { sourceHandle: source.id, targetHandle: target.id, protocol };
            }
        }
    }
    return null;
}

export function canConnectTypes(sourceType: ComponentTypeId, targetType: ComponentTypeId): boolean {
    return firstCompatiblePair(sourceType, targetType) !== null;
}
