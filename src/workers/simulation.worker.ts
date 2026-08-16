import { resolveChallenge } from '../data/practice';
import type { ChallengeRef } from '../data/practice';
import { acceptChallenge } from '../engine/challenges/accept';
import initComponents from '../engine/initComponents';
import { findCeiling } from '../engine/sim/ceiling';
import { simulate } from '../engine/sim/simulate';
import type { SchemeV1 } from '../engine/types/scheme';

interface SimulationRequestMessage {
    id: number;
    kind: 'simulate';
    scheme: SchemeV1;
    scenario: string;
    sampleCount: number;
}

interface CeilingRequestMessage {
    id: number;
    kind: 'ceiling';
    scheme: SchemeV1;
    scenario: string;
}

interface AcceptanceRequestMessage {
    id: number;
    kind: 'accept';
    ref: ChallengeRef;
    scheme: SchemeV1;
    attempt: number;
    hintsUsed: number[];
}

type RequestMessage = SimulationRequestMessage | AcceptanceRequestMessage | CeilingRequestMessage;

initComponents();

self.onmessage = (event: MessageEvent<RequestMessage>) => {
    const request = event.data;
    const started = performance.now();

    try {
        if (request.kind === 'accept') {
            const verdict = acceptChallenge({
                challenge: resolveChallenge(request.ref),
                scheme: request.scheme,
                attempt: request.attempt,
                hintsUsed: request.hintsUsed,
            });

            self.postMessage({ id: request.id, payload: verdict });
            return;
        }

        if (request.kind === 'ceiling') {
            self.postMessage({
                id: request.id,
                payload: findCeiling(request.scheme, { scenario: request.scenario }),
            });
            return;
        }

        const result = simulate(request.scheme, { scenario: request.scenario, sampleCount: request.sampleCount });
        result.computeMs = performance.now() - started;
        self.postMessage({ id: request.id, payload: result });
    } catch (error) {
        self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
};
