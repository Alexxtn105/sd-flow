import type { CompiledEdge, CompiledNode, CompiledTopology } from './compile';
import { GEO_ZONES, geoRttMs } from './constants';
import { zoneShares } from './flows';
import type { Flow } from './flows';

export interface RouteShare {
    read: number;
    write: number;
}

interface Branch {
    edgeId: string;
    regionId: string | null;
    geo: string | null;
    code: string;
    weight: number;
    primary: boolean;
    alive: boolean;
}

const LOCAL_MODES = new Set(['active-active', 'sharded-by-geo']);
const SINGLE_WRITER_MODES = new Set(['active-passive', 'read-local-write-global', 'single']);
const KEY_HOMED_MODE = 'sharded-by-geo';

function regionOf(topology: CompiledTopology, nodeId: string): CompiledNode | null {
    const node = topology.nodeById.get(nodeId);
    if (!node?.regionId) return null;

    return topology.nodeById.get(node.regionId) ?? null;
}

function branchesOf(
    node: CompiledNode,
    topology: CompiledTopology,
    disabledNodes: ReadonlySet<string>,
): Branch[] {
    const branches: Branch[] = [];

    for (const edgeId of node.outgoing) {
        const edge: CompiledEdge | undefined = topology.edgeById.get(edgeId);
        if (!edge || edge.isReplication) continue;

        const region = regionOf(topology, edge.target);

        branches.push({
            edgeId: edge.id,
            regionId: region?.id ?? null,
            geo: region ? String(region.params.geo ?? '') : null,
            code: region ? String(region.params.code ?? region.id) : '',
            weight: Math.max(edge.weight, 0),
            primary: region ? region.params.isPrimary === true : false,
            alive: !disabledNodes.has(edge.target) && (!region || !disabledNodes.has(region.id)),
        });
    }

    return branches;
}

function operationRps(flow: Flow, operation: 'read' | 'write' | 'all'): number {
    if (operation === 'read') return flow.rps * flow.readShare;
    if (operation === 'write') return flow.rps * (1 - flow.readShare);

    return flow.rps;
}

function clientZones(
    topology: CompiledTopology,
    flows: Flow[],
    nodeId: string,
    operation: 'read' | 'write' | 'all' = 'all',
): Map<string, number> {
    const zones = new Map<string, number>();

    for (const flow of flows) {
        if (!reaches(topology, flow.entryNodeId, nodeId)) continue;

        const rps = operationRps(flow, operation);

        for (const [zone, share] of zoneShares(flow.geo, flow.geoSpread)) {
            zones.set(zone, (zones.get(zone) ?? 0) + rps * share);
        }
    }

    if (zones.size === 0) for (const zone of GEO_ZONES) zones.set(zone, 1);

    return zones;
}

function reaches(topology: CompiledTopology, from: string, to: string): boolean {
    if (from === to) return true;

    const seen = new Set<string>([from]);
    const queue = [from];

    while (queue.length > 0) {
        const current = queue.shift() as string;
        const node = topology.nodeById.get(current);
        if (!node) continue;

        for (const edgeId of node.outgoing) {
            const edge = topology.edgeById.get(edgeId);
            if (!edge || edge.isReplication || seen.has(edge.target)) continue;
            if (edge.target === to) return true;

            seen.add(edge.target);
            queue.push(edge.target);
        }
    }

    return false;
}

function nearest(branches: Branch[], zone: string): Branch | null {
    let best: Branch | null = null;
    let bestRtt = Number.POSITIVE_INFINITY;

    for (const branch of branches) {
        if (!branch.geo) continue;

        const rtt = geoRttMs(zone, branch.geo);
        if (rtt >= bestRtt) continue;

        best = branch;
        bestRtt = rtt;
    }

    return best;
}

function sameZone(branches: Branch[], zone: string): Branch | null {
    return branches.find((branch) => branch.geo === zone) ?? null;
}

