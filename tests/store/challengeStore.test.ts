import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { INTERVIEWS, INCIDENTS, GOLF_TASKS } from '../../src/data/practice';
import { useChallengeStore } from '../../src/store/challengeStore';
import { useGraphStore } from '../../src/store/graphStore';

const SECONDS_PER_MINUTE = 60;

const SESSION = INTERVIEWS.find((item) => item.stages.some((stage) => stage.scale !== null))!;
const SCALED_STAGE = SESSION.stages.findIndex((stage) => stage.scale !== null);

function paramsOf(nodeId: string): Record<string, unknown> {
    const node = useGraphStore.getState().nodes.find((item) => item.id === nodeId);
    if (!node) throw new Error(`нет узла ${nodeId} на холсте`);

    return node.data.params;
}

function advanceTo(minute: number): void {
    const session = useChallengeStore.getState().session;
    if (!session) throw new Error('сессия не запущена');

    useChallengeStore.setState({
        session: { ...session, startedAt: Date.now() - minute * SECONDS_PER_MINUTE * 1000 },
    });
    useChallengeStore.getState().tick();
}

beforeAll(() => {
    registry.reset();
    initComponents();
});

beforeEach(() => {
    localStorage.clear();
    useChallengeStore.getState().close();
    useGraphStore.getState().clear();
});

describe('запуск задания из стора', () => {
    it('подставляет стартовую схему и заводит таймер для сессии с ограничением', () => {
        useChallengeStore.getState().open({ kind: 'interview', sessionId: SESSION.id, stage: 0 });

        const state = useChallengeStore.getState();

        expect(state.active?.id).toBe(SESSION.id);
        expect(useGraphStore.getState().nodes.length).toBeGreaterThan(0);
        expect(state.session?.limitSec).toBe(SESSION.durationMinutes * SECONDS_PER_MINUTE);
        expect(state.session?.stage).toBe(0);
        expect(state.session?.expired).toBe(false);
    });

    it('не заводит таймер там, где ограничения по времени нет', () => {
        useChallengeStore.getState().open({ kind: 'golf', taskId: GOLF_TASKS[0].id });

        expect(useChallengeStore.getState().session).toBeNull();
    });

    it('заводит таймер инцидента по его лимиту', () => {
        useChallengeStore.getState().open({ kind: 'incident', caseId: INCIDENTS[0].id });

        expect(useChallengeStore.getState().session?.limitSec).toBe(
            INCIDENTS[0].timeLimitMinutes * SECONDS_PER_MINUTE,
        );
    });
});

describe('ход интервью', () => {
    it('на назначенной минуте открывает следующий этап и правит схему на холсте', () => {
        useChallengeStore.getState().open({ kind: 'interview', sessionId: SESSION.id, stage: 0 });

        const stage = SESSION.stages[SCALED_STAGE];
        const scale = stage.scale!;
        const before = { ...paramsOf(scale.nodeId) };
        const requirementsBefore = useChallengeStore.getState().active!.requirements.length;

        advanceTo(stage.atMinute);

        const state = useChallengeStore.getState();

        expect(state.session?.stage).toBe(SCALED_STAGE);
        expect(state.active?.requirements.length).toBeGreaterThan(requirementsBefore);

        for (const [key, value] of Object.entries(scale.params)) {
            expect(before[key]).not.toBe(value);
            expect(paramsOf(scale.nodeId)[key]).toBe(value);
            expect(state.active?.lockedParams[scale.nodeId][key]).toBe(value);
        }
    });

    it('после исчерпания времени помечает сессию просроченной', () => {
        useChallengeStore.getState().open({ kind: 'interview', sessionId: SESSION.id, stage: 0 });

        advanceTo(SESSION.durationMinutes + 1);

        expect(useChallengeStore.getState().session?.expired).toBe(true);
    });

    it('перезапуск возвращает сессию на первый этап', () => {
        useChallengeStore.getState().open({ kind: 'interview', sessionId: SESSION.id, stage: 0 });
        advanceTo(SESSION.stages[SCALED_STAGE].atMinute);
        useChallengeStore.getState().restart();

        const state = useChallengeStore.getState();

        expect(state.session?.stage).toBe(0);
        expect(state.session?.expired).toBe(false);
        expect(state.ref).toEqual({ kind: 'interview', sessionId: SESSION.id, stage: 0 });
    });
});
