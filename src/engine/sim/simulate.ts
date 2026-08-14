import { MODEL_VERSION } from '../types/scheme';
import type { SchemeV1 } from '../types/scheme';
import { computeAvailability } from './availability';
import { compileTopology } from './compile';
import { pricingFor } from './constants';
import { analyseConsistency } from './consistency';
import { computeCost } from './cost';
import { deriveNodes } from './derived';
import { applyScenarioToFlows, buildScenario } from './scenarios';
import { buildFindings } from './findings';
import { deriveFlows } from './flows';
import { rollUpLatency } from './latency';
import { analyseMultiRegion } from './multiRegion';
import { createRng, hashString } from './rng';
import { solveFlows } from './solver';
import { emptyCost } from './resources';
import type { EdgeResult, NodeResult, SimResult, Totals } from './types';

export const DEFAULT_SAMPLE_COUNT = 20000;
export const PREVIEW_SAMPLE_COUNT = 4000;

export interface SimulateOptions {
    sampleCount?: number;
    scenario?: string;
}

function seedFor(scheme: SchemeV1, scenario: string): number {
    const signature = scheme.nodes
        .map((node) => `${node.id}:${node.type}:${JSON.stringify(node.params)}`)
        .concat(scheme.edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}:${edge.kind}`))
        .join('|');

    return hashString(`${signature}|${scenario}|${MODEL_VERSION}`) ^ (scheme.settings.seed >>> 0);
}

export function simulate(scheme: SchemeV1, options: SimulateOptions = {}): SimResult {
    const scenarioId = options.scenario ?? scheme.settings.scenario;
    const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;

    const topology = compileTopology(scheme);
    const setup = buildScenario(topology, scenarioId);

    if (setup.replicationLagMultiplier !== 1) {
        for (const node of topology.nodes) {
            const lag = node.params.replicaLagMs;
            if (typeof lag === 'number') node.params.replicaLagMs = lag * setup.replicationLagMultiplier;
        }
    }

    if (setup.forceMultiMaster && topology.multiRegionPolicy) {
        topology.multiRegionPolicy.params.mode = 'active-active';
        topology.multiRegionPolicy.params.replicationDirection = 'bidirectional';
    }

    const flows = applyScenarioToFlows(deriveFlows(topology, 1), setup);
    const solved = solveFlows(topology, flows, setup.arrivalVariability, setup.disabledNodes, !setup.cacheDisabled);

    const pricing = pricingFor(scheme.settings.pricingProfile);
    const derived = deriveNodes(topology, solved.nodes, solved.edges);
    const cost = computeCost(topology, solved.nodes, derived, solved.edges, pricing);
    const availability = computeAvailability(topology, solved.nodes);
    const consistency = analyseConsistency(topology, solved.nodes, solved.edges, scheme.settings.consistencyModel);
    const multiRegion = analyseMultiRegion(topology, solved.nodes, solved.edges, pricing, cost.byNode);

    const seed = seedFor(scheme, scenarioId);
    const rng = createRng(seed);
    const flowResults = rollUpLatency(topology, flows, solved.nodes, rng, sampleCount);

    const findings = buildFindings({
        topology,
        runtimes: solved.nodes,
        edgeFlows: solved.edges,
        availability,
        consistency,
        cost,
        converged: solved.converged,
    });

    const nodes: Record<string, NodeResult> = {};
    let storageGb = 0;
    let growthGbDay = 0;
    let egressGbDay = 0;
    let logsGbDay = 0;

    for (const node of topology.nodes) {
        if (node.definition.shape !== 'node') continue;

        const runtime = solved.nodes.get(node.id);
        if (!runtime) continue;

        const nodeDerived = derived.get(node.id) ?? null;
        storageGb += nodeDerived?.storage?.totalGb ?? 0;
        growthGbDay += nodeDerived?.storage?.growthGbDay ?? 0;
        egressGbDay += nodeDerived?.egressGbDay ?? 0;
        logsGbDay += nodeDerived?.logsGbDay ?? 0;

        nodes[node.id] = {
            nodeId: node.id,
            componentType: node.type,
            regionId: node.regionId,
            azId: node.azId,
            lambdaNominal: runtime.lambdaNominal,
            lambdaOffered: runtime.lambdaOffered,
            throughput: runtime.throughput,
            readShare: runtime.readShare,
            writeShare: runtime.writeShare,
            capacity: runtime.capacity,
            boundBy: runtime.boundBy,
            limits: runtime.limits,
            utilization: runtime.queue.utilization,
            instances: runtime.instances,
            serviceSec: runtime.serviceSec,
            waitSec: runtime.queue.waitSec,
            queueDepth: runtime.queue.queueDepth,
            errorRate: runtime.queue.failureProbability,
            retryAmplification: runtime.retryAmplification,
            hitRatio: runtime.hitRatio,
            storage: nodeDerived?.storage ?? null,
            cost: cost.byNode.get(node.id) ?? emptyCost(),
            availability: availability.byNode.get(node.id) ?? 1,
            egressGbDay: nodeDerived?.egressGbDay ?? 0,
            logsGbDay: nodeDerived?.logsGbDay ?? 0,
        };
    }

    const edges: Record<string, EdgeResult> = {};
    let networkBytesPerSec = 0;

    for (const edge of topology.edges) {
        const flow = solved.edges.get(edge.id);
        const target = solved.nodes.get(edge.target);
        const bytesPerSec = flow?.bytesPerSec ?? 0;
        networkBytesPerSec += bytesPerSec;

        const consumerCapacity = target?.capacity ?? 0;
        const producerRps = flow?.total ?? 0;
        const backlogGrowth = edge.isAsync ? Math.max(0, producerRps - consumerCapacity) : 0;

        edges[edge.id] = {
            edgeId: edge.id,
            kind: edge.kind,
            rps: producerRps,
            byOperation: flow?.byOperation ?? {},
            bytesPerSec,
            networkMs: edge.networkMs,
            scope: edge.scope,
            retryShare: target?.retryAmplification ?? 0,
            backlog: backlogGrowth,
            lagSec: consumerCapacity > 0 && edge.isAsync ? producerRps / consumerCapacity : 0,
        };
    }

    const totalRps = flows.reduce((sum, flow) => sum + flow.rps, 0);
    const readRps = flows.reduce((sum, flow) => sum + flow.rps * flow.readShare, 0);

    const totals: Totals = {
        rps: totalRps,
        readRps,
        writeRps: totalRps - readRps,
        costMonth: cost.total.total,
        cost: cost.total,
        storageGb,
        growthGbDay,
        growthPbYear: (growthGbDay * 365) / 1e6,
        egressGbDay,
        logsGbDay,
        networkGbps: (networkBytesPerSec * 8) / 1e9,
        availability: availability.overall,
        errorBudgetMinutes: (1 - availability.overall) * 43200,
    };

    return {
        modelVersion: MODEL_VERSION,
        scenario: setup.id,
        seed,
        computeMs: 0,
        converged: solved.converged,
        iterations: solved.iterations,
        nodes,
        edges,
        flows: flowResults,
        totals,
        consistency,
        multiRegion,
        findings,
        issues: topology.issues,
    };
}
