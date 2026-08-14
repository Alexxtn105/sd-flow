import i18n from '../locales/i18n';
import { formatDateTime, formatNumber, formatPercent, formatRps } from '../utils/format';
import type { EdgeResult, Finding, FlowResult, NodeResult, SimResult } from '../engine/sim/types';
import type { SchemeEdge, SchemeNode, SchemeV1 } from '../engine/types/scheme';

type Translate = (key: string, values?: Record<string, unknown>) => string;

function translator(locale: string): Translate {
    const fixed = i18n.getFixedT(locale);
    return (key, values) => String(fixed(key, values));
}

function escapeCell(value: string): string {
    return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function table(header: string[], rows: string[][]): string {
    const head = `| ${header.join(' | ')} |`;
    const divider = `|${header.map(() => '---').join('|')}|`;
    const body = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`);
    return [head, divider, ...body].join('\n');
}

function nodeLabels(scheme: SchemeV1, t: Translate): Map<string, string> {
    return new Map(
        scheme.nodes.map((node: SchemeNode) => [
            node.id,
            node.label || t(`blocks:${node.type}`, { defaultValue: node.type }),
        ]),
    );
}

function worstLatency(flows: FlowResult[], pick: (flow: FlowResult) => number): number | null {
    if (flows.length === 0) return null;
    return flows.reduce((worst, flow) => Math.max(worst, pick(flow)), 0);
}

function millisecondsOrDash(value: number | null): string {
    return value === null ? '—' : formatNumber(value);
}

function summarySection(result: SimResult, t: Translate): string {
    const { totals } = result;
    const p95 = worstLatency(result.flows, (flow) => flow.latency.p95);
    const p99 = worstLatency(result.flows, (flow) => flow.latency.p99);

    const rows: string[][] = [
        [
            t('report.summary.rps'),
            `${formatRps(totals.rps)} ${t('dashboard.unit.rps')} — ${t('report.summary.readWrite', {
                read: formatRps(totals.readRps),
                write: formatRps(totals.writeRps),
            })}`,
        ],
        [t('report.summary.p95'), `${millisecondsOrDash(p95)} ${t('dashboard.unit.ms')}`],
        [t('report.summary.p99'), `${millisecondsOrDash(p99)} ${t('dashboard.unit.ms')}`],
        [t('report.summary.costMonth'), `${formatNumber(totals.costMonth)} ${t('dashboard.unit.usdMonth')}`],
        [
            t('report.summary.availability'),
            `${formatPercent(totals.availability, 4)} — ${t('report.summary.errorBudget', {
                value: formatNumber(totals.errorBudgetMinutes),
                unit: t('dashboard.unit.minMonth'),
            })}`,
        ],
        [t('report.summary.storage'), `${formatNumber(totals.storageGb)} ${t('dashboard.unit.gb')}`],
        [t('report.summary.egress'), `${formatNumber(totals.egressGbDay)} ${t('dashboard.unit.gbDay')}`],
    ];

    return table([t('report.summary.metric'), t('report.summary.value')], rows);
}

function nodeRow(node: NodeResult, label: string, t: Translate): string[] {
    return [
        label,
        t(`blocks:${node.componentType}`, { defaultValue: node.componentType }),
        String(node.instances),
        formatRps(node.lambdaOffered),
        formatRps(node.capacity),
        t(`bound.${node.boundBy}`, { defaultValue: node.boundBy }),
        formatPercent(node.utilization, 1),
        formatNumber((node.serviceSec + node.waitSec) * 1000),
        formatNumber(node.cost.total),
    ];
}

function nodesSection(scheme: SchemeV1, result: SimResult, labels: Map<string, string>, t: Translate): string {
    const rows = scheme.nodes
        .map((node) => ({ node, measured: result.nodes[node.id] }))
        .filter((entry): entry is { node: SchemeNode; measured: NodeResult } => Boolean(entry.measured))
        .map((entry) => nodeRow(entry.measured, labels.get(entry.node.id) ?? entry.node.id, t));

    if (rows.length === 0) return t('report.empty.nodes');

    return table(
        [
            t('report.node.name'),
            t('report.node.type'),
            t('report.node.instances'),
            t('report.node.lambda'),
            t('report.node.capacity'),
            t('report.node.boundBy'),
            t('report.node.utilization'),
            t('report.node.latency'),
            t('report.node.cost'),
        ],
        rows,
    );
}

function flowsSection(result: SimResult, labels: Map<string, string>, t: Translate): string {
    if (result.flows.length === 0) return t('report.empty.flows');

    const rows = result.flows.map((flow) => [
        labels.get(flow.entryNodeId) ?? flow.entryNodeId,
        formatRps(flow.rps),
        formatNumber(flow.latency.p50),
        formatNumber(flow.latency.p95),
        formatNumber(flow.latency.p99),
        formatPercent(flow.errorRate, 2),
        formatPercent(flow.timeoutShare, 2),
    ]);

    return table(
        [
            t('dashboard.flow.entry'),
            t('dashboard.flow.rps'),
            t('dashboard.flow.p50'),
            t('dashboard.flow.p95'),
            t('dashboard.flow.p99'),
            t('dashboard.flow.errors'),
            t('dashboard.flow.timeouts'),
        ],
        rows,
    );
}

function edgeRow(edge: SchemeEdge, measured: EdgeResult, labels: Map<string, string>, t: Translate): string[] {
    const source = labels.get(edge.source) ?? edge.source;
    const target = labels.get(edge.target) ?? edge.target;

    return [
        `${source} → ${target}`,
        t(`edgeKind.${measured.kind}`, { defaultValue: measured.kind }),
        formatRps(measured.rps),
        formatNumber(measured.bytesPerSec / 1_000_000),
        formatNumber(measured.networkMs),
        t(`report.scope.${measured.scope}`, { defaultValue: measured.scope }),
        formatNumber(measured.lagSec),
    ];
}

function edgesSection(scheme: SchemeV1, result: SimResult, labels: Map<string, string>, t: Translate): string {
    const rows = scheme.edges
        .map((edge) => ({ edge, measured: result.edges[edge.id] }))
        .filter((entry): entry is { edge: SchemeEdge; measured: EdgeResult } => Boolean(entry.measured))
        .map((entry) => edgeRow(entry.edge, entry.measured, labels, t));

    if (rows.length === 0) return t('report.empty.edges');

    return table(
        [
            t('report.edge.link'),
            t('report.edge.kind'),
            t('report.edge.rps'),
            t('report.edge.bandwidth'),
            t('report.edge.network'),
            t('report.edge.scope'),
            t('report.edge.lag'),
        ],
        rows,
    );
}

function findingText(finding: Finding, labels: Map<string, string>, t: Translate): string {
    const values: Record<string, string | number> = {
        nodeNames: finding.nodeIds.map((nodeId) => labels.get(nodeId) ?? nodeId).join(', '),
    };

    for (const [key, value] of Object.entries(finding.values)) {
        if (typeof value === 'number') {
            values[key] = formatNumber(value);
            values[`${key}Pct`] = formatNumber(value * 100);
            continue;
        }

        values[key] = key === 'boundBy' ? t(`bound.${value}`, { defaultValue: value }) : value;
    }

    return t(`findings.${finding.code}`, { ...values, defaultValue: finding.code });
}

function findingsSection(result: SimResult, labels: Map<string, string>, t: Translate): string {
    if (result.findings.length === 0) return t('report.empty.findings');

    return result.findings
        .map(
            (finding) =>
                `- **${t(`report.severity.${finding.severity}`)}** — ${findingText(finding, labels, t)}`,
        )
        .join('\n');
}

export function buildMarkdownReport(
    scheme: SchemeV1,
    result: SimResult,
    locale: string,
    generatedAt: Date = new Date(),
): string {
    const t = translator(locale);
    const labels = nodeLabels(scheme, t);

    return [
        `# ${t('report.title', { name: scheme.meta.name || t('report.unnamed') })}`,
        '',
        t('report.generatedAt', { date: formatDateTime(generatedAt.toISOString(), locale) }),
        '',
        t('report.meta', {
            modelVersion: result.modelVersion,
            scenario: t(`scenario.${result.scenario}`, { defaultValue: result.scenario }),
            seed: result.seed,
        }),
        '',
        `## ${t('report.section.summary')}`,
        '',
        summarySection(result, t),
        '',
        `## ${t('report.section.nodes')}`,
        '',
        nodesSection(scheme, result, labels, t),
        '',
        `## ${t('report.section.flows')}`,
        '',
        flowsSection(result, labels, t),
        '',
        `## ${t('report.section.edges')}`,
        '',
        edgesSection(scheme, result, labels, t),
        '',
        `## ${t('report.section.findings')}`,
        '',
        findingsSection(result, labels, t),
        '',
        `## ${t('report.section.assumptions')}`,
        '',
        t('report.assumptions'),
        '',
    ].join('\n');
}
