import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { costDrivers } from '../../src/engine/sim/costDrivers';
import { simulate } from '../../src/engine/sim/simulate';
import { buildScheme } from '../helpers/scheme';
import type { SchemeSpec } from '../helpers/scheme';
import type { ComponentDefinition, ComponentParams } from '../../src/engine/types/component';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 20;

const PRICE = /^costPer/;

const FLEET_PARAMS = [
    'instances',
    'nodes',
    'shards',
    'readReplicas',
    'replicas',
    'consumerGroups',
    'popCount',
    'gpuCount',
    'brokers',
    'workers',
    'regionServers',
    'publicIps',
    'provisionedConcurrency',
    'parallelism',
    'gateways',
    'bookies',
    'anycastPops',
];

const FREE_CAPACITY_BY_DESIGN: Record<string, string> = {
    'cdn/popCount': 'managed: ёмкость точек присутствия входит в тариф за запрос и гигабайт',
    'edge-function/popCount': 'managed: ёмкость точек присутствия входит в тариф за запрос и CPU-мс',
    'ml-inference/gpuCount': 'размер машины: ускорители сидят в costPerInstanceHour, как cpuCores',
    'stream-processor/parallelism': 'раскладка задач по оплаченным инстансам, ускоряет только чекпоинт',
};

const FREE_BY_DESIGN = new Set(['local-cache']);

function specFor(type: string, params: ComponentParams | undefined, direct: boolean): SchemeSpec {
    const block = { id: 'block', type, ...(params ? { params } : {}) };

    if (direct) {
        return {
            nodes: [{ id: 'client', type: 'client-web' }, block],
            links: [{ from: 'client', to: 'block' }],
        };
    }

    return {
        nodes: [{ id: 'client', type: 'client-web' }, { id: 'api', type: 'service' }, block],
        links: [
            { from: 'client', to: 'api' },
            { from: 'api', to: 'block' },
        ],
    };
}

interface Reading {
    capacity: number;
    cost: number;
}

function read(type: string, params: ComponentParams | undefined, direct: boolean): Reading | null {
    try {
        const node = simulate(buildScheme(specFor(type, params, direct)), { sampleCount: SAMPLES }).nodes.block;

        return node ? { capacity: node.capacity, cost: node.cost.total } : null;
    } catch {
        return null;
    }
}

function placed(type: string): boolean | null {
    if (read(type, undefined, true) !== null) return true;
    if (read(type, undefined, false) !== null) return false;

    return null;
}

function carriesTraffic(definition: ComponentDefinition): boolean {
    return definition.shape === 'node' && definition.model !== undefined;
}

function billed(definition: ComponentDefinition): boolean {
    return carriesTraffic(definition) && !FREE_BY_DESIGN.has(definition.id);
}

describe('что двигает счёт блока', () => {
    it('у каждого платного блока есть хотя бы один параметр, меняющий счёт', () => {
        const mute = registry
            .list()
            .filter(billed)
            .filter((definition) => costDrivers(definition).length === 0)
            .map((definition) => definition.id);

        expect(mute).toEqual([]);
    });

    it('каждый объявленный ценник числится среди этих параметров', () => {
        const missing: string[] = [];

        for (const definition of registry.list().filter(billed)) {
            const drivers = new Set(costDrivers(definition).map((driver) => driver.param));

            for (const [key, value] of Object.entries(registry.getDefaultParams(definition.id))) {
                if (!PRICE.test(key) || typeof value !== 'number' || value <= 0) continue;
                if (!drivers.has(key)) missing.push(`${definition.id}/${key}`);
            }
        }

        expect(missing).toEqual([]);
    });

    it('перечисленные параметры действительно есть у блока', () => {
        const ghosts: string[] = [];

        for (const definition of registry.list().filter(carriesTraffic)) {
            for (const driver of costDrivers(definition)) {
                if (!(driver.param in definition.paramSchema)) ghosts.push(`${definition.id}/${driver.param}`);
            }
        }

        expect(ghosts).toEqual([]);
    });

    it('число инстансов двигает счёт схемы у каждого блока, который его объявляет', () => {
        const free: string[] = [];

        for (const definition of registry.list().filter(billed)) {
            const instances = registry.getDefaultParams(definition.id).instances;
            if (typeof instances !== 'number') continue;

            const direct = placed(definition.id);
            if (direct === null) continue;

            const base = read(definition.id, undefined, direct);
            const grown = read(definition.id, { instances: instances * 2 }, direct);
            if (!base || !grown) continue;

            if (grown.cost <= base.cost) free.push(definition.id);
        }

        expect(free).toEqual([]);
    });

    it('купленная ёмкость не бывает бесплатной', () => {
        const free: string[] = [];

        for (const definition of registry.list().filter(billed)) {
            const direct = placed(definition.id);
            if (direct === null) continue;

            const defaults = registry.getDefaultParams(definition.id);
            const base = read(definition.id, undefined, direct);
            if (!base) continue;

            for (const key of FLEET_PARAMS) {
                const value = defaults[key];
                if (typeof value !== 'number' || value <= 0) continue;
                if (`${definition.id}/${key}` in FREE_CAPACITY_BY_DESIGN) continue;

                const grown = read(definition.id, { [key]: value * 2 }, direct);
                if (!grown) continue;

                if (grown.capacity > base.capacity && grown.cost <= base.cost) {
                    free.push(`${definition.id}/${key}`);
                }
            }
        }

        expect(free).toEqual([]);
    });

    it('исключения из этого правила описаны и настоящие', () => {
        const stale: string[] = [];

        for (const [path, reason] of Object.entries(FREE_CAPACITY_BY_DESIGN)) {
            const [type, key] = path.split('/');
            const definition = registry.get(type);
            expect(reason.length).toBeGreaterThan(20);

            if (!definition || !(key in definition.paramSchema)) {
                stale.push(path);
                continue;
            }

            const direct = placed(type);
            if (direct === null) continue;

            const value = registry.getDefaultParams(type)[key];
            if (typeof value !== 'number') continue;

            const base = read(type, undefined, direct);
            const grown = read(type, { [key]: value * 2 }, direct);
            if (!base || !grown) continue;

            if (grown.cost > base.cost) stale.push(path);
        }

        expect(stale).toEqual([]);
    });
});