function writeTarget(branches: Branch[], writeRegion: string): Branch | null {
    const named = branches.find((branch) => branch.code === writeRegion || branch.regionId === writeRegion);
    if (named?.alive) return named;

    const primary = branches.find((branch) => branch.primary && branch.alive);
    if (primary) return primary;

    return branches.find((branch) => branch.alive) ?? null;
}

function normalise(weights: Map<string, number>): Map<string, number> {
    const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
    if (total <= 0) return weights;

    return new Map([...weights].map(([edgeId, value]) => [edgeId, value / total]));
}

function zoneAssignment(
    node: CompiledNode,
    branches: Branch[],
    zones: Map<string, number>,
    keyHomed = false,
): Map<string, Map<string, number>> {
    const policy = String(node.params.routingPolicy ?? 'simple');
    const alive = branches.filter((branch) => branch.alive);
    const assignment = new Map<string, Map<string, number>>(
        branches.map((branch) => [branch.edgeId, new Map<string, number>()]),
    );

    if (alive.length === 0) return assignment;

    const add = (edgeId: string, zone: string, rps: number): void => {
        const perZone = assignment.get(edgeId);
        if (perZone) perZone.set(zone, (perZone.get(zone) ?? 0) + rps);
    };

    if (keyHomed) {
        for (const [zone, rps] of zones) {
            for (const branch of alive) add(branch.edgeId, zone, rps / alive.length);
        }

        return assignment;
    }

    if (policy === 'failover') {
        const target = alive.find((branch) => branch.primary) ?? alive[0];
        for (const [zone, rps] of zones) add(target.edgeId, zone, rps);

        return assignment;
    }

    if (policy === 'weighted' || policy === 'simple') {
        const total = alive.reduce((sum, branch) => sum + Math.max(branch.weight, 0), 0);

        for (const [zone, rps] of zones) {
            for (const branch of alive) {
                const share = total > 0 ? Math.max(branch.weight, 0) / total : 1 / alive.length;
                add(branch.edgeId, zone, rps * share);
            }
        }

        return assignment;
    }

    const byContinent = policy === 'geo' && String(node.params.geoMapping ?? 'none') !== 'none';

    for (const [zone, rps] of zones) {
        const picked = (byContinent ? sameZone(alive, zone) : null) ?? nearest(alive, zone) ?? alive[0];
        add(picked.edgeId, zone, rps);
    }

    return assignment;
}

function readWeights(
    node: CompiledNode,
    branches: Branch[],
    zones: Map<string, number>,
    keyHomed: boolean,
): Map<string, number> {
    const policy = String(node.params.routingPolicy ?? 'simple');
    const alive = branches.filter((branch) => branch.alive);
    const weights = new Map<string, number>(branches.map((branch) => [branch.edgeId, 0]));

    if (alive.length === 0) return weights;

    if (policy === 'failover' && !keyHomed) {
        const target = alive.find((branch) => branch.primary) ?? alive[0];
        weights.set(target.edgeId, 1);

        return weights;
    }

    for (const [edgeId, perZone] of zoneAssignment(node, branches, zones, keyHomed)) {
        weights.set(edgeId, [...perZone.values()].reduce((sum, rps) => sum + rps, 0));
    }

    return normalise(weights);
}

function writeAssignment(
    branches: Branch[],
    zones: Map<string, number>,
    writeRegion: string,
): Map<string, Map<string, number>> {
    const assignment = new Map<string, Map<string, number>>(
        branches.map((branch) => [branch.edgeId, new Map<string, number>()]),
    );
    const target = writeTarget(branches, writeRegion);
    if (!target) return assignment;

    assignment.set(target.edgeId, new Map(zones));

    return assignment;
}

function mergedAssignment(
    read: Map<string, Map<string, number>>,
    write: Map<string, Map<string, number>>,
): Map<string, Map<string, number>> {
    const merged = new Map<string, Map<string, number>>();

    for (const [edgeId, perZone] of read) merged.set(edgeId, new Map(perZone));

    for (const [edgeId, perZone] of write) {
        const target = merged.get(edgeId) ?? new Map<string, number>();

        for (const [zone, rps] of perZone) target.set(zone, (target.get(zone) ?? 0) + rps);
        merged.set(edgeId, target);
    }

    return merged;
}

