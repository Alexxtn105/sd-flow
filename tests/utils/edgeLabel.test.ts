import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import type { Protocol } from '../../src/engine/types/component';
import enCommon from '../../src/locales/en/common.json';
import ruCommon from '../../src/locales/ru/common.json';
import enParams from '../../src/locales/en/params.json';
import ruParams from '../../src/locales/ru/params.json';
import {
    DEFAULT_EDGE_LABEL_MODE,
    EDGE_LABEL_MODES,
    edgeLabelParts,
    isEdgeLabelMode,
    PROTOCOL_NAMESPACE,
    protocolLabelKey,
} from '../../src/utils/edgeLabel';
import trafficEdgeSource from '../../src/components/canvas/TrafficEdge.tsx?raw';

beforeAll(() => {
    registry.reset();
    initComponents();
});

function catalogProtocols(): Protocol[] {
    const found = new Set<Protocol>();

    for (const definition of registry.list()) {
        for (const port of [...definition.ports.in, ...definition.ports.out]) {
            for (const protocol of port.protocols) found.add(protocol);
        }
    }

    return [...found].sort();
}

describe('режимы подписи связи', () => {
    it('по умолчанию показывает и имя, и тип нагрузки', () => {
        expect(DEFAULT_EDGE_LABEL_MODE).toBe('both');
        expect(edgeLabelParts('both', 'отдаём чанк', 'http')).toEqual({
            name: 'отдаём чанк',
            protocol: 'http',
        });
    });

    it('каждый режим оставляет ровно то, что назван', () => {
        expect(edgeLabelParts('name', 'инвалидация', 'redis')).toEqual({ name: 'инвалидация', protocol: '' });
        expect(edgeLabelParts('protocol', 'инвалидация', 'redis')).toEqual({ name: '', protocol: 'redis' });
        expect(edgeLabelParts('off', 'инвалидация', 'redis')).toEqual({ name: '', protocol: '' });
    });

    it('пустое имя не превращается в пустую плашку', () => {
        for (const mode of EDGE_LABEL_MODES) {
            expect(edgeLabelParts(mode, '', '').name).toBe('');
            expect(edgeLabelParts(mode, '', '').protocol).toBe('');
        }
    });

    it('чужое значение в хранилище не проходит за режим', () => {
        for (const mode of EDGE_LABEL_MODES) expect(isEdgeLabelMode(mode)).toBe(true);

        for (const junk of ['all', 'true', '', null, undefined, 1, {}]) {
            expect(isEdgeLabelMode(junk), String(junk)).toBe(false);
        }
    });
});

describe('название типа нагрузки на линии', () => {
    it('ключ адресует словарь common, а не params', () => {
        expect(protocolLabelKey('http')).toBe('common:protocol.http');
        expect(PROTOCOL_NAMESPACE).toBe('common');

        for (const dictionary of [ruParams, enParams]) {
            expect(dictionary).not.toHaveProperty('protocol');
        }
    });

    it('каждый протокол каталога назван на обоих языках', () => {
        const protocols = catalogProtocols();
        expect(protocols.length).toBeGreaterThan(10);

        const missing: string[] = [];

        for (const protocol of protocols) {
            if (typeof ruCommon.protocol[protocol] !== 'string') missing.push(`ru: ${protocol}`);
            if (typeof enCommon.protocol[protocol] !== 'string') missing.push(`en: ${protocol}`);
        }

        expect(missing).toEqual([]);
    });

    it('линия берёт название через ключ с пространством имён', () => {
        expect(trafficEdgeSource).toContain('protocolLabelKey');
        expect(trafficEdgeSource).toContain("useTranslation(['params', 'common'])");
        expect(trafficEdgeSource).not.toContain('t(`protocol.');
    });

    it('название читается человеком, а не ключом', () => {
        expect(ruCommon.protocol.http).toBe('HTTP');
        expect(enCommon.protocol.grpc).toBe('gRPC');

        for (const name of Object.values(enCommon.protocol)) {
            expect(name).not.toContain('protocol.');
        }
    });
});
