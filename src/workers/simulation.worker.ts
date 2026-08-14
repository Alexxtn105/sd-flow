import initComponents from '../engine/initComponents';
import { simulate } from '../engine/sim/simulate';
import type { SchemeV1 } from '../engine/types/scheme';

interface SimulationRequestMessage {
    id: number;
    scheme: SchemeV1;
    scenario: string;
    sampleCount: number;
}

initComponents();

self.onmessage = (event: MessageEvent<SimulationRequestMessage>) => {
    const { id, scheme, scenario, sampleCount } = event.data;
    const started = performance.now();

    try {
        const result = simulate(scheme, { scenario, sampleCount });
        result.computeMs = performance.now() - started;
        self.postMessage({ id, result });
    } catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
};
