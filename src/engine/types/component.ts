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

export interface NodeContext<P extends ComponentParams = ComponentParams> {
    nodeId: string;
    params: P;
}

export interface ComponentModel<P extends ComponentParams = ComponentParams> {
    capacity(ctx: NodeContext<P>): CapacityResult;
    cost(ctx: NodeContext<P>): CostBreakdown;
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
    model?: ComponentModel<P>;
}

export interface GroupWithComponents {
    id: GroupId;
    components: ComponentDefinition[];
}
