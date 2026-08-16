import type { ChallengeRef } from '../data/practice';
import type { ChallengeVerdict } from '../engine/challenges/types';
import type { CeilingResult, SimResult } from '../engine/sim/types';
import type { SchemeV1 } from '../engine/types/scheme';

export interface SimulationRequest {
    scheme: SchemeV1;
    scenario: string;
    sampleCount: number;
}

export interface CeilingRequest {
    scheme: SchemeV1;
    scenario: string;
}

export interface AcceptanceRequest {
    ref: ChallengeRef;
    scheme: SchemeV1;
    attempt: number;
    hintsUsed: number[];
}

type WorkerPayload = SimResult | ChallengeVerdict | CeilingResult | null;

interface WorkerResponse {
    id: number;
    payload?: WorkerPayload;
    error?: string;
}

interface PendingRequest {
    resolve: (payload: WorkerPayload) => void;
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
            const { id, payload, error } = event.data;
            const request = pending.get(id);
            if (!request) return;

            pending.delete(id);
            if (error !== undefined) request.reject(new Error(error));
            else request.resolve(payload ?? null);
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

function send(message: Record<string, unknown>): Promise<WorkerPayload> {
    if (!worker) worker = createWorker();
    if (!worker) return Promise.reject(new Error('worker unavailable'));

    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise<WorkerPayload>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker?.postMessage({ id, ...message });
    });
}

async function simulateInline(request: SimulationRequest): Promise<SimResult> {
    const { simulate } = await import('../engine/sim/simulate');
    const started = performance.now();
    const result = simulate(request.scheme, {
        scenario: request.scenario,
        sampleCount: request.sampleCount,
    });

    result.computeMs = performance.now() - started;
    return result;
}

async function acceptInline(request: AcceptanceRequest): Promise<ChallengeVerdict> {
    const [{ acceptChallenge }, { resolveChallenge }] = await Promise.all([
        import('../engine/challenges/accept'),
        import('../data/practice'),
    ]);

    return acceptChallenge({
        challenge: resolveChallenge(request.ref),
        scheme: request.scheme,
        attempt: request.attempt,
        hintsUsed: request.hintsUsed,
    });
}

export function runSimulation(request: SimulationRequest): Promise<SimResult> {
    if (workerUnavailable) return simulateInline(request);

    return send({ kind: 'simulate', ...request })
        .then((payload) => payload as SimResult)
        .catch(() => simulateInline(request));
}

async function ceilingInline(request: CeilingRequest): Promise<CeilingResult | null> {
    const { findCeiling } = await import('../engine/sim/ceiling');
    return findCeiling(request.scheme, { scenario: request.scenario });
}

export function runCeiling(request: CeilingRequest): Promise<CeilingResult | null> {
    if (workerUnavailable) return ceilingInline(request);

    return send({ kind: 'ceiling', ...request })
        .then((payload) => payload as CeilingResult | null)
        .catch(() => ceilingInline(request));
}

export function runAcceptance(request: AcceptanceRequest): Promise<ChallengeVerdict> {
    if (workerUnavailable) return acceptInline(request);

    return send({ kind: 'accept', ...request })
        .then((payload) => payload as ChallengeVerdict)
        .catch(() => acceptInline(request));
}
