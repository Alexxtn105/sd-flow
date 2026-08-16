import { create } from 'zustand';
import { PREVIEW_SAMPLE_COUNT, sampleCountFor } from '../engine/sim/simulate';
import type { CeilingResult, SimResult } from '../engine/sim/types';
import type { SchemeV1 } from '../engine/types/scheme';
import { runCeiling, runSimulation } from '../services/simulationService';

export type SimStatus = 'idle' | 'running' | 'ready' | 'error';

export interface SimState {
    result: SimResult | null;
    status: SimStatus;
    error: string | null;
    scenario: string;
    preview: boolean;
    dashboardOpen: boolean;
    waterfallFlowId: string | null;
    ceiling: CeilingResult | null;
    ceilingRunning: boolean;
    run: (scheme: SchemeV1) => void;
    sweep: (scheme: SchemeV1) => void;
    setScenario: (scenario: string) => void;
    setPreview: (preview: boolean) => void;
    toggleDashboard: () => void;
    focusWaterfall: (flowId: string | null) => void;
    reset: () => void;
}

let latestRequest = 0;
let latestSweep = 0;

export const useSimStore = create<SimState>((set, get) => ({
    result: null,
    status: 'idle',
    error: null,
    scenario: 'baseline',
    preview: false,
    dashboardOpen: true,
    waterfallFlowId: null,
    ceiling: null,
    ceilingRunning: false,

    run: (scheme) => {
        const { scenario, preview } = get();

        if (scheme.nodes.length === 0) {
            latestRequest += 1;
            latestSweep += 1;
            set({ result: null, status: 'idle', error: null, ceiling: null, ceilingRunning: false });
            return;
        }

        latestRequest += 1;
        latestSweep += 1;
        const requestId = latestRequest;
        set({ status: 'running', error: null, ceiling: null, ceilingRunning: false });

        runSimulation({
            scheme,
            scenario,
            sampleCount: preview ? PREVIEW_SAMPLE_COUNT : sampleCountFor(scheme.settings.modelDepth),
        })
            .then((result) => {
                if (requestId !== latestRequest) return;
                set({ result, status: 'ready', error: null });
            })
            .catch((error: Error) => {
                if (requestId !== latestRequest) return;
                set({ status: 'error', error: error.message });
            });
    },

    sweep: (scheme) => {
        if (scheme.nodes.length === 0) return;

        latestSweep += 1;
        const sweepId = latestSweep;
        set({ ceilingRunning: true });

        runCeiling({ scheme, scenario: get().scenario })
            .then((ceiling) => {
                if (sweepId !== latestSweep) return;
                set({ ceiling, ceilingRunning: false });
            })
            .catch(() => {
                if (sweepId !== latestSweep) return;
                set({ ceiling: null, ceilingRunning: false });
            });
    },

    setScenario: (scenario) => set({ scenario }),
    setPreview: (preview) => set({ preview }),
    toggleDashboard: () => set((state) => ({ dashboardOpen: !state.dashboardOpen })),
    focusWaterfall: (flowId) => set({ waterfallFlowId: flowId, dashboardOpen: true }),
    reset: () => {
        latestRequest += 1;
        latestSweep += 1;
        set({ result: null, status: 'idle', error: null, ceiling: null, ceilingRunning: false });
    },
}));

export function useNodeResult(nodeId: string | undefined) {
    return useSimStore((state) => (nodeId ? (state.result?.nodes[nodeId] ?? null) : null));
}

export function useEdgeResult(edgeId: string | undefined) {
    return useSimStore((state) => (edgeId ? (state.result?.edges[edgeId] ?? null) : null));
}

export function useProbeReading(probeId: string | undefined) {
    return useSimStore((state) => (probeId ? (state.result?.probes[probeId] ?? null) : null));
}
