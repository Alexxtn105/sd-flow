export type TutorialGoal = 'next' | 'nodeAdded' | 'edgeAdded' | 'nodeSelected' | 'anchorClicked';

export type TutorialReveal = 'palette' | 'dashboard';

export interface TutorialStep {
    id: string;
    goal: TutorialGoal;
    anchors: string[];
    reveal?: TutorialReveal;
}

export interface TutorialSnapshot {
    nodeCount: number;
    edgeCount: number;
    selectionKey: string;
    anchorClicks: number;
}

export interface TutorialProgress {
    index: number;
    baseline: TutorialSnapshot;
}

export type TutorialAction =
    | { kind: 'restart'; snapshot: TutorialSnapshot }
    | { kind: 'advance'; snapshot: TutorialSnapshot }
    | { kind: 'observe'; snapshot: TutorialSnapshot };

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
    { id: 'welcome', goal: 'next', anchors: [] },
    { id: 'client', goal: 'nodeAdded', anchors: ['.pal'], reveal: 'palette' },
    { id: 'service', goal: 'nodeAdded', anchors: ['.pal'], reveal: 'palette' },
    { id: 'connect', goal: 'edgeAdded', anchors: ['.sd-editor'] },
    { id: 'dashboard', goal: 'next', anchors: ['.dash-section-wide', '.dash'], reveal: 'dashboard' },
    {
        id: 'boundBy',
        goal: 'nodeSelected',
        anchors: ['.react-flow__node:not([data-id^="client-"])', '.sd-node:not(.sd-node-clients)', '.sd-node'],
    },
    { id: 'findings', goal: 'anchorClicked', anchors: ['.dash-section-findings', '.dash'], reveal: 'dashboard' },
    { id: 'done', goal: 'next', anchors: [] },
];

function isNonClientSelection(selectionKey: string): boolean {
    return selectionKey
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .some((id) => !id.startsWith('client-'));
}

export function isGoalReached(goal: TutorialGoal, baseline: TutorialSnapshot, snapshot: TutorialSnapshot): boolean {
    switch (goal) {
        case 'nodeAdded':
            return snapshot.nodeCount > baseline.nodeCount;
        case 'edgeAdded':
            return snapshot.edgeCount > baseline.edgeCount;
        case 'nodeSelected':
            return isNonClientSelection(snapshot.selectionKey);
        case 'anchorClicked':
            return snapshot.anchorClicks > baseline.anchorClicks;
        default:
            return false;
    }
}

export function startProgress(snapshot: TutorialSnapshot): TutorialProgress {
    return { index: 0, baseline: snapshot };
}

export function currentStep(progress: TutorialProgress): TutorialStep | null {
    return TUTORIAL_STEPS[progress.index] ?? null;
}

export function isFinished(progress: TutorialProgress): boolean {
    return progress.index >= TUTORIAL_STEPS.length;
}

export function tutorialReducer(progress: TutorialProgress, action: TutorialAction): TutorialProgress {
    if (action.kind === 'restart') return startProgress(action.snapshot);

    const step = currentStep(progress);
    if (!step) return progress;

    if (action.kind === 'advance') return { index: progress.index + 1, baseline: action.snapshot };
    if (!isGoalReached(step.goal, progress.baseline, action.snapshot)) return progress;

    return { index: progress.index + 1, baseline: action.snapshot };
}