import type { ComponentDefinition, ComponentParams, PortSpec } from '../types/component';
import { HOURS_PER_MONTH, SECONDS_PER_DAY } from '../sim/constants';
import { connectionBound, defineModel, explain, iopsBound, littleLaw, totalCost } from '../sim/resources';
import { bool, choice, defineComponent, num } from './_shared/params';

const SQL_PORTS: PortSpec = {
    in: [{ id: 'sql', protocols: ['sql'], role: 'serve' }],
    out: [
        { id: 'replication', protocols: ['sql'], role: 'replicate' },
        { id: 'cdc', protocols: ['kafka'], role: 'emit' },
        { id: 'backup', protocols: ['s3'], role: 'call' },
    ],
};

const CONSISTENCY_MODEL = [
    'linearizable',
    'sequential',
    'bounded-staleness',
    'read-your-writes',
    'monotonic',
    'eventual',
];

const REPLICATION_MODE = ['sync', 'semi-sync', 'async'];

const CONCURRENCY_CONTROL = ['none', 'optimistic', 'pessimistic', 'crdt'];

const CONFLICT_RESOLUTION = ['lww', 'vector-clock', 'crdt', 'single-writer-per-key', 'manual'];

const ISOLATION_LEVEL = [
    'read-uncommitted',
    'read-committed',
    'repeatable-read',
    'snapshot',
    'serializable',
];

const QUERY_PROFILE = ['point-read', 'range-scan', 'join', 'aggregate', 'full-scan'];

const CONNECTION_POOLER = ['none', 'pgbouncer-transaction', 'pgbouncer-session', 'proxy-managed'];

const POOLER_MULTIPLIER: Record<string, number> = {
    none: 1,
    'pgbouncer-transaction': 10,
    'pgbouncer-session': 2,
    'proxy-managed': 5,
};

interface RelationalParams extends ComponentParams {
    readReplicas: number;
    shardCount: number;
    maxConnections: number;
    connectionPooler: string;
    connectionsPerQuery: number;
    cpuCores: number;
    provisionedIops: number;
    iopsPerRead: number;
    iopsPerWrite: number;
    rowSizeBytes: number;
    rowCount: number;
    indexOverhead: number;
    readServiceMs: number;
    writeServiceMs: number;
    readFromReplica: number;
    availability: number;
    costPerInstanceHour: number;
    costPerGbMonth: number;
}

function weightedServiceSec(params: RelationalParams, readShare: number, writeShare: number): number {
    return (readShare * params.readServiceMs + writeShare * params.writeServiceMs) / 1000;
}

function replicationFactor(params: RelationalParams): number {
    return 1 + params.readReplicas;
}

function relationalModel<P extends RelationalParams>() {
    return defineModel<P>({
        serviceSec: (ctx) => weightedServiceSec(ctx.params, ctx.readShare, ctx.writeShare),
        resources: (ctx) => {
            const serviceSec = weightedServiceSec(ctx.params, ctx.readShare, ctx.writeShare);
            const readCapacityFactor = 1 + ctx.params.readReplicas * ctx.params.readFromReplica;
            const pooler = POOLER_MULTIPLIER[ctx.params.connectionPooler] ?? 1;

            return [
                littleLaw(
                    'cpu',
                    ctx.params.cpuCores * ctx.params.shardCount * readCapacityFactor,
                    serviceSec,
                ),
                connectionBound(
                    'connections',
                    ctx.params.maxConnections * ctx.params.shardCount * pooler,
                    ctx.params.connectionsPerQuery,
                    serviceSec,
                ),
                iopsBound(
                    'iops',
                    ctx.params.provisionedIops * ctx.params.shardCount,
                    ctx.params.iopsPerRead,
                    ctx.params.iopsPerWrite,
                    ctx.readShare,
                    ctx.writeShare,
                ),
            ];
        },
        storage: (ctx) => {
            const factor = replicationFactor(ctx.params);
            const bytesPerRow = ctx.params.rowSizeBytes * (1 + ctx.params.indexOverhead);
            const growthGbDay = (ctx.writeRps * SECONDS_PER_DAY * bytesPerRow * factor) / 1e9;
            const baseGb = (ctx.params.rowCount * bytesPerRow * factor) / 1e9;

            return {
                totalGb: baseGb + growthGbDay * ctx.horizonDays,
                growthGbDay,
                memoryGb: 0,
                explain: [
                    explain(
                        'rowCount × rowSize × (1 + indexOverhead) × RF / 10⁹',
                        {
                            rowCount: ctx.params.rowCount,
                            rowSize: ctx.params.rowSizeBytes,
                            indexOverhead: ctx.params.indexOverhead,
                            RF: factor,
                        },
                        baseGb,
                        'gb',
                    ),
                    explain(
                        'writeRps × 86400 × rowSize × (1 + indexOverhead) × RF / 10⁹',
                        {
                            writeRps: ctx.writeRps,
                            rowSize: ctx.params.rowSizeBytes,
                            indexOverhead: ctx.params.indexOverhead,
                            RF: factor,
                        },
                        growthGbDay,
                        'gb/day',
                    ),
                ],
            };
        },
        cost: (ctx) => {
            const nodes = replicationFactor(ctx.params) * ctx.params.shardCount;
            return totalCost({
                compute: nodes * ctx.params.costPerInstanceHour * HOURS_PER_MONTH * ctx.regionCostMultiplier,
                storage: ctx.storageGb * ctx.params.costPerGbMonth,
                network: 0,
                requests: 0,
            });
        },
        availability: (params) => params.availability,
    });
}