export function geoDetourMs(
    topology: CompiledTopology,
    flows: Flow[],
    disabledNodes: ReadonlySet<string>,
): Map<string, number> {
    const detours = new Map<string, number>();
    if (topology.regions.length < 2) return detours;

    const policy = topology.multiRegionPolicy;
    const mode = policy ? String(policy.params.mode ?? 'single') : 'active-active';
    const writeRegion = String(policy?.params.writeRegion ?? '');
    const keyHomed = mode === KEY_HOMED_MODE;

    for (const node of topology.nodes) {
        if (node.regionId || node.definition.shape !== 'node') continue;

        const branches = branchesOf(node, topology, disabledNodes).filter((branch) => branch.geo);
        const regions = new Set(branches.map((branch) => branch.regionId));
        if (branches.length < 2 || regions.size < 2) continue;

        const reads = clientZones(topology, flows, node.id, 'read');
        const writes = clientZones(topology, flows, node.id, 'write');
        const assignment = mergedAssignment(
            zoneAssignment(node, branches, reads, keyHomed),
            SINGLE_WRITER_MODES.has(mode)
                ? writeAssignment(branches, writes, writeRegion)
                : zoneAssignment(node, branches, writes, keyHomed),
        );

        for (const branch of branches) {
            const perZone = assignment.get(branch.edgeId);
            if (!perZone || perZone.size === 0) continue;

            let weighted = 0;
            let total = 0;

            for (const [zone, rps] of perZone) {
                const closest = Math.min(...branches.map((item) => geoRttMs(zone, String(item.geo))));
                weighted += rps * Math.max(geoRttMs(zone, String(branch.geo)) - closest, 0);
                total += rps;
            }

            if (total > 0 && weighted > 0) detours.set(branch.edgeId, weighted / total);
        }
    }

    return detours;
}

export function applyGeoDetour(topology: CompiledTopology, detours: ReadonlyMap<string, number>): void {
    for (const [edgeId, detourMs] of detours) {
        const edge = topology.edgeById.get(edgeId);
        if (!edge || detourMs <= 0) continue;

        edge.networkMs += detourMs;
        edge.scope = 'cross-region';
    }
}

export function routingShares(
    topology: CompiledTopology,
    flows: Flow[],
    disabledNodes: ReadonlySet<string>,
): Map<string, RouteShare> {
    const shares = new Map<string, RouteShare>();
    if (topology.regions.length < 2) return shares;

    const policy = topology.multiRegionPolicy;
    const mode = policy ? String(policy.params.mode ?? 'single') : 'active-active';
    const writeRegion = String(policy?.params.writeRegion ?? '');
    const keyHomed = mode === KEY_HOMED_MODE;

    for (const node of topology.nodes) {
        const routingPolicy = node.params.routingPolicy;
        if (typeof routingPolicy !== 'string') continue;

        const branches = branchesOf(node, topology, disabledNodes);
        const regions = new Set(branches.map((branch) => branch.regionId).filter(Boolean));
        if (branches.length < 2 || regions.size < 2) continue;

        if (!keyHomed && (routingPolicy === 'weighted' || routingPolicy === 'simple')) continue;

        const zones = clientZones(topology, flows, node.id);
        const reads = readWeights(node, branches, zones, keyHomed);
        const writes = SINGLE_WRITER_MODES.has(mode)
            ? new Map(branches.map((branch) => [branch.edgeId, 0]))
            : reads;

        if (writes !== reads) {
            const target = writeTarget(branches, writeRegion);
            if (target) writes.set(target.edgeId, 1);
        }

        const localReads = LOCAL_MODES.has(mode) || mode === 'read-local-write-global';

        for (const branch of branches) {
            shares.set(branch.edgeId, {
                read: localReads ? (reads.get(branch.edgeId) ?? 0) : (writes.get(branch.edgeId) ?? 0),
                write: writes.get(branch.edgeId) ?? 0,
            });
        }
    }

    return shares;
}
