import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import { useGraphStore } from '../../store/graphStore';
import { useSimStore } from '../../store/simStore';
import { useUiStore } from '../../store/uiStore';
import { currentStep, isFinished, startProgress, TUTORIAL_STEPS, tutorialReducer } from './tutorialSteps';
import type { TutorialSnapshot } from './tutorialSteps';
import './Tutorial.css';

interface AnchorRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface CardBox {
    width: number;
    height: number;
}

const ANCHOR_POLL_MS = 200;
const SPOTLIGHT_PADDING = 6;
const CARD_GAP = 14;
const VIEWPORT_MARGIN = 12;
const CARD_FALLBACK: CardBox = { width: 320, height: 180 };

function findAnchor(selectors: string[]): HTMLElement | null {
    for (const selector of selectors) {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) continue;

        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) return element;
    }

    return null;
}

function sameRect(left: AnchorRect | null, right: AnchorRect | null): boolean {
    if (left === null || right === null) return left === right;
    return (
        Math.round(left.left) === Math.round(right.left) &&
        Math.round(left.top) === Math.round(right.top) &&
        Math.round(left.width) === Math.round(right.width) &&
        Math.round(left.height) === Math.round(right.height)
    );
}

function fit(value: number, size: number, limit: number): number {
    return Math.max(VIEWPORT_MARGIN, Math.min(value, limit - size - VIEWPORT_MARGIN));
}

function placeCard(rect: AnchorRect, card: CardBox): { left: number; top: number } {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const needWidth = card.width + CARD_GAP + VIEWPORT_MARGIN;
    const needHeight = card.height + CARD_GAP + VIEWPORT_MARGIN;

    if (viewportWidth - right >= needWidth) {
        return { left: right + CARD_GAP, top: fit(rect.top, card.height, viewportHeight) };
    }

    if (rect.left >= needWidth) {
        return { left: rect.left - card.width - CARD_GAP, top: fit(rect.top, card.height, viewportHeight) };
    }

    if (viewportHeight - bottom >= needHeight) {
        return { left: fit(rect.left, card.width, viewportWidth), top: bottom + CARD_GAP };
    }

    if (rect.top >= needHeight) {
        return { left: fit(rect.left, card.width, viewportWidth), top: rect.top - card.height - CARD_GAP };
    }

    return {
        left: fit(rect.left, card.width, viewportWidth),
        top: fit(bottom + CARD_GAP, card.height, viewportHeight),
    };
}

