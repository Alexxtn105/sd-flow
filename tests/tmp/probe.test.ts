import { writeFileSync } from 'node:fs';
import { beforeAll, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import { simulate } from '../../src/engine/sim/simulate';
import { CHALLENGES } from '../../src/data/challenges';
import type { Challenge } from '../../src/engine/challenges/types';
import type { SchemeV1 } from '../../src/engine/types/scheme';

const SAMPLE_COUNT = 2000;

beforeAll(() => {
    registry.reset();
    initComponents();
});

function round(value: number, digits = 2): number {
    return Number(value.toFixed(digits));
}

function describeScheme(lines: string[], challenge: Challenge, label: string, scheme: SchemeV1): void {
    const verdict = acceptChallenge({ challenge, scheme, attempt: 1, hintsUsed: [], sampleCount: SAMPLE_COUNT });
    const base = simulate(scheme, { sampleCount: SAMPLE_COUNT, scenario: 'baseline' });

    lines.push(`  [${label}] stars=${verdict.stars} stage=${verdict.stage} rubric=${round(verdict.rubric.total)}`);
    if (verdict.realism.length > 0) {
        lines.push(`     realism: ${verdict.realism.map((item) => `${item.code}(${JSON.stringify(item.values)})`).join('; ')}`);
    }
    for (const evaluation of verdict.requirements) {
        if (evaluation.status === 'met') continue;
        lines.push(
            `     REQ ${evaluation.id} ${evaluation.kind} ${evaluation.status} reason=${evaluation.reason} actual=${
                evaluation.actual === null ? 'null' : round(evaluation.actual, 4)
            } target=${evaluation.target === null ? 'null' : round(evaluation.target, 4)} ${JSON.stringify(evaluation.values)}`,
        );
    }
    for (const evaluation of verdict.bonusObjectives) {
        lines.push(
            `     BONUS ${evaluation.id} ${evaluation.status} actual=${
                evaluation.actual === null ? 'null' : round(evaluation.actual, 4)
            } target=${evaluation.target === null ? 'null' : round(evaluation.target, 4)}`,
        );
    }
    for (const run of verdict.scenarioRuns) {
        if (run.passed) continue;
        lines.push(
            `     SCENARIO ${run.scenario} required=${run.required} failures=${run.failures
                .map((item) => `${item.id}:${round(item.actual ?? 0, 3)}>${round(item.target ?? 0, 3)}`)
                .join(', ')}`,
        );
    }
    lines.push(`     axes: ${verdict.rubric.axes.map((axis) => `${axis.axis}=${round(axis.score)}`).join(' ')}`);
    lines.push(`     penalties: ${verdict.rubric.penalties.map((item) => `${item.code}:${item.points}`).join(' ')}`);
    lines.push(`     antipatterns: ${verdict.lint.antipatterns.map((item) => `${item.rule}(${item.weight})`).join(' ')}`);
    lines.push(`     positives: ${verdict.lint.positives.map((item) => item.rule).join(' ')}`);

    for (const flow of base.flows) {
        lines.push(
            `     flow ${flow.id} rps=${round(flow.rps)} p50=${round(flow.latency.p50)} p95=${round(
                flow.latency.p95,
            )} p99=${round(flow.latency.p99)} avail=${round(flow.availability, 5)} err=${round(flow.errorRate, 5)} depth=${flow.depth}`,
        );
    }
    lines.push(
        `     totals cost=$${round(base.totals.costMonth)} growthGbDay=${round(
            base.totals.growthGbDay,
        )} storageGb=${round(base.totals.storageGb)} egressGbDay=${round(base.totals.egressGbDay)} avail=${round(
            base.totals.availability,
            6,
        )}`,
    );
    for (const node of Object.values(base.nodes)) {
        lines.push(
            `       node ${node.nodeId} (${node.componentType}) u=${round(node.utilization, 3)} boundBy=${
                node.boundBy
            } cap=${round(node.capacity)} lambda=${round(node.lambdaOffered)} inst=${node.instances} cost=$${round(
                node.cost.total,
            )} hit=${node.hitRatio === null ? '-' : round(node.hitRatio, 3)}`,
        );
    }
    lines.push(
        `     anomalies: ${base.consistency.anomalies
            .map((item) => `${item.code}@${item.nodeIds.join(',')}=${round(item.ratePerSec, 4)}rps/${round(item.shareOfOperations * 100, 4)}%`)
            .join(' ')}`,
    );
    if (base.multiRegion) {
        lines.push(
            `     multiRegion mode=${base.multiRegion.mode} rpo=${round(base.multiRegion.rpoSec, 2)} rto=${round(
                base.multiRegion.rtoSec,
            )} replRps=${round(base.multiRegion.replicationRps)}`,
        );
    }
    lines.push(`     findings: ${base.findings.map((item) => `${item.code}[${item.nodeIds.join(',')}]`).join(' ')}`);

    for (const scenario of [...challenge.scenarios.required, ...challenge.scenarios.bonus]) {
        const result = simulate(scheme, { sampleCount: SAMPLE_COUNT, scenario });
        const worst = Object.values(result.nodes)
            .filter((node) => node.lambdaOffered > 0)
            .reduce((left, right) => (right.utilization > left.utilization ? right : left), {
                nodeId: '-',
                utilization: 0,
            } as { nodeId: string; utilization: number });
        lines.push(
            `     scenario ${scenario}: p99=${result.flows
                .map((flow) => round(flow.latency.p99))
                .join('/')} worstU=${worst.nodeId}:${round(worst.utilization, 3)} cost=$${round(result.totals.costMonth)}`,
        );
    }
}

it('probe', () => {
    const lines: string[] = [];

    for (const challenge of CHALLENGES) {
        lines.push(`=== ${challenge.id} (level ${challenge.level}) ===`);
        describeScheme(lines, challenge, 'starter', challenge.starter());
        for (const solution of challenge.referenceSolutions) {
            describeScheme(lines, challenge, solution.id, solution.build());
        }
    }

    writeFileSync('/tmp/sdflow-probe.txt', lines.join('\n'));
});
