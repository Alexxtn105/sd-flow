import type { ComponentParams, ComponentTypeId, Protocol } from './component';

export type CallOperation = 'read' | 'write' | 'delete' | 'scan' | 'publish' | 'consume' | 'transfer';

export type EdgeKind = 'sync' | 'async' | 'replication' | 'stream' | 'cdc' | 'batch';

export type Consistency = 'strong' | 'bounded' | 'eventual';

export type MixMode = 'inherit' | 'manual';

export interface CallProfile {
    id: string;
    op: CallOperation;
    share: number;
    fanout: number;
    requestBytes: number;
    responseBytes: number;
    consistency?: Consistency;
}

export interface EdgePolicy {
    timeoutMs: number;
    retries: number;
    circuitBreaker: boolean;
    idempotent: boolean;
}

export interface Position {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface SchemeNode {
    id: string;
    type: ComponentTypeId;
    position: Position;
    params: ComponentParams;
    label?: string;
    parentId?: string;
    size?: Size;
}

export interface SchemeEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    kind: EdgeKind;
    protocol?: Protocol;
    calls: CallProfile[];
    policy: EdgePolicy;
    label?: string;
    pull?: boolean;
    weight?: number;
    mixMode?: MixMode;
}

export interface SchemeSettings {
    pricingProfile: string;
    seed: number;
    scenario: string;
    units: 'si' | 'binary';
    consistencyModel: 'off' | 'attribute' | 'anomalies';
    modelDepth: 'learning' | 'standard' | 'expert';
}

export interface SchemeViewport {
    x: number;
    y: number;
    zoom: number;
}

export interface SchemeMeta {
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    challengeId?: string;
    author?: string;
    tags?: string[];
}

export interface SchemeV1 {
    version: 1;
    modelVersion: string;
    meta: SchemeMeta;
    nodes: SchemeNode[];
    edges: SchemeEdge[];
    settings: SchemeSettings;
    ui: { viewport: SchemeViewport; xray: boolean };
}

export const MODEL_VERSION = '0.1.0';

export const DEFAULT_SETTINGS: SchemeSettings = {
    pricingProfile: 'aws-2026-q2',
    seed: 1,
    scenario: 'baseline',
    units: 'si',
    consistencyModel: 'anomalies',
    modelDepth: 'standard',
};

export const DEFAULT_POLICY: EdgePolicy = {
    timeoutMs: 1000,
    retries: 0,
    circuitBreaker: false,
    idempotent: false,
};
