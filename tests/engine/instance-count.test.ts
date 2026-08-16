import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { DEFAULT_PRICING } from '../../src/engine/sim/constants';
import type { ComponentDefinition, ComponentParams, CostBreakdown } from '../../src/engine/types/component';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const HOURLY_PRICE = /^costPer(Instance|Node|Gateway|Core|Broker)Hour$/;

const COUNT_PARAMS = [
    'instances',
    'nodes',
    'brokers',
    'workers',
    'regionServers',
    'replicaSetSize',
    'shardCount',
    'shards',
    'gateways',
    'cores',
    'readReplicas',
    'replicationFactor',
    'anycastPops',
    'popCount',
];

function hourlyPriceOf(defaults: ComponentParams): string | undefined {
    return Object.keys(defaults).find((key) => HOURLY_PRICE.test(key));
}

function countParamOf(defaults: ComponentParams): string | undefined {
    return COUNT_PARAMS.find((key) => typeof defaults[key] === 'number');
}

function costOf(definition: ComponentDefinition, params: ComponentParams, instances: number): CostBreakdown {
    return definition.model!.cost!({
        nodeId: 'node',
        params,
        instances,
        lambda: 1000,
        readShare: 0.8,
        writeShare: 0.2,
        requestBytes: 500,
        responseBytes: 2000,
        blockingSec: 0,
        pricing: DEFAULT_PRICING,
        storageGb: 100,
        egressGbMonth: 0,
        regionCostMultiplier: 1,
    });
}

const INSTANCE_FREE_BOUNDS = new Set([
    'rate-limit',
    'counter-store',
    'partitions',
    'lock-serialization',
    'ops',
    'state-transitions',
]);

function boundOf(definition: ComponentDefinition, defaults: ComponentParams, instances: number): string {
    return definition.model!.capacity({
        nodeId: 'node',
        params: { ...defaults, instances },
        instances,
        lambda: 1000,
        readShare: 0.8,
        writeShare: 0.2,
        requestBytes: 500,
        responseBytes: 2000,
        blockingSec: 0,
    }).boundBy;
}

function capacityOf(definition: ComponentDefinition, defaults: ComponentParams, instances: number): number {
    return definition.model!.capacity({
        nodeId: 'node',
        params: { ...defaults, instances },
        instances,
        lambda: 1000,
        readShare: 0.8,
        writeShare: 0.2,
        requestBytes: 500,
        responseBytes: 2000,
        blockingSec: 0,
    }).capacity;
}

describe('число единиц у блоков', () => {
    it('блок с почасовой ценой объявляет, сколько его, и платит за каждую единицу', () => {
        const priced = registry
            .list()
            .filter((definition) => definition.shape === 'node' && definition.model?.cost)
            .filter((definition) => hourlyPriceOf(registry.getDefaultParams(definition.id)) !== undefined);

        expect(priced.length).toBeGreaterThan(50);

        const silent: string[] = [];
        const free: string[] = [];

        for (const definition of priced) {
            const defaults = registry.getDefaultParams(definition.id);
            const countParam = countParamOf(defaults);

            if (!countParam) {
                silent.push(definition.id);
                continue;
            }

            const current = Number(defaults[countParam]);
            const instances = Number(defaults.instances ?? 1);
            const base = costOf(definition, defaults, instances);
            const grown = costOf(
                definition,
                { ...defaults, [countParam]: current + 1 },
                countParam === 'instances' ? instances + 1 : instances,
            );

            if (grown.compute <= base.compute) free.push(`${definition.id}/${countParam}`);
        }

        expect(silent).toEqual([]);
        expect(free).toEqual([]);
    });

    it('блок с числом инстансов масштабирует ёмкость или честно упирается в другое', () => {
        const unexplained: string[] = [];

        for (const definition of registry.list()) {
            const defaults = registry.getDefaultParams(definition.id);
            if (definition.shape !== 'node' || !definition.model) continue;
            if (typeof defaults.instances !== 'number') continue;

            if (capacityOf(definition, defaults, 2) > capacityOf(definition, defaults, 1)) continue;

            const bound = boundOf(definition, defaults, 2);
            if (!INSTANCE_FREE_BOUNDS.has(bound)) unexplained.push(`${definition.id}/${bound}`);
        }

        expect(unexplained).toEqual([]);
    });
});
