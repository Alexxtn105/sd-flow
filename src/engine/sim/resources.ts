import type {
    CacheProfile,
    CapacityResult,
    ComponentModel,
    ComponentParams,
    CostBreakdown,
    CostContext,
    Explain,
    NodeContext,
    ResourceLimit,
    StorageContext,
    StorageResult,
} from '../types/component';

const MIN_POSITIVE = 1e-9;

export const UNBOUNDED = Number.POSITIVE_INFINITY;

function positive(value: number): number {
    return value > MIN_POSITIVE ? value : MIN_POSITIVE;
}

export function resourceLimit(
    resource: string,
    value: number,
    formula: string,
    inputs: Record<string, number | string>,
    unit = 'rps',
): ResourceLimit {
    return { resource, value, explain: { formula, inputs, result: value, unit } };
}

export function littleLaw(resource: string, servers: number, serviceSec: number): ResourceLimit {
    return resourceLimit(
        resource,
        servers / positive(serviceSec),
        'servers / S',
        { servers, S: serviceSec },
    );
}

export function explicitRps(resource: string, instances: number, rpsPerInstance: number): ResourceLimit {
    return resourceLimit(
        resource,
        instances * rpsPerInstance,
        'instances × rpsPerInstance',
        { instances, rpsPerInstance },
    );
}

export function connectionBound(
    resource: string,
    maxConnections: number,
    connectionsPerRequest: number,
    serviceSec: number,
): ResourceLimit {
    return resourceLimit(
        resource,
        maxConnections / positive(connectionsPerRequest) / positive(serviceSec),
        'maxConnections / connectionsPerRequest / S',
        { maxConnections, connectionsPerRequest, S: serviceSec },
    );
}

export function weightedUnitBound(
    resource: string,
    formula: string,
    inputs: Record<string, number | string>,
    readCost: number,
    writeCost: number,
    readShare: number,
    writeShare: number,
): ResourceLimit {
    const weighted = readShare * readCost + writeShare * writeCost;
    return resourceLimit(resource, 1 / positive(weighted), formula, inputs);
}

export function iopsBound(
    resource: string,
    provisionedIops: number,
    iopsPerRead: number,
    iopsPerWrite: number,
    readShare: number,
    writeShare: number,
): ResourceLimit {
    return weightedUnitBound(
        resource,
        'provisionedIops / (readShare × iopsPerRead + writeShare × iopsPerWrite)',
        { provisionedIops, iopsPerRead, iopsPerWrite, readShare, writeShare },
        iopsPerRead / positive(provisionedIops),
        iopsPerWrite / positive(provisionedIops),
        readShare,
        writeShare,
    );
}

export function vendorUnitBound(
    resource: string,
    readUnits: number,
    writeUnits: number,
    unitsPerRead: number,
    unitsPerWrite: number,
    readShare: number,
    writeShare: number,
): ResourceLimit {
    return weightedUnitBound(
        resource,
        '1 / (readShare × unitsPerRead / rcu + writeShare × unitsPerWrite / wcu)',
        { rcu: readUnits, wcu: writeUnits, unitsPerRead, unitsPerWrite, readShare, writeShare },
        unitsPerRead / positive(readUnits),
        unitsPerWrite / positive(writeUnits),
        readShare,
        writeShare,
    );
}

export function bandwidthBound(resource: string, mbps: number, bytesPerRequest: number): ResourceLimit {
    return resourceLimit(
        resource,
        (mbps * 1e6) / 8 / positive(bytesPerRequest),
        'networkMbps × 10⁶ / 8 / bytesPerRequest',
        { networkMbps: mbps, bytesPerRequest },
    );
}

export function partitionBound(resource: string, partitions: number, rpsPerPartition: number): ResourceLimit {
    return resourceLimit(
        resource,
        partitions * rpsPerPartition,
        'partitions × rpsPerPartition',
        { partitions, rpsPerPartition },
    );
}

export function quotaBound(resource: string, quotaRps: number): ResourceLimit {
    return resourceLimit(resource, quotaRps, 'quotaRps', { quotaRps });
}

export function memoryResidencyBound(
    resource: string,
    memoryGb: number,
    memoryPerRequestGb: number,
): ResourceLimit {
    return resourceLimit(
        resource,
        memoryGb / positive(memoryPerRequestGb),
        'memoryGb / memoryPerRequestGb',
        { memoryGb, memoryPerRequestGb },
    );
}

export function combineLimits(limits: (ResourceLimit | null)[]): CapacityResult {
    const present = limits.filter((item): item is ResourceLimit => item !== null && Number.isFinite(item.value));

    if (present.length === 0) {
        return {
            limits: [],
            capacity: UNBOUNDED,
            boundBy: 'unbounded',
        };
    }

    let tightest = present[0];
    for (const item of present) {
        if (item.value < tightest.value) tightest = item;
    }

    return { limits: present, capacity: tightest.value, boundBy: tightest.resource };
}

export interface ModelSpec<P extends ComponentParams> {
    serviceSec: (ctx: NodeContext<P>) => number;
    resources: (ctx: NodeContext<P>) => (ResourceLimit | null)[];
    autoscale?: (ctx: NodeContext<P>) => number;
    cost?: (ctx: CostContext<P>) => CostBreakdown;
    storage?: (ctx: StorageContext<P>) => StorageResult;
    availability?: (params: P) => number;
    quorum?: (params: P) => number;
    cache?: (ctx: NodeContext<P>) => CacheProfile;
}

export function defineModel<P extends ComponentParams>(spec: ModelSpec<P>): ComponentModel<P> {
    return {
        serviceSec: spec.serviceSec,
        capacity: (ctx) => combineLimits(spec.resources(ctx)),
        ...(spec.autoscale ? { autoscale: spec.autoscale } : {}),
        ...(spec.cost ? { cost: spec.cost } : {}),
        ...(spec.storage ? { storage: spec.storage } : {}),
        ...(spec.availability ? { availability: spec.availability } : {}),
        ...(spec.quorum ? { quorum: spec.quorum } : {}),
        ...(spec.cache ? { cache: spec.cache } : {}),
    };
}

export function emptyCost(): CostBreakdown {
    return { compute: 0, storage: 0, network: 0, requests: 0, total: 0 };
}

export function totalCost(parts: Omit<CostBreakdown, 'total'>): CostBreakdown {
    return { ...parts, total: parts.compute + parts.storage + parts.network + parts.requests };
}

export function explain(
    formula: string,
    inputs: Record<string, number | string>,
    result: number,
    unit: string,
): Explain {
    return { formula, inputs, result, unit };
}