const postgresDefaults = {
    readReplicas: 2,
    shardCount: 1,
    maxConnections: 200,
    connectionPooler: 'none',
    connectionsPerQuery: 1,
    cpuCores: 8,
    bufferPoolGb: 8,
    storageGb: 500,
    provisionedIops: 12000,
    iopsPerRead: 1,
    iopsPerWrite: 4,
    rowSizeBytes: 400,
    rowCount: 200000000,
    indexOverhead: 0.4,
    workingSetGb: 20,
    queryProfile: 'point-read',
    readServiceMs: 0.8,
    writeServiceMs: 2.5,
    consistencyModel: 'linearizable',
    replicationMode: 'async',
    replicaLagMs: 200,
    replicaLagSigma: 0.8,
    readFromReplica: 0.3,
    concurrencyControl: 'pessimistic',
    isolationLevel: 'read-committed',
    conflictResolution: 'single-writer-per-key',
    multiAz: true,
    failoverSec: 45,
    availability: 0.9995,
    costPerInstanceHour: 0.65,
    costPerGbMonth: 0.115,
};

const RELATIONAL_SCHEMA = {
    readReplicas: num('topology', { min: 0, max: 30 }),
    shardCount: num('topology', { min: 1, max: 4096 }),
    maxConnections: num('capacity', { min: 10, max: 20000, realistic: { min: 100, max: 1000 } }),
    connectionPooler: choice('capacity', CONNECTION_POOLER),
    connectionsPerQuery: num('capacity', { min: 0.01, max: 10, step: 0.01 }),
    cpuCores: num('capacity', { min: 1, max: 192 }),
    bufferPoolGb: num('capacity', { unitKey: 'gb', min: 0.25, max: 4096, step: 0.25 }),
    storageGb: num('capacity', { unitKey: 'gb', min: 1, max: 1000000 }),
    provisionedIops: num('capacity', { min: 100, max: 1000000 }),
    iopsPerRead: num('capacity', { min: 0.1, max: 100, step: 0.1 }),
    iopsPerWrite: num('capacity', { min: 0.1, max: 100, step: 0.1, realistic: { min: 3, max: 8 } }),
    rowSizeBytes: num('data', { unitKey: 'bytes', min: 10, max: 1000000 }),
    rowCount: num('data', { min: 0, max: 1000000000000 }),
    indexOverhead: num('data', { min: 0, max: 3, step: 0.1, realistic: { min: 0.2, max: 1 } }),
    workingSetGb: num('data', { unitKey: 'gb', min: 0.1, max: 100000, step: 0.1 }),
    queryProfile: choice('performance', QUERY_PROFILE),
    readServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
    writeServiceMs: num('performance', { unitKey: 'ms', min: 0.05, max: 60000, step: 0.05 }),
    consistencyModel: choice('consistency', CONSISTENCY_MODEL),
    replicationMode: choice('consistency', REPLICATION_MODE),
    replicaLagMs: num('consistency', { unitKey: 'ms', min: 0, max: 600000, realistic: { min: 50, max: 2000 } }),
    replicaLagSigma: num('consistency', { min: 0.1, max: 3, step: 0.1 }),
    readFromReplica: num('consistency', { min: 0, max: 1, step: 0.05 }),
    concurrencyControl: choice('consistency', CONCURRENCY_CONTROL),
    isolationLevel: choice('consistency', ISOLATION_LEVEL),
    conflictResolution: choice('consistency', CONFLICT_RESOLUTION),
    multiAz: bool('reliability'),
    failoverSec: num('reliability', { unitKey: 'sec', min: 1, max: 3600, realistic: { min: 15, max: 120 } }),
    availability: num('reliability', { min: 0.9, max: 0.99999, step: 0.0001 }),
    costPerInstanceHour: num('cost', { unitKey: 'usd', min: 0, max: 1000, step: 0.001 }),
    costPerGbMonth: num('cost', { unitKey: 'usd', min: 0, max: 10, step: 0.001 }),
};

const postgres = defineComponent({
    id: 'postgres',
    group: 'sql',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-sql',
    ports: SQL_PORTS,
    defaultParams: postgresDefaults,
    paramSchema: RELATIONAL_SCHEMA,
    model: relationalModel<typeof postgresDefaults>(),
    helpId: 'postgres',
});

const mysqlDefaults = {
    ...postgresDefaults,
    maxConnections: 500,
    bufferPoolGb: 24,
    iopsPerWrite: 3,
    rowSizeBytes: 300,
    rowCount: 300000000,
    indexOverhead: 0.35,
    workingSetGb: 24,
    readServiceMs: 0.6,
    writeServiceMs: 2,
    replicationMode: 'semi-sync',
    replicaLagMs: 500,
    readFromReplica: 0.4,
    isolationLevel: 'repeatable-read',
    failoverSec: 60,
    costPerInstanceHour: 0.58,
};

const mysql = defineComponent({
    id: 'mysql',
    group: 'sql',
    shape: 'node',
    wave: 'mvp',
    icon: 'sd-sql',
    ports: SQL_PORTS,
    defaultParams: mysqlDefaults,
    paramSchema: RELATIONAL_SCHEMA,
    model: relationalModel<typeof mysqlDefaults>(),
    helpId: 'mysql',
});

export const sqlComponents: ComponentDefinition[] = [postgres, mysql] as unknown as ComponentDefinition[];
