import { describe, expect, it } from 'vitest';
import en from '../../src/locales/en/common.json';
import ru from '../../src/locales/ru/common.json';
import {
    currentStep,
    isFinished,
    isGoalReached,
    startProgress,
    TUTORIAL_STEPS,
    tutorialReducer,
} from '../../src/components/tutorial/tutorialSteps';
import type { TutorialProgress, TutorialSnapshot } from '../../src/components/tutorial/tutorialSteps';

const EMPTY: TutorialSnapshot = { nodeCount: 0, edgeCount: 0, selectionKey: '', anchorClicks: 0 };

function stepIndex(id: string): number {
    return TUTORIAL_STEPS.findIndex((step) => step.id === id);
}

function progressAt(id: string, baseline: TutorialSnapshot = EMPTY): TutorialProgress {
    return { index: stepIndex(id), baseline };
}

function observe(progress: TutorialProgress, snapshot: TutorialSnapshot): TutorialProgress {
    return tutorialReducer(progress, { kind: 'observe', snapshot });
}

describe('шаги туториала', () => {
    it('ведут от палитры к находкам без повторов', () => {
        expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
            'welcome',
            'client',
            'service',
            'connect',
            'dashboard',
            'boundBy',
            'findings',
            'done',
        ]);
    });

    it('требуют действия больше чем в половине шагов', () => {
        const interactive = TUTORIAL_STEPS.filter((step) => step.goal !== 'next');
        expect(interactive.length).toBeGreaterThan(TUTORIAL_STEPS.length / 2);
    });

    it('переведены на оба языка', () => {
        for (const step of TUTORIAL_STEPS) {
            expect(ru.tutorial.step).toHaveProperty(`${step.id}.title`);
            expect(ru.tutorial.step).toHaveProperty(`${step.id}.text`);
            expect(en.tutorial.step).toHaveProperty(`${step.id}.title`);
            expect(en.tutorial.step).toHaveProperty(`${step.id}.text`);
        }
    });
});

describe('цель шага', () => {
    it('засчитывает только новый блок, связь, выделение и клик', () => {
        expect(isGoalReached('nodeAdded', EMPTY, { ...EMPTY, nodeCount: 1 })).toBe(true);
        expect(isGoalReached('nodeAdded', { ...EMPTY, nodeCount: 4 }, { ...EMPTY, nodeCount: 4 })).toBe(false);

        expect(isGoalReached('edgeAdded', EMPTY, { ...EMPTY, edgeCount: 1 })).toBe(true);
        expect(isGoalReached('edgeAdded', { ...EMPTY, edgeCount: 2 }, { ...EMPTY, edgeCount: 1 })).toBe(false);

        expect(isGoalReached('nodeSelected', EMPTY, { ...EMPTY, selectionKey: 'service-1' })).toBe(true);
        expect(isGoalReached('nodeSelected', { ...EMPTY, selectionKey: 'service-1' }, EMPTY)).toBe(false);

        expect(isGoalReached('anchorClicked', EMPTY, { ...EMPTY, anchorClicks: 1 })).toBe(true);
    });

    it('никогда не срабатывает сама у шага-объяснения', () => {
        expect(isGoalReached('next', EMPTY, { nodeCount: 9, edgeCount: 9, selectionKey: 'x', anchorClicks: 9 })).toBe(
            false,
        );
    });
});

describe('прогресс туториала', () => {
    it('стартует с первого шага и запоминает состояние схемы', () => {
        const started = startProgress({ ...EMPTY, nodeCount: 3 });

        expect(started.index).toBe(0);
        expect(started.baseline.nodeCount).toBe(3);
        expect(currentStep(started)?.id).toBe('welcome');
    });

    it('не двигает шаг-объяснение без нажатия', () => {
        const progress = startProgress(EMPTY);

        expect(observe(progress, { ...EMPTY, nodeCount: 5 })).toBe(progress);
        expect(tutorialReducer(progress, { kind: 'advance', snapshot: EMPTY }).index).toBe(1);
    });

    it('сам переходит дальше, когда пользователь добавил блок', () => {
        const progress = progressAt('client');

        expect(observe(progress, EMPTY)).toBe(progress);
        expect(currentStep(observe(progress, { ...EMPTY, nodeCount: 1 }))?.id).toBe('service');
    });

    it('считает действия от состояния на входе в шаг, а не от пустой схемы', () => {
        const withScheme: TutorialSnapshot = { ...EMPTY, nodeCount: 6, edgeCount: 4 };
        const progress = progressAt('client', withScheme);

        expect(observe(progress, withScheme)).toBe(progress);
        expect(currentStep(observe(progress, { ...withScheme, nodeCount: 7 }))?.id).toBe('service');
    });

    it('переносит точку отсчёта на каждом переходе', () => {
        const first = observe(progressAt('client'), { ...EMPTY, nodeCount: 1 });
        expect(first.baseline.nodeCount).toBe(1);

        expect(observe(first, { ...EMPTY, nodeCount: 1 })).toBe(first);
        expect(currentStep(observe(first, { ...EMPTY, nodeCount: 2 }))?.id).toBe('connect');
    });

    it('пропуск шага двигает дальше, даже если действие не сделано', () => {
        const skipped = tutorialReducer(progressAt('connect'), { kind: 'advance', snapshot: EMPTY });
        expect(currentStep(skipped)?.id).toBe('dashboard');
    });

    it('заканчивается после последнего шага и больше не двигается', () => {
        const last = progressAt('done');
        const finished = tutorialReducer(last, { kind: 'advance', snapshot: EMPTY });

        expect(isFinished(last)).toBe(false);
        expect(isFinished(finished)).toBe(true);
        expect(currentStep(finished)).toBeNull();
        expect(tutorialReducer(finished, { kind: 'advance', snapshot: EMPTY })).toBe(finished);
    });

    it('перезапуск возвращает на первый шаг', () => {
        const restarted = tutorialReducer(progressAt('findings'), { kind: 'restart', snapshot: EMPTY });
        expect(currentStep(restarted)?.id).toBe('welcome');
    });
});
