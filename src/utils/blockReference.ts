import registry from '../engine/ComponentRegistry';
import type { ComponentDefinition, NodeContext, ResourceLimit } from '../engine/types/component';

const REFERENCE_LAMBDA = 5000;
const REFERENCE_READ_SHARE = 0.8;
const REFERENCE_REQUEST_BYTES = 2000;
const REFERENCE_RESPONSE_BYTES = 20000;

export function referenceContext(definition: ComponentDefinition): NodeContext {
    const params = registry.getDefaultParams(definition.id);

    return {
        nodeId: definition.id,
        params,
        instances: typeof params.instances === 'number' ? params.instances : 1,
        lambda: REFERENCE_LAMBDA,
        readShare: REFERENCE_READ_SHARE,
        writeShare: 1 - REFERENCE_READ_SHARE,
        requestBytes: REFERENCE_REQUEST_BYTES,
        responseBytes: REFERENCE_RESPONSE_BYTES,
    };
}

export function referenceLimits(definition: ComponentDefinition): ResourceLimit[] {
    if (!definition.model) return [];

    return definition.model.capacity(referenceContext(definition)).limits.filter((limit) => Number.isFinite(limit.value));
}
