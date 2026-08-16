import { describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { buildMarkdownReport } from '../../src/services/reportExport';
import { buildScheme } from '../helpers/scheme';
import type { EdgeResult, Finding, FlowResult, NodeResult, SimResult, Totals } from '../../src/engine/sim/types';
import type { SchemeV1 } from '../../src/engine/types/scheme';

registry.reset();
initComponents();

const GENERATED_AT = new Date('2026-08-14T09:30:00.000Z');

function scheme(): SchemeV1 {
    return buildScheme({
        name: 'Лента новостей',
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'gw', type: 'api-gateway' },
            { id: 'svc', type: 'service' },
            { id: 'db', type: 'postgres' },
        ],
        links: [
            { from: 'client', to: 'gw' },
            { from: 'gw', to: 'svc' },
            { from: 'svc', to: 'db' },
        ],
    });
}

function nodeResult(nodeId: string, componentType: string, patch: Partial<NodeResult>): NodeResult {
    const draft: Partial<NodeResult> = {
        nodeId,
        componentType,
        lambdaOffered: 1000,
        capacity: 4000,
        boundBy: 'cpu',
        utilization: 0.25,
        instances: 4,
        serviceSec: 0.02,
        waitSec: 0.001,
        cost: { compute: 100, storage: 0, network: 0, requests: 0, total: 100 },
        ...patch,
    };

    return draft as NodeResult;
}

function edgeResult(edgeId: string, patch: Partial<EdgeResult>): EdgeResult {
    const draft: Partial<EdgeResult> = {
        edgeId,
        kind: 'sync',
        rps: 1000,
        bytesPerSec: 2_000_000,
        networkMs: 1.5,
        scope: 'same-az',
        lagSec: 0,
        ...patch,
    };

    return draft as EdgeResult;
}

function flowResult(): FlowResult {
    const draft: Partial<FlowResult> = {
        id: 'client',
        entryNodeId: 'client',
        rps: 1000,
        readShare: 0.8,
        latency: { mean: 30, p50: 24, p95: 88, p99: 140 },
        errorRate: 0.0012,
        timeoutShare: 0.0004,
    };

    return draft as FlowResult;
}

function totals(): Totals {
    const draft: Partial<Totals> = {
        rps: 1000,
        readRps: 800,
        writeRps: 200,
        costMonth: 12_400,
        storageGb: 940,
        egressGbDay: 32,
        availability: 0.9993,
        errorBudgetMinutes: 30.2,
    };

    return draft as Totals;
}

function findings(): Finding[] {
    return [
        {
            id: 'finding-1',
            code: 'overloaded',
            severity: 'error',
            nodeIds: ['db'],
            edgeIds: [],
            values: { utilization: 1.35, boundBy: 'iops', capacity: 900, dropped: 315 },
        },
        {
            id: 'finding-2',
            code: 'spof',
            severity: 'warning',
            nodeIds: ['gw'],
            edgeIds: [],
            values: {},
        },
    ];
}

function simResult(): SimResult {
    const draft: Partial<SimResult> = {
        modelVersion: '0.1.0',
        scenario: 'peak',
        seed: 42,
        computeMs: 18,
        converged: true,
        iterations: 3,
        nodes: {
            gw: nodeResult('gw', 'api-gateway', { boundBy: 'connections', utilization: 0.62 }),
            svc: nodeResult('svc', 'service', {
                instances: 12,
                utilization: 0.44,
                cost: { compute: 900, storage: 0, network: 40, requests: 0, total: 940 },
            }),
            db: nodeResult('db', 'postgres', {
                instances: 1,
                boundBy: 'iops',
                capacity: 900,
                lambdaOffered: 1215,
                utilization: 1.35,
                waitSec: 0.4,
                cost: { compute: 1200, storage: 300, network: 20, requests: 0, total: 1520 },
            }),
        },
        edges: {
            'edge-0': edgeResult('edge-0', { scope: 'internet', networkMs: 24 }),
            'edge-1': edgeResult('edge-1', {}),
            'edge-2': edgeResult('edge-2', { kind: 'sync', rps: 1215, lagSec: 0.2 }),
        },
        flows: [flowResult()],
        totals: totals(),
        findings: findings(),
        issues: [],
        consistency: { mode: 'anomalies', anomalies: [] },
        multiRegion: null,
    };

    return draft as SimResult;
}

