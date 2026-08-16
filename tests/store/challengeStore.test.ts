import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { authoredKey, INTERVIEWS, INCIDENTS, GOLF_TASKS } from '../../src/data/practice';
import type { ChallengeSpec } from '../../src/engine/authoring/spec';
import type { ChallengeProgress } from '../../src/engine/challenges/types';
import type { PracticeRecord } from '../../src/engine/practice/types';
import { earnedProgress, earnedProgressByKey, useChallengeStore } from '../../src/store/challengeStore';
import type { ProgressSources } from '../../src/store/challengeStore';
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

describe('звёзды и попытки за задание', () => {
    function scored(key: string, stars: ChallengeProgress['stars'], attempts: number): Record<string, ChallengeProgress> {
        return { [key]: { challengeId: key, stars, attempts, hintsUsed: [], bestScore: 0 } };
    }

    function played(key: string, bestStars: PracticeRecord['bestStars'], attempts: number): Record<string, PracticeRecord> {
        return {
            [key]: { id: key, attempts, solved: bestStars > 0, bestSeconds: null, bestCostUsd: null, bestStars },
        };
    }

    function sources(
        progress: Record<string, ChallengeProgress> = {},
        practice: Record<string, PracticeRecord> = {},
    ): ProgressSources {
        return { progress, practice };
    }

    it('у задания каталога берутся из прогресса заданий', () => {
        const earned = earnedProgress(sources(scored('url-shortener', 2, 3)), {
            kind: 'catalog',
            challengeId: 'url-shortener',
        });

        expect(earned).toEqual({ stars: 2, attempts: 3 });
    });

    it('у наборов практики находятся по их собственным ключам', () => {
        const golf = GOLF_TASKS[0].id;
        const incident = INCIDENTS[0].id;
        const interview = INTERVIEWS[0].id;
        const state = sources({}, { ...played(golf, 3, 1), ...played(incident, 2, 4), ...played(interview, 1, 2) });

        expect(earnedProgress(state, { kind: 'golf', taskId: golf })).toEqual({ stars: 3, attempts: 1 });
        expect(earnedProgress(state, { kind: 'incident', caseId: incident })).toEqual({ stars: 2, attempts: 4 });
        expect(earnedProgress(state, { kind: 'interview', sessionId: interview, stage: 0 })).toEqual({
            stars: 1,
            attempts: 2,
        });
    });

    it('этап интервью не заводит отдельный счёт', () => {
        const state = sources({}, played(INTERVIEWS[0].id, 3, 5));
        const last = INTERVIEWS[0].stages.length - 1;

        expect(earnedProgress(state, { kind: 'interview', sessionId: INTERVIEWS[0].id, stage: last }).stars).toBe(3);
    });

    it('у своего задания ключ отделён префиксом', () => {
        const state = sources(scored(authoredKey('my-task'), 3, 2));

        expect(authoredKey('my-task')).not.toBe('my-task');
        expect(earnedProgressByKey(state, authoredKey('my-task'))).toEqual({ stars: 3, attempts: 2 });
        expect(earnedProgress(state, { kind: 'authored', spec: { id: 'my-task' } as ChallengeSpec }).stars).toBe(3);
    });

    it('из двух источников берётся лучший результат', () => {
        const golf = GOLF_TASKS[0].id;
        const state = sources(scored(golf, 1, 7), played(golf, 3, 2));

        expect(earnedProgress(state, { kind: 'golf', taskId: golf })).toEqual({ stars: 3, attempts: 7 });
    });

    it('без записи задание показывает пустой результат', () => {
        expect(earnedProgress(sources(), { kind: 'catalog', challengeId: 'url-shortener' })).toEqual({
            stars: 0,
            attempts: 0,
        });
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
