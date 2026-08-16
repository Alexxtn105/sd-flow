import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { createDefaultEdge } from '../../src/engine/edgeDefaults';
import { firstCompatiblePair, protocolOptions } from '../../src/engine/ports';
import { migrateScheme } from '../../src/services/schemeMigrations';
import { buildScheme } from '../../src/services/schemeBuilder';
import { fromScheme, toScheme } from '../../src/services/schemeSerializer';
import { DEFAULT_SETTINGS } from '../../src/engine/types/scheme';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

beforeAll(() => {
    registry.reset();
    initComponents();
});

function edgeBetween(sourceType: string, targetType: string) {
    const pair = firstCompatiblePair(sourceType, targetType);
    if (!pair) throw new Error(`Несовместимые порты: ${sourceType} → ${targetType}`);

    return createDefaultEdge({
        source: 'a',
        target: 'b',
        sourceHandle: pair.sourceHandle,
        targetHandle: pair.targetHandle,
        sourceType,
        targetType,
    });
}

describe('тип нагрузки на связи', () => {
    it('берётся из общих протоколов портов', () => {
        expect(edgeBetween('client-web', 'api-gateway').protocol).toBe('http');
        expect(edgeBetween('service', 'postgres').protocol).toBe('sql');
        expect(edgeBetween('service', 'redis').protocol).toBe('redis');
        expect(edgeBetween('service', 'kafka').protocol).toBe('kafka');
    });

    it('вариантов для выбора не больше, чем общих протоколов', () => {
        const pair = firstCompatiblePair('service', 'service');
        expect(pair).not.toBeNull();

        const options = protocolOptions('service', pair!.sourceHandle, 'service', pair!.targetHandle);
        expect(options.length).toBeGreaterThan(0);
        expect(options).toContain(edgeBetween('service', 'service').protocol);
        expect(new Set(options).size).toBe(options.length);
    });

    it('переживает сохранение и загрузку схемы', () => {
        const scheme = buildScheme({
            id: 'proto',
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'svc', type: 'service' },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const flow = fromScheme(scheme);
        const restored = toScheme({
            meta: scheme.meta,
            nodes: flow.nodes,
            edges: flow.edges,
            settings: DEFAULT_SETTINGS,
        });

        expect(flow.edges[0].data?.protocol).toBe(scheme.edges[0].protocol);
        expect(restored.edges[0].protocol).toBe(scheme.edges[0].protocol);
    });

    it('дописывается старой схеме без поля и чинится у испорченной', () => {
        const scheme = buildScheme({
            id: 'old',
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'svc', type: 'service' },
            ],
            links: [{ from: 'client', to: 'svc' }],
        });

        const withoutProtocol = {
            ...scheme,
            edges: scheme.edges.map(({ protocol, ...edge }) => {
                void protocol;
                return edge;
            }),
        };
        const withWrongProtocol = {
            ...scheme,
            edges: scheme.edges.map((edge) => ({ ...edge, protocol: 'kafka' })),
        };

        const filled = migrateScheme(withoutProtocol);
        const repaired = migrateScheme(withWrongProtocol);

        expect(filled.ok && filled.scheme.edges[0].protocol).toBe('http');
        expect(repaired.ok && repaired.scheme.edges[0].protocol).toBe('http');
    });

    it('название протокола переведено на оба языка', () => {
        for (const protocol of ['http', 'grpc', 'ws', 'sql', 'kafka', 'internal']) {
            expect(ruCommon.protocol, `ru: ${protocol}`).toHaveProperty(protocol);
            expect(enCommon.protocol, `en: ${protocol}`).toHaveProperty(protocol);
        }

        expect(ruCommon.inspector).toHaveProperty('edgeProtocol');
        expect(enCommon.inspector).toHaveProperty('edgeProtocol');
    });
});
