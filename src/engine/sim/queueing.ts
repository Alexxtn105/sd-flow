export interface QueueInput {
    lambdaOffered: number;
    capacity: number;
    servers: number;
    serviceSec: number;
    arrivalVariability: number;
    serviceVariability: number;
    timeoutSec: number;
    queueLimit: number;
}

export interface QueueResult {
    utilization: number;
    waitSec: number;
    queueDepth: number;
    throughput: number;
    overflowProbability: number;
    timeoutProbability: number;
    failureProbability: number;
    queueFullShare?: number;
}

const MAX_STABLE_UTILIZATION = 0.9999;

export function serviceVariabilityFromSigma(sigma: number): number {
    return Math.exp(sigma * sigma) - 1;
}

export function bindingServers(servers: number, capacity: number, serviceSec: number): number {
    const declared = Math.max(servers, 1);
    if (serviceSec <= 0 || !Number.isFinite(capacity)) return declared;

    return Math.min(declared, Math.max(capacity * serviceSec, 1));
}

export function queueFullShareOf(waitSec: number, drainSec: number): number {
    if (drainSec <= 0 || waitSec <= 0) return 0;

    return Math.min(waitSec / drainSec, 1);
}

export function erlangBlocking(servers: number, offeredErlangs: number): number {
    if (offeredErlangs <= 0) return 0;

    const places = Math.max(1, Math.round(servers));
    let blocking = 1;

    for (let taken = 1; taken <= places; taken += 1) {
        blocking = (offeredErlangs * blocking) / (taken + offeredErlangs * blocking);
    }

    return Math.min(Math.max(blocking, 0), 1);
}

export function sakasegawaWaitSec(
    serviceSec: number,
    servers: number,
    utilization: number,
): number {
    if (utilization <= 0) return 0;

    const c = Math.max(servers, 1);
    const rho = Math.min(utilization, MAX_STABLE_UTILIZATION);
    const exponent = Math.sqrt(2 * (c + 1)) - 1;

    return (serviceSec * Math.pow(rho, exponent)) / (c * (1 - rho));
}

export function solveQueue(input: QueueInput): QueueResult {
    const { lambdaOffered, capacity, servers, serviceSec, timeoutSec, queueLimit } = input;

    if (!Number.isFinite(capacity) || capacity <= 0) {
        return {
            utilization: 0,
            waitSec: 0,
            queueDepth: 0,
            throughput: lambdaOffered,
            overflowProbability: 0,
            timeoutProbability: 0,
            failureProbability: 0,
        };
    }

    const utilization = lambdaOffered / capacity;
    const places = bindingServers(servers, capacity, serviceSec);
    const markovianWait = sakasegawaWaitSec(serviceSec, places, utilization);
    const variabilityFactor = (input.arrivalVariability + input.serviceVariability) / 2;
    const unboundedWait = markovianWait * variabilityFactor;
    const drainWait = queueLimit > 0 ? queueLimit / capacity : 0;
    const waitSec = queueLimit > 0 ? Math.min(unboundedWait, drainWait) : 0;

    const saturationLoss = lambdaOffered > capacity ? 1 - capacity / lambdaOffered : 0;
    const overflowProbability =
        queueLimit > 0
            ? saturationLoss
            : Math.max(saturationLoss, erlangBlocking(places, utilization * places));

    const throughput = Math.min(lambdaOffered * (1 - overflowProbability), capacity);
    const responseSec = serviceSec + waitSec;
    const timeoutProbability =
        timeoutSec > 0 && responseSec > 0
            ? (1 - overflowProbability) * Math.exp(-timeoutSec / responseSec)
            : 0;

    return {
        utilization,
        waitSec,
        queueDepth: throughput * waitSec,
        throughput,
        overflowProbability,
        timeoutProbability,
        failureProbability: 1 - (1 - overflowProbability) * (1 - timeoutProbability),
        queueFullShare: queueFullShareOf(waitSec, drainWait),
    };
}

export function retryAmplification(
    failureProbability: number,
    retries: number,
    retryBudget: number,
): number {
    if (retries <= 0) return 0;

    const effective = Math.min(failureProbability, retryBudget);
    let amplification = 0;
    let term = 1;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        term *= effective;
        amplification += term;
    }

    return amplification;
}
