import { ARRIVAL_VARIABILITY } from './constants';
import type { CompiledTopology } from './compile';
import type { Flow } from './flows';
import { peakMultiplier } from './flows';

export type ScenarioId =
    | 'baseline'
    | 'peak'
    | 'az-failure'
    | 'region-failure'
    | 'cache-flush'
    | 'stale-read'
    | 'write-conflict';

export const SCENARIOS: ScenarioId[] = [
    'baseline',
    'peak',
    'az-failure',
    'region-failure',
    'cache-flush',
    'stale-read',
    'write-conflict',
];

export interface ScenarioSetup {
    id: ScenarioId;
    trafficMultiplier: number;
    arrivalVariability: number;
    disabledNodes: Set<string>;
    cacheDisabled: boolean;
    replicationLagMultiplier: number;
    forceMultiMaster: boolean;
}

function nodesInsideContainer(topology: CompiledTopology, containerId: string): Set<string> {
    const disabled = new Set<string>([containerId]);

    for (const node of topology.nodes) {
        if (node.azId === containerId || node.regionId === containerId) disabled.add(node.id);
    }

    return disabled;
}

function firstContainerOf(topology: CompiledTopology, type: 'az' | 'region'): string | null {
    const container = topology.nodes.find((node) => node.type === type);
    return container ? container.id : null;
}

export function buildScenario(topology: CompiledTopology, id: string): ScenarioSetup {
    const scenario = (SCENARIOS.includes(id as ScenarioId) ? id : 'baseline') as ScenarioId;

    const setup: ScenarioSetup = {
        id: scenario,
        trafficMultiplier: 1,
        arrivalVariability: ARRIVAL_VARIABILITY[scenario] ?? 1,
        disabledNodes: new Set<string>(),
        cacheDisabled: false,
        replicationLagMultiplier: 1,
        forceMultiMaster: false,
    };

    if (scenario === 'peak') {
        setup.trafficMultiplier = peakMultiplier(topology);
        return setup;
    }

    if (scenario === 'az-failure') {
        const az = firstContainerOf(topology, 'az');
        if (az) setup.disabledNodes = nodesInsideContainer(topology, az);
        return setup;
    }

    if (scenario === 'region-failure') {
        const region = firstContainerOf(topology, 'region');
        if (region) setup.disabledNodes = nodesInsideContainer(topology, region);
        return setup;
    }

    if (scenario === 'cache-flush') {
        setup.cacheDisabled = true;
        return setup;
    }

    if (scenario === 'stale-read') {
        setup.replicationLagMultiplier = 10;
        return setup;
    }

    if (scenario === 'write-conflict') {
        setup.forceMultiMaster = true;
        return setup;
    }

    return setup;
}

export function applyScenarioToFlows(flows: Flow[], setup: ScenarioSetup): Flow[] {
    if (setup.trafficMultiplier === 1) return flows;

    return flows.map((flow) => ({ ...flow, rps: flow.rps * setup.trafficMultiplier }));
}
