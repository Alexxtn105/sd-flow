import type { SimResult } from '../engine/sim/types';
import type { SchemeV1 } from '../engine/types/scheme';

export interface SimulationRequest {
    scheme: SchemeV1;
    scenario: string;
    sampleCount: number;
}

interface WorkerResponse {
    id: number;
    result?: SimResult;
    error?: string;
}

interface PendingRequest {
    resolve: (result: SimResult) => void;
    reject: (error: Error) => void;
}

const pending = new Map<number, PendingRequest>();

let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;

function createWorker(): Worker | null {
    if (workerUnavailable || typeof Worker === 'undefined') return null;

    try {
        const created = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), {
            type: 'module',
        });

        created.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const { id, result, error } = event.data;
            const request = pending.get(id);
            if (!request) return;

            pending.delete(id);
            if (result) request.resolve(result);
            else request.reject(new Error(error ?? 'unknown simulation error'));
        };

        created.onerror = () => {
            for (const request of pending.values()) request.reject(new Error('simulation worker failed'));
            pending.clear();
            worker = null;
            workerUnavailable = true;
        };

        return created;
    } catch {
        workerUnavailable = true;
        return null;
    }
}

async function runInline(request: SimulationRequest): Promise<SimResult> {
    const { simulate } = await import('../engine/sim/simulate');
    const started = performance.now();
    const result = simulate(request.scheme, {
        scenario: request.scenario,
        sampleCount: request.sampleCount,
    });

    result.computeMs = performance.now() - started;
    return result;
}

export function runSimulation(request: SimulationRequest): Promise<SimResult> {
    if (!worker) worker = createWorker();
    if (!worker) return runInline(request);

    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise<SimResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker?.postMessage({ id, ...request });
    });
}
