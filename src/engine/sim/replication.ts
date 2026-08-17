import type { ComponentParams } from '../types/component';

export const STALE_READ_POLICIES = ['accept', 'wait-for-lag'];

const DEFAULT_LAG_SIGMA = 0.8;
const MAX_LAG_PRESSURE_UTILIZATION = 0.99;

function clampShare(value: number): number {
    return Math.min(Math.max(value, 0), 1);
}

export function stickyReadShare(params: ComponentParams): number {
    const share = params.stickyReadShare;

    return typeof share === 'number' ? clampShare(share) : 0;
}

export function declaredReplicaReadShare(params: ComponentParams): number {
    const share = params.readFromReplica;
    if (typeof share === 'number') return clampShare(share);

    return params.replicationMode === 'async' ? 1 : 0;
}

export function replicaReadShare(params: ComponentParams): number {
    return declaredReplicaReadShare(params) * (1 - stickyReadShare(params));
}

export function replicaLagSigma(params: ComponentParams): number {
    const sigma = params.replicaLagSigma;

    return typeof sigma === 'number' ? sigma : DEFAULT_LAG_SIGMA;
}

export function replicaLagSec(params: ComponentParams, utilization: number): number {
    const declared = Number(params.replicaLagMs ?? 0) / 1000;
    if (declared <= 0) return 0;

    const load = Math.min(Math.max(utilization, 0), MAX_LAG_PRESSURE_UTILIZATION);

    return declared * (1 + (load * load) / (1 - load));
}

export function expectedLagSec(medianSec: number, sigma: number): number {
    return medianSec * Math.exp((sigma * sigma) / 2);
}

export function waitsForLag(params: ComponentParams): boolean {
    return params.staleReadPolicy === 'wait-for-lag';
}

export function lagWaitSec(params: ComponentParams, utilization: number): number {
    if (!waitsForLag(params)) return 0;

    return expectedLagSec(replicaLagSec(params, utilization), replicaLagSigma(params));
}
