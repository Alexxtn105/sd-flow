import { beforeAll, describe, expect, it, vi } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { buildScheme } from '../helpers/scheme';

interface PostedMessage {
    id: number;
    kind: string;
}

class FakeWorker {
    static instances: FakeWorker[] = [];

    posted: PostedMessage[] = [];
    terminated = false;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
        FakeWorker.instances.push(this);
    }

    postMessage(message: PostedMessage): void {
        this.posted.push(message);
    }

    terminate(): void {
        this.terminated = true;
    }
}

vi.stubGlobal('Worker', FakeWorker);

beforeAll(() => {
    registry.reset();
    initComponents();
});

function pair() {
    return buildScheme({
        nodes: [
            { id: 'client', type: 'client-web' },
            { id: 'svc', type: 'service' },
        ],
        links: [{ from: 'client', to: 'svc' }],
    });
}

function request(sampleCount: number) {
    return { scheme: pair(), scenario: 'baseline', sampleCount };
}

describe('расчёт в воркере', () => {
    it('отменяет устаревший расчёт, а не ждёт его конца', async () => {
        const { runSimulation, SUPERSEDED } = await import('../../src/services/simulationService');

        const stale = runSimulation(request(1000));
        const first = FakeWorker.instances.at(-1);
        expect(first?.posted).toHaveLength(1);

        const fresh = runSimulation(request(2000));

        await expect(stale).rejects.toThrow(SUPERSEDED);
        expect(first?.terminated).toBe(true);

        const second = FakeWorker.instances.at(-1);
        expect(second).not.toBe(first);
        expect(second?.posted).toHaveLength(1);

        const posted = second?.posted[0];
        second?.onmessage?.({ data: { id: posted?.id, payload: { scenario: 'baseline' } } });

        await expect(fresh).resolves.toMatchObject({ scenario: 'baseline' });
    });

    it('переносит чужие запросы на новый воркер вместо потери', async () => {
        const { runAcceptance, runSimulation, SUPERSEDED } = await import(
            '../../src/services/simulationService'
        );

        const acceptance = runAcceptance({
            ref: { kind: 'catalog', challengeId: 'url-shortener' },
            scheme: pair(),
            attempt: 1,
            hintsUsed: [],
        });
        const stale = runSimulation(request(1000));
        const before = FakeWorker.instances.at(-1);
        expect(before?.posted.map((message) => message.kind).slice(-2)).toEqual(['accept', 'simulate']);

        runSimulation(request(2000)).catch(() => undefined);
        await expect(stale).rejects.toThrow(SUPERSEDED);

        const after = FakeWorker.instances.at(-1);
        const moved = after?.posted.find((message) => message.kind === 'accept');
        expect(moved).toBeDefined();

        after?.onmessage?.({ data: { id: moved?.id, payload: { stars: 0 } } });
        await expect(acceptance).resolves.toMatchObject({ stars: 0 });
    });
});
