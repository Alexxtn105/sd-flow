export type GroupId =
    | 'clients'
    | 'edge'
    | 'compute'
    | 'sql'
    | 'nosql'
    | 'search'
    | 'olap'
    | 'cache'
    | 'messaging'
    | 'storage'
    | 'platform'
    | 'observability'
    | 'topology'
    | 'probes';

export type ComponentTypeId = string;

export type Protocol =
    | 'http'
    | 'grpc'
    | 'ws'
    | 'dns'
    | 'sql'
    | 'nosql'
    | 'redis'
    | 'search'
    | 'olap'
    | 'kafka'
    | 'amqp'
    | 'sqs'
    | 's3'
    | 'stream'
    | 'telemetry'
    | 'internal';

export type PortRole = 'serve' | 'call' | 'replicate' | 'emit' | 'consume' | 'observe' | 'attach';

export interface PortDefinition {
    id: string;
    protocols: Protocol[];
    role: PortRole;
}

export interface PortSpec {
    in: PortDefinition[];
    out: PortDefinition[];
}

export type ComponentShape = 'node' | 'container' | 'policy' | 'probe' | 'link';

export type Wave = 'mvp' | 'v1' | 'v2';

export type ParamValue = number | string | boolean;

export type ComponentParams = Record<string, ParamValue>;

export type ParamSection =
    | 'scale'
    | 'performance'
    | 'capacity'
    | 'behaviour'
    | 'reliability'
    | 'data'
    | 'consistency'
    | 'topology'
    | 'cost';

export interface NumericRange {
    min: number;
    max: number;
}

interface ParamFieldBase {
    section: ParamSection;
    unitKey?: string;
}

export type ParamField =
    | (ParamFieldBase & {
          kind: 'number';
          min?: number;
          max?: number;
          step?: number;
          realistic?: NumericRange;
      })
    | (ParamFieldBase & { kind: 'boolean' })
    | (ParamFieldBase & { kind: 'enum'; options: string[] })
    | (ParamFieldBase & { kind: 'text' });

export type ParamSchema<P extends ComponentParams> = { [K in keyof P]: ParamField };

export interface Explain {
    formula: string;
    inputs: Record<string, number | string>;
    result: number;
    unit: string;
}

export interface ResourceLimit {
    resource: string;
    value: number;
    explain: Explain;
}

export interface CapacityResult {
    limits: ResourceLimit[];
    capacity: number;
    boundBy: string;
}

export interface CostBreakdown {
    compute: number;
    storage: number;
    network: number;
    requests: number;
    total: number;
}

export interface StorageResult {
    totalGb: number;
    growthGbDay: number;
    memoryGb: number;
    explain: Explain[];
}

export interface CacheProfile {
    uniqueKeys: number;
    zipfAlpha: number;
    entryBytes: number;
    capacityBytes: number;
    ttlSec: number;
}

export interface PricingProfile {
    id: string;
    asOf: string;
    egressPerGb: number;
    crossAzPerGb: number;
    crossRegionPerGb: number;
    requestsPerMillion: number;
    iopsPerMonth: number;
    managedMultiplier: number;
}

export interface NodeContext<P extends ComponentParams = ComponentParams> {
    nodeId: string;
    params: P;
    instances: number;
    lambda: number;
    readShare: number;
    writeShare: number;
    requestBytes: number;
    responseBytes: number;
    blockingSec: number;
}

export interface CostContext<P extends ComponentParams = ComponentParams> extends NodeContext<P> {
    pricing: PricingProfile;
    storageGb: number;
    egressGbMonth: number;
    regionCostMultiplier: number;
}

export interface StorageContext<P extends ComponentParams = ComponentParams> extends NodeContext<P> {
    writeRps: number;
    recordBytes: number;
    horizonDays: number;
}

export interface ComponentModel<P extends ComponentParams = ComponentParams> {
    serviceSec(ctx: NodeContext<P>): number;
    capacity(ctx: NodeContext<P>): CapacityResult;
    autoscale?(ctx: NodeContext<P>): number;
    cost?(ctx: CostContext<P>): CostBreakdown;
    storage?(ctx: StorageContext<P>): StorageResult;
    availability?(params: P): number;
    quorum?(params: P): number;
    cache?(ctx: NodeContext<P>): CacheProfile;
}

export interface ComponentDefinition<P extends ComponentParams = ComponentParams> {
    id: ComponentTypeId;
    group: GroupId;
    shape: ComponentShape;
    wave: Wave;
    icon: string;
    ports: PortSpec;
    defaultParams: P;
    paramSchema: ParamSchema<P>;
    helpId: string;
    managed?: boolean;
    model?: ComponentModel<P>;
}

export interface GroupWithComponents {
    id: GroupId;
    components: ComponentDefinition[];
}
