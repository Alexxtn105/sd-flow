import type { ClusterPlacement } from './clusters';
import { planClusterPods } from './clusters';
import type { CompiledTopology } from './compile';
import type { Flow } from './flows';
import { solveFlows } from './solver';
import type { SolveOptions, SolverOutput } from './solver';

export interface SolvedScheme {
    runtime: SolverOutput;
    placement: ClusterPlacement;
    converged: boolean;
    iterations: number;
}

export function solveScheme(topology: CompiledTopology, flows: Flow[], options: SolveOptions): SolvedScheme {
    const unconstrained = solveFlows(topology, flows, options);
    const desired = new Map(
        [...unconstrained.nodes].map(([nodeId, runtime]) => [nodeId, runtime.desiredInstances] as const),
    );
    const placement = planClusterPods(topology, desired);

    const runtime = placement.clamped
        ? solveFlows(topology, flows, {
              ...options,
              instanceOverride: placement.instanceOverride,
              warmStart: unconstrained.nodes,
          })
        : unconstrained;

    return {
        runtime,
        placement,
        converged: unconstrained.converged && runtime.converged,
        iterations: unconstrained.iterations + (placement.clamped ? runtime.iterations : 0),
    };
}
