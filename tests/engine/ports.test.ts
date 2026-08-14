import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import { canConnectTypes, firstCompatiblePair, isConnectionAllowed } from '../../src/engine/ports';

beforeAll(() => {
    initComponents();
});

describe('совместимость портов', () => {
    it('разрешает типовой путь запроса', () => {
        expect(canConnectTypes('client-web', 'lb-l7')).toBe(true);
        expect(canConnectTypes('lb-l7', 'service')).toBe(true);
        expect(canConnectTypes('service', 'postgres')).toBe(true);
        expect(canConnectTypes('service', 'redis')).toBe(true);
        expect(canConnectTypes('service', 'kafka')).toBe(true);
        expect(canConnectTypes('service', 's3')).toBe(true);
    });

    it('запрещает брокеру вызывать балансировщик', () => {
        expect(canConnectTypes('kafka', 'lb-l7')).toBe(false);
    });

    it('запрещает клиенту ходить в базу напрямую', () => {
        expect(canConnectTypes('client-web', 'postgres')).toBe(false);
    });

    it('разрешает консьюмеру читать из брокера', () => {
        expect(canConnectTypes('kafka', 'worker')).toBe(true);
    });

    it('разрешает репликацию между однотипными хранилищами', () => {
        const pair = firstCompatiblePair('postgres', 'postgres');
        expect(pair?.sourceHandle).toBe('replication');
        expect(pair?.protocol).toBe('sql');
    });

    it('проверяет конкретную пару портов, а не только типы', () => {
        expect(isConnectionAllowed('postgres', 'cdc', 'kafka', 'produce')).toBe(true);
        expect(isConnectionAllowed('postgres', 'cdc', 'redis', 'ops')).toBe(false);
        expect(isConnectionAllowed('service', 'unknown-port', 'postgres', 'sql')).toBe(false);
    });
});