export default function Tutorial() {
    const { t } = useTranslation();

    const nodeCount = useGraphStore((state) => state.nodes.length);
    const edgeCount = useGraphStore((state) => state.edges.length);
    const selectionKey = useUiStore((state) => state.selectedNodeIds.join(','));
    const togglePalette = useUiStore((state) => state.togglePalette);
    const setMode = useUiStore((state) => state.setMode);
    const finishTutorial = useUiStore((state) => state.finishTutorial);
    const toggleDashboard = useSimStore((state) => state.toggleDashboard);

    const [anchorClicks, setAnchorClicks] = useState(0);
    const [rect, setRect] = useState<AnchorRect | null>(null);
    const [card, setCard] = useState<CardBox>(CARD_FALLBACK);
    const anchorRef = useRef<HTMLElement | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const revealedStep = useRef<string | null>(null);

    const snapshot = useMemo<TutorialSnapshot>(
        () => ({ nodeCount, edgeCount, selectionKey, anchorClicks }),
        [anchorClicks, edgeCount, nodeCount, selectionKey],
    );

    const [progress, dispatch] = useReducer(tutorialReducer, snapshot, startProgress);

    const step = currentStep(progress);
    const anchorKey = step ? step.anchors.join('|') : '';

    useEffect(() => {
        dispatch({ kind: 'observe', snapshot });
    }, [snapshot]);

    useEffect(() => {
        if (isFinished(progress)) finishTutorial();
    }, [finishTutorial, progress]);

    useEffect(() => {
        if (!step || revealedStep.current === step.id) return;
        revealedStep.current = step.id;

        if (step.reveal === 'palette' && useUiStore.getState().paletteCollapsed) togglePalette();
        if (step.reveal === 'dashboard' && !useSimStore.getState().dashboardOpen) toggleDashboard();
    }, [step, toggleDashboard, togglePalette]);

    useEffect(() => {
        const selectors = anchorKey === '' ? [] : anchorKey.split('|');

        const measure = () => {
            const element = selectors.length > 0 ? findAnchor(selectors) : null;
            anchorRef.current = element;

            const box = element?.getBoundingClientRect() ?? null;
            const next = box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
            setRect((previous) => (sameRect(previous, next) ? previous : next));
        };

        measure();
        if (selectors.length === 0) return;

        const timer = window.setInterval(measure, ANCHOR_POLL_MS);
        window.addEventListener('resize', measure);

        return () => {
            window.clearInterval(timer);
            window.removeEventListener('resize', measure);
        };
    }, [anchorKey]);

    useEffect(() => {
        const handler = (event: MouseEvent) => {
            const element = anchorRef.current;
            if (element && event.target instanceof Node && element.contains(event.target)) {
                setAnchorClicks((value) => value + 1);
            }
        };

        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    const close = useCallback(() => finishTutorial(), [finishTutorial]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (document.body.classList.contains('dialog-open')) return;
            close();
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [close]);

    useEffect(() => {
        const previous = document.activeElement;
        return () => {
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        };
    }, []);

    useEffect(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
        cardRef.current?.focus();
    }, [progress.index]);

    useLayoutEffect(() => {
        const element = cardRef.current;
        if (!element) return;

        const box = element.getBoundingClientRect();
        setCard((previous) =>
            Math.abs(previous.width - box.width) < 1 && Math.abs(previous.height - box.height) < 1
                ? previous
                : { width: box.width, height: box.height },
        );
    }, [progress.index]);

    if (!step) return null;

    const position = rect ? placeCard(rect, card) : null;
    const last = progress.index === TUTORIAL_STEPS.length - 1;
    const advance = () => dispatch({ kind: 'advance', snapshot });
    const primaryLabel = t(last ? 'tutorial.finish' : step.goal === 'next' ? 'tutorial.next' : 'tutorial.skip');

    return (
        <div className="tut">
            {rect ? (
                <div
                    className="tut-spotlight"
                    aria-hidden="true"
                    style={{
                        left: rect.left - SPOTLIGHT_PADDING,
                        top: rect.top - SPOTLIGHT_PADDING,
                        width: rect.width + SPOTLIGHT_PADDING * 2,
                        height: rect.height + SPOTLIGHT_PADDING * 2,
                    }}
                />
            ) : (
                <div className="tut-backdrop" aria-hidden="true" />
            )}

            <div
                ref={cardRef}
                className={`tut-card ${position ? '' : 'tut-card-centered'}`}
                style={position ?? undefined}
                role="dialog"
                aria-label={t('tutorial.title')}
                tabIndex={-1}
            >
                <div className="tut-head">
                    <span className="tut-counter">
                        {t('tutorial.progress', { current: progress.index + 1, total: TUTORIAL_STEPS.length })}
                    </span>
                    <span className="tut-title">{t(`tutorial.step.${step.id}.title`)}</span>
                    <button
                        className="tut-close"
                        onClick={close}
                        title={t('tutorial.close')}
                        aria-label={t('tutorial.close')}
                    >
                        <Icon name="close" size="small" />
                    </button>
                </div>

                <div className="tut-body" aria-live="polite">
                    <p className="tut-text">{t(`tutorial.step.${step.id}.text`)}</p>
                    {step.goal !== 'next' && <p className="tut-waiting">{t('tutorial.waiting')}</p>}
                </div>

                <div className="tut-foot">
                    {last && (
                        <button
                            className="tut-btn"
                            onClick={() => {
                                setMode('challenges');
                                close();
                            }}
                            aria-label={t('tutorial.challenges')}
                        >
                            {t('tutorial.challenges')}
                        </button>
                    )}
                    <button
                        className="tut-btn tut-btn-primary"
                        onClick={last ? close : advance}
                        aria-label={primaryLabel}
                    >
                        {primaryLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
