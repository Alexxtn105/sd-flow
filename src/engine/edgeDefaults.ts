import registry from './ComponentRegistry';
import { findPort } from './ports';
import { nextId } from './ids';
import { DEFAULT_POLICY } from './types/scheme';
import type { CallProfile, EdgeKind, SchemeEdge } from './types/scheme';
import type { ComponentParams } from './types/component';
import type { ComponentTypeId, GroupId } from './types/component';

const STORAGE_GROUPS: GroupId[] = ['sql', 'nosql', 'search', 'olap', 'storage'];

interface MixPreset {
    readShare: number;
    requestBytes: number;
    responseBytes: number;
}

function mixFor(targetType: ComponentTypeId): MixPreset {
    const group = registry.get(targetType)?.group;

    if (group === 'cache') return { readShare: 0.95, requestBytes: 200, responseBytes: 2000 };
    if (group === 'storage') return { readShare: 0.8, requestBytes: 1000, responseBytes: 500000 };
    if (group && STORAGE_GROUPS.includes(group)) return { readShare: 0.9, requestBytes: 300, responseBytes: 4000 };
    return { readShare: 0.9, requestBytes: 500, responseBytes: 2000 };
}

function readWriteProfiles(targetType: ComponentTypeId): CallProfile[] {
    const { readShare, requestBytes, responseBytes } = mixFor(targetType);
    return [
        {
            id: 'read',
            op: 'read',
            share: readShare,
            fanout: 1,
            requestBytes,
            responseBytes,
        },
        {
            id: 'write',
            op: 'write',
            share: Number((1 - readShare).toFixed(2)),
            fanout: 1,
            requestBytes: responseBytes,
            responseBytes: 200,
        },
    ];
}

function singleProfile(op: CallProfile['op'], requestBytes: number, responseBytes: number): CallProfile[] {
    return [{ id: op, op, share: 1, fanout: 1, requestBytes, responseBytes }];
}

interface EdgeShape {
    kind: EdgeKind;
    calls: CallProfile[];
    pull: boolean;
}

function shapeFor(
    sourceType: ComponentTypeId,
    sourceHandle: string,
    targetType: ComponentTypeId,
): EdgeShape {
    const sourceRole = findPort(sourceType, 'out', sourceHandle)?.role;
    const targetGroup = registry.get(targetType)?.group;

    if (targetGroup === 'probes') {
        return { kind: 'sync', calls: [], pull: false };
    }

    if (sourceRole === 'replicate') {
        return { kind: 'replication', calls: singleProfile('transfer', 4000, 0), pull: false };
    }

    if (sourceRole === 'emit') {
        return { kind: 'async', calls: singleProfile('consume', 0, 2000), pull: true };
    }

    if (targetGroup === 'messaging') {
        return { kind: 'async', calls: singleProfile('publish', 2000, 0), pull: false };
    }

    if (targetGroup === 'observability') {
        return { kind: 'async', calls: singleProfile('transfer', 400, 0), pull: false };
    }

    return { kind: 'sync', calls: readWriteProfiles(targetType), pull: false };
}

export interface EdgeEndpoints {
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    sourceType: ComponentTypeId;
    targetType: ComponentTypeId;
}

export function createDefaultEdge(endpoints: EdgeEndpoints): SchemeEdge {
    const { kind, calls, pull } = shapeFor(endpoints.sourceType, endpoints.sourceHandle, endpoints.targetType);

    return {
        id: nextId('edge'),
        source: endpoints.source,
        target: endpoints.target,
        sourceHandle: endpoints.sourceHandle,
        targetHandle: endpoints.targetHandle,
        kind,
        calls,
        policy: { ...DEFAULT_POLICY },
        pull,
        weight: 1,
    };
}

export function applySourcePayload(edge: SchemeEdge, sourceParams: ComponentParams): SchemeEdge {
    const requestKb = sourceParams.avgRequestKb;
    const responseKb = sourceParams.avgResponseKb;

    if (typeof requestKb !== 'number' || typeof responseKb !== 'number') return edge;

    return {
        ...edge,
        calls: edge.calls.map((call) => ({
            ...call,
            requestBytes: requestKb * 1000,
            responseBytes: responseKb * 1000,
        })),
    };
}
