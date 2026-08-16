import type { SchemeV1 } from '../types/scheme';
import { compileTopology } from './compile';
import type { CompiledTopology } from './compile';
import { deriveFlows } from './flows';
import type { Flow } from './flows';
import { solveScheme } from './pipeline';
import { withoutProbes } from './probes';
import { applyScenarioToFlows, buildScenario } from './scenarios';
import type { ScenarioSetup } from './scenarios';
import type { SolveOptions } from './solver';
import type { CeilingResult } from './types';

const SATURATED = 1;
const MAX_MULTIPLIER = 4096;
const MIN_MULTIPLIER = 1 / 4096;
const BISECTION_STEPS = 12;

interface Probe {
    rps: number;
    utilization: number;
    nodeId: string | null;
    componentType: string;
    boundBy: string;
}

function totalRps(flows: Flow[]): number {
    return flows.reduce((sum, flow) => sum + flow.rps, 0);
}

function probeAt(
    topology: CompiledTopology,
    setup: ScenarioSetup,
    options: SolveOptions,
    multiplier: number,
): Probe {
    const flows = applyScenarioToFlows(deriveFlows(topology, multiplier), setup);
    const solved = solveScheme(topology, flows, options);

    let utilization = 0;
    let nodeId: string | null = null;
    let componentType = '';
    let boundBy = 'unbounded';

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;

        const runtime = solved.runtime.nodes.get(node.id);
        if (!runtime || runtime.queue.utilization <= utilization) continue;

        utilization = runtime.queue.utilization;
        nodeId = node.id;
        componentType = node.type;
        boundBy = runtime.boundBy;
    }

    return { rps: totalRps(flows), utilization, nodeId, componentType, boundBy };
}

export interface CeilingOptions {
    scenario?: string;
}

export function findCeiling(scheme: SchemeV1, options: CeilingOptions = {}): CeilingResult | null {
    const scenarioId = options.scenario ?? scheme.settings.scenario;
    const topology = compileTopology(withoutProbes(scheme));
    const setup = buildScenario(topology, scenarioId);

    const solveOptions: SolveOptions = {
        arrivalVariability: setup.arrivalVariability,
        disabledNodes: setup.disabledNodes,
        cacheEnabled: !setup.cacheDisabled,
        retryBudget: setup.retryBudget,
        payloadScale: setup.payloadScale,
        capacityScale: setup.capacityScale,
        serviceScale: setup.serviceScale,
    };

    const baseline = probeAt(topology, setup, solveOptions, 1);
    if (baseline.rps <= 0) return null;

    let low = baseline.utilization < SATURATED ? 1 : 0;
    let high = baseline.utilization < SATURATED ? 0 : 1;
    let limiter = baseline;

    if (high === 1) {
        let candidate = 0.5;

        while (candidate >= MIN_MULTIPLIER) {
            const probe = probeAt(topology, setup, solveOptions, candidate);
            if (probe.utilization < SATURATED) {
                low = candidate;
                break;
            }

            high = candidate;
            limiter = probe;
            candidate /= 2;
        }
    } else {
        let candidate = 2;

        while (candidate <= MAX_MULTIPLIER) {
            const probe = probeAt(topology, setup, solveOptions, candidate);
            if (probe.utilization >= SATURATED) {
                high = candidate;
                limiter = probe;
                break;
            }

            low = candidate;
            limiter = probe;
            candidate *= 2;
        }
    }

    if (high === 0) {
        return {
            scenario: setup.id,
            rps: baseline.rps * low,
            multiplier: low,
            baselineRps: baseline.rps,
            saturated: false,
            nodeId: limiter.nodeId,
            componentType: limiter.componentType,
            boundBy: limiter.boundBy,
            utilization: limiter.utilization,
        };
    }

    for (let step = 0; step < BISECTION_STEPS; step += 1) {
        const middle = (low + high) / 2;
        const probe = probeAt(topology, setup, solveOptions, middle);

        if (probe.utilization >= SATURATED) {
            high = middle;
            limiter = probe;
        } else {
            low = middle;
        }
    }

    return {
        scenario: setup.id,
        rps: baseline.rps * low,
        multiplier: low,
        baselineRps: baseline.rps,
        saturated: true,
        nodeId: limiter.nodeId,
        componentType: limiter.componentType,
        boundBy: limiter.boundBy,
        utilization: limiter.utilization,
    };
}
