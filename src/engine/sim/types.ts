import type { CallOperation, EdgeKind } from '../types/scheme';
import type { CostBreakdown, Explain, ResourceLimit, StorageResult } from '../types/component';

export type { StorageResult };

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
    code: string;
    severity: Severity;
    nodeIds: string[];
    edgeIds: string[];
    values: Record<string, string | number>;
}

export interface Finding extends Issue {
    id: string;
}

export interface LatencyQuantiles {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
}

export interface HopStat {
    nodeId: string;
    depth: number;
    shareOfRequests: number;
    serviceMs: number;
    waitMs: number;
    networkMs: number;
    contributionMs: number;
}

export interface FlowResult {
    id: string;
    entryNodeId: string;
    rps: number;
    readShare: number;
    latency: LatencyQuantiles;
    errorRate: number;
    availability: number;
    timeoutShare: number;
    hops: HopStat[];
    depth: number;
}

export type HopArm = 'sequential' | 'parallel';

export interface WaterfallHop {
    edgeId: string;
    nodeId: string;
    parentNodeId: string;
    depth: number;
    arm: HopArm;
    shareOfRequests: number;
    trafficShare: number;
    callsPerRequest: number;
    cacheMissShare: number | null;
    meanMs: number;
    serviceMs: number;
    waitMs: number;
    networkMs: number;
    retryMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
}

export interface FlowWaterfall {
    flowId: string;
    entryNodeId: string;
    total: LatencyQuantiles;
    covered: { p50: number; p95: number; p99: number };
    hops: WaterfallHop[];
}

export type ProbeStatus = 'ok' | 'warn' | 'breach' | 'no-data';

export type ProbeNoDataReason =
    | 'unattached'
    | 'unknown-target'
    | 'unsupported-target'
    | 'no-traffic'
    | 'no-flow';

export interface ProbeReading {
    probeId: string;
    componentType: string;
    targetNodeId: string | null;
    flowId: string | null;
    status: ProbeStatus;
    reason: ProbeNoDataReason | null;
    value: number;
    unit: string;
    explain: Explain;
}

export interface NodeResult {
    nodeId: string;
    componentType: string;
    regionId: string | null;
    azId: string | null;
    lambdaNominal: number;
    lambdaOffered: number;
    throughput: number;
    readShare: number;
    writeShare: number;
    capacity: number;
    boundBy: string;
    limits: ResourceLimit[];
    utilization: number;
    instances: number;
    serviceSec: number;
    waitSec: number;
    queueDepth: number;
    errorRate: number;
    retryAmplification: number;
    hitRatio: number | null;
    storage: StorageResult | null;
    cost: CostBreakdown;
    availability: number;
    egressGbDay: number;
    logsGbDay: number;
}

export interface EdgeResult {
    edgeId: string;
    kind: EdgeKind;
    rps: number;
    byOperation: Partial<Record<CallOperation, number>>;
    bytesPerSec: number;
    networkMs: number;
    scope: NetworkScope;
    retryShare: number;
    backlog: number;
    lagSec: number;
}

export type NetworkScope = 'local' | 'same-az' | 'cross-az' | 'cross-region' | 'internet';

export interface AnomalyRate {
    code: string;
    ratePerSec: number;
    shareOfOperations: number;
    nodeIds: string[];
    explain: Explain;
}

export interface ConsistencyResult {
    mode: 'off' | 'attribute' | 'anomalies';
    anomalies: AnomalyRate[];
}

export interface RegionResult {
    nodeId: string;
    code: string;
    geo: string;
    trafficShare: number;
    rps: number;
    costMonth: number;
    availability: number;
}

export interface MultiRegionResult {
    mode: string;
    regions: RegionResult[];
    replicationRps: number;
    replicationBytesPerSec: number;
    replicationCostMonth: number;
    rpoSec: number;
    rtoSec: number;
    rpoTargetSec: number;
    rtoTargetSec: number;
}

export interface Totals {
    rps: number;
    readRps: number;
    writeRps: number;
    costMonth: number;
    cost: CostBreakdown;
    storageGb: number;
    growthGbDay: number;
    growthPbYear: number;
    egressGbDay: number;
    logsGbDay: number;
    networkGbps: number;
    availability: number;
    errorBudgetMinutes: number;
}

export interface SimResult {
    modelVersion: string;
    scenario: string;
    seed: number;
    computeMs: number;
    converged: boolean;
    iterations: number;
    nodes: Record<string, NodeResult>;
    edges: Record<string, EdgeResult>;
    flows: FlowResult[];
    waterfalls: FlowWaterfall[];
    probes: Record<string, ProbeReading>;
    totals: Totals;
    consistency: ConsistencyResult;
    multiRegion: MultiRegionResult | null;
    findings: Finding[];
    issues: Issue[];
}
