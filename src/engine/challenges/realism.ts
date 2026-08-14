import type { ParamField } from '../types/component';
import type { CompiledTopology } from '../sim/compile';
import type { SimResult } from '../sim/types';
import { findPath } from './predicates';
import type { Challenge, RealismViolation } from './types';

const MIN_SAMPLING_RATE = 0.001;

function numericField(field: ParamField | undefined): field is Extract<ParamField, { kind: 'number' }> {
    return field !== undefined && field.kind === 'number';
}

function checkParamRanges(topology: CompiledTopology): RealismViolation[] {
    const violations: RealismViolation[] = [];

    for (const node of topology.nodes) {
        const schema = node.definition.paramSchema;

        for (const [key, value] of Object.entries(node.params)) {
            if (typeof value !== 'number') continue;

            const field = schema[key];
            if (!numericField(field)) continue;

            const belowSchema = field.min !== undefined && value < field.min;
            const aboveSchema = field.max !== undefined && value > field.max;

            if (belowSchema || aboveSchema) {
                violations.push({
                    code: 'param-outside-schema',
                    nodeIds: [node.id],
                    values: {
                        param: key,
                        value,
                        min: field.min ?? Number.NEGATIVE_INFINITY,
                        max: field.max ?? Number.POSITIVE_INFINITY,
                    },
                });
                continue;
            }

            if (!field.realistic) continue;

            if (value < field.realistic.min || value > field.realistic.max) {
                violations.push({
                    code: 'param-out-of-range',
                    nodeIds: [node.id],
                    values: { param: key, value, min: field.realistic.min, max: field.realistic.max },
                });
            }
        }
    }

    return violations;
}

function checkLockedParams(challenge: Challenge, topology: CompiledTopology): RealismViolation[] {
    const violations: RealismViolation[] = [];

    for (const [nodeId, locked] of Object.entries(challenge.lockedParams)) {
        const node = topology.nodeById.get(nodeId);

        if (!node) {
            violations.push({ code: 'given-node-removed', nodeIds: [nodeId], values: { node: nodeId } });
            continue;
        }

        for (const [key, expected] of Object.entries(locked)) {
            if (node.params[key] === expected) continue;

            violations.push({
                code: 'given-param-changed',
                nodeIds: [nodeId],
                values: { param: key, expected: String(expected), actual: String(node.params[key]) },
            });
        }
    }

    return violations;
}

function checkConstraints(challenge: Challenge, topology: CompiledTopology): RealismViolation[] {
    const violations: RealismViolation[] = [];
    const { maxNodes, allowedGroups, forbiddenTypes } = challenge.constraints;

    const placed = topology.nodes.filter((node) => node.definition.shape === 'node');

    if (maxNodes !== undefined && placed.length > maxNodes) {
        violations.push({ code: 'too-many-nodes', nodeIds: [], values: { nodes: placed.length, maxNodes } });
    }

    for (const node of topology.nodes) {
        if (forbiddenTypes?.includes(node.type)) {
            violations.push({ code: 'forbidden-type', nodeIds: [node.id], values: { type: node.type } });
        }

        if (allowedGroups && node.definition.shape === 'node' && !allowedGroups.includes(node.definition.group)) {
            violations.push({ code: 'group-not-allowed', nodeIds: [node.id], values: { group: node.definition.group } });
        }
    }

    return violations;
}

function checkEmptyEdges(topology: CompiledTopology): RealismViolation[] {
    return topology.edges
        .filter((edge) => edge.calls.length > 0 && edge.calls.every((call) => call.fanout === 0 || call.share === 0))
        .map((edge) => ({ code: 'empty-edge', nodeIds: [edge.source, edge.target], values: { edge: edge.id } }));
}

function checkObservability(topology: CompiledTopology): RealismViolation[] {
    return topology.nodes
        .filter((node) => node.type === 'logs' && Number(node.params.samplingRate ?? 1) < MIN_SAMPLING_RATE)
        .map((node) => ({
            code: 'sampling-too-low',
            nodeIds: [node.id],
            values: { samplingRate: Number(node.params.samplingRate ?? 0), min: MIN_SAMPLING_RATE },
        }));
}

function checkReplicationLag(topology: CompiledTopology): RealismViolation[] {
    const violations: RealismViolation[] = [];

    for (const edge of topology.edges) {
        if (!edge.isReplication || edge.networkMs === 0) continue;

        const target = topology.nodeById.get(edge.target);
        if (!target) continue;

        const declared = Number(target.params.replicaLagMs ?? 0);
        const physical = edge.networkMs / 2;

        if (declared < physical) {
            violations.push({
                code: 'replica-lag-below-physics',
                nodeIds: [target.id],
                values: { replicaLagMs: declared, minimumMs: Math.round(physical) },
            });
        }
    }

    return violations;
}

function checkEmptyRegions(topology: CompiledTopology): RealismViolation[] {
    return topology.regions
        .filter((region) => !topology.nodes.some((node) => node.regionId === region.id && node.definition.shape === 'node'))
        .map((region) => ({ code: 'empty-region', nodeIds: [region.id], values: { region: region.id } }));
}

function checkExternalDependency(
    challenge: Challenge,
    topology: CompiledTopology,
    result: SimResult,
): RealismViolation[] {
    const violations: RealismViolation[] = [];

    for (const requirement of challenge.requirements) {
        if (requirement.kind !== 'capability') continue;

        const flow = result.flows.find((item) => item.id === requirement.flow);
        if (!flow) continue;

        const path = findPath(topology, flow.entryNodeId, requirement.to, requirement.viaAny, requirement.notVia);
        if (!path) continue;

        const withoutExternal = findPath(topology, flow.entryNodeId, requirement.to, requirement.viaAny, [
            ...(requirement.notVia ?? []),
            { type: 'external-api' },
        ]);

        if (!withoutExternal) {
            violations.push({
                code: 'external-does-core-work',
                nodeIds: path.filter((nodeId) => topology.nodeById.get(nodeId)?.type === 'external-api'),
                values: { requirement: requirement.id },
            });
        }
    }

    return violations;
}

export interface RealismInput {
    challenge: Challenge;
    topology: CompiledTopology;
    result: SimResult;
    consistencyModel: string;
}

export function checkRealism(input: RealismInput): RealismViolation[] {
    const { challenge, topology, result, consistencyModel } = input;

    const violations = [
        ...checkLockedParams(challenge, topology),
        ...checkConstraints(challenge, topology),
        ...checkParamRanges(topology),
        ...checkEmptyEdges(topology),
        ...checkObservability(topology),
        ...checkReplicationLag(topology),
        ...checkEmptyRegions(topology),
        ...checkExternalDependency(challenge, topology, result),
    ];

    if (challenge.requiredConsistencyModel && consistencyModel !== challenge.requiredConsistencyModel) {
        violations.push({
            code: 'consistency-model-required',
            nodeIds: [],
            values: { required: challenge.requiredConsistencyModel, actual: consistencyModel },
        });
    }

    return violations;
}