describe('отчёт в Markdown', () => {
    const source = scheme();
    const result = simResult();
    const report = buildMarkdownReport(source, result, 'ru', GENERATED_AT);

    it('содержит заголовок, дату и параметры расчёта', () => {
        expect(report.startsWith('# Отчёт по схеме «Лента новостей»')).toBe(true);
        expect(report).toContain('Сформирован');
        expect(report).toContain('Модель 0.1.0 · сценарий «Пик нагрузки» · seed 42');
    });

    it('содержит все ключевые разделы', () => {
        for (const section of [
            '## Сводка',
            '## Блоки',
            '## Потоки',
            '## Связи',
            '## Находки',
            '## Допущения модели',
        ]) {
            expect(report).toContain(section);
        }
    });

    it('в сводке есть нагрузка, задержки, стоимость и доступность', () => {
        expect(report).toContain('| Суммарная нагрузка | 1.0k запр./с — чтение 800 · запись 200 |');
        expect(report).toContain('| p95 задержки (худший поток) | 88 мс |');
        expect(report).toContain('| p99 задержки (худший поток) | 140 мс |');
        expect(report).toContain('| Стоимость | 12k $/мес |');
        expect(report).toContain('| Доступность | 99.9300% — бюджет ошибок 30.2 мин/мес |');
    });

    it('таблица блоков даёт тип, инстансы, ограничитель, утилизацию и стоимость', () => {
        expect(report).toContain(
            '| Блок | Тип | Инстансы | λ, запр./с | Ёмкость, запр./с | Ограничитель | Утилизация | Обслуживание + ожидание, мс | Стоимость, $/мес |',
        );
        expect(report).toContain('| PostgreSQL | PostgreSQL | 1 | 1.2k | 900 | IOPS диска | 135.0% | 420 | 1520 |');
        expect(report).toContain('| Шлюз | API-шлюз | 4 | 1.0k | 4.0k | число соединений | 62.0% | 21 | 100 |');
    });

    it('таблица связей показывает трафик каждого ребра', () => {
        expect(report).toContain('| Связь | Характер | RPS | Трафик, МБ/с | Сеть, мс | Область | Отставание, с |');
        expect(report).toContain('| Веб-клиенты → Шлюз | Синхронная | 1.0k | 2 | 24 | интернет | 0 |');
        expect(report).toContain('| Сервис → PostgreSQL | Синхронная | 1.2k | 2 | 1.5 | внутри зоны | 0.2 |');
    });

    it('перечисляет находки с их серьёзностью и подставленными значениями', () => {
        expect(report).toContain(
            '- **Ошибка** — Перегружен: PostgreSQL загружен на 135% и упирается в IOPS диска при ёмкости 900 запр./с',
        );
        expect(report).toContain('- **Предупреждение** — Единая точка отказа: Шлюз без резерва');
    });

    it('заканчивается блоком допущений со ссылкой на модель', () => {
        expect(report).toContain('Расчёт стационарный');
        expect(report).toContain('docs/02-simulation.md');
    });

    it('повторный вызов на тех же данных даёт тот же текст', () => {
        expect(buildMarkdownReport(source, result, 'ru', GENERATED_AT)).toBe(report);
    });

    it('переводится на английский целиком', () => {
        const english = buildMarkdownReport(source, result, 'en', GENERATED_AT);

        expect(english.startsWith('# Report on scheme "Лента новостей"')).toBe(true);
        for (const section of ['## Summary', '## Blocks', '## Flows', '## Edges', '## Findings', '## Model assumptions']) {
            expect(english).toContain(section);
        }
        expect(english).not.toContain('Сводка');
        expect(english).toContain('| Gateway | API gateway |');
        expect(english).not.toContain('| Шлюз |');
    });
});
