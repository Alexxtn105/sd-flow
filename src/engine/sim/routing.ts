import type { CompiledEdge, CompiledNode, CompiledTopology } from './compile';
import { GEO_ZONES, geoRttMs } from './constants';
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
    primary: boolean;
    alive: boolean;
}

const LOCAL_MODES = new Set(['active-active', 'sharded-by-geo']);

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
            primary: region ? region.params.isPrimary === true : false,
            alive: !disabledNodes.has(edge.target) && (!region || !disabledNodes.has(region.id)),
        });
    }

    return branches;
}

function clientZones(topology: CompiledTopology, flows: Flow[], nodeId: string): Map<string, number> {
    const zones = new Map<string, number>();

    for (const flow of flows) {
        if (!reaches(topology, flow.entryNodeId, nodeId)) continue;

        if (flow.geo === 'global') {
            for (const zone of GEO_ZONES) zones.set(zone, (zones.get(zone) ?? 0) + flow.rps / GEO_ZONES.length);
            continue;
        }

        zones.set(flow.geo, (zones.get(flow.geo) ?? 0) + flow.rps);
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

function readWeights(node: CompiledNode, branches: Branch[], zones: Map<string, number>): Map<string, number> {
    const policy = String(node.params.routingPolicy ?? 'simple');
    const alive = branches.filter((branch) => branch.alive);
    const weights = new Map<string, number>(branches.map((branch) => [branch.edgeId, 0]));

    if (alive.length === 0) return weights;

    if (policy === 'failover') {
        const target = alive.find((branch) => branch.primary) ?? alive[0];
        weights.set(target.edgeId, 1);

        return weights;
    }

    const byContinent = policy === 'geo' && String(node.params.geoMapping ?? 'none') !== 'none';

    for (const [zone, rps] of zones) {
        const picked = (byContinent ? sameZone(alive, zone) : null) ?? nearest(alive, zone) ?? alive[0];
        weights.set(picked.edgeId, (weights.get(picked.edgeId) ?? 0) + rps);
    }

    return normalise(weights);
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

    for (const node of topology.nodes) {
        const routingPolicy = node.params.routingPolicy;
        if (typeof routingPolicy !== 'string') continue;

        const branches = branchesOf(node, topology, disabledNodes);
        const regions = new Set(branches.map((branch) => branch.regionId).filter(Boolean));
        if (branches.length < 2 || regions.size < 2) continue;

        if (routingPolicy === 'weighted' || routingPolicy === 'simple') continue;

        const zones = clientZones(topology, flows, node.id);
        const reads = readWeights(node, branches, zones);
        const writes =
            mode === 'active-passive' || mode === 'read-local-write-global' || mode === 'single'
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
