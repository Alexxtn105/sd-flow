import { challengeById } from '../challenges';
import { challengeFromSpec } from '../../engine/authoring/spec';
import type { ChallengeSpec } from '../../engine/authoring/spec';
import { challengeForGolf, challengeForIncident, challengeForInterview } from '../../engine/practice/derive';
import type { Challenge } from '../../engine/challenges/types';
import { GOLF_TASKS, golfById } from './golf';
import { INCIDENTS, incidentById } from './incidents';
import { INTERVIEWS, interviewById } from './interviews';

export { GOLF_TASKS, golfById } from './golf';
export { INCIDENTS, incidentById } from './incidents';
export { INTERVIEWS, interviewById } from './interviews';

export type ChallengeRef =
    | { kind: 'catalog'; challengeId: string }
    | { kind: 'interview'; sessionId: string; stage: number }
    | { kind: 'incident'; caseId: string }
    | { kind: 'golf'; taskId: string }
    | { kind: 'authored'; spec: ChallengeSpec };

function baseOf(challengeId: string): Challenge {
    const base = challengeById(challengeId);
    if (!base) throw new Error(`Нет задания ${challengeId}`);

    return base;
}

export function resolveChallenge(ref: ChallengeRef): Challenge {
    if (ref.kind === 'catalog') return baseOf(ref.challengeId);

    if (ref.kind === 'interview') {
        const session = interviewById(ref.sessionId);
        if (!session) throw new Error(`Нет сессии ${ref.sessionId}`);

        return challengeForInterview(baseOf(session.challengeId), session, ref.stage);
    }

    if (ref.kind === 'incident') {
        const incident = incidentById(ref.caseId);
        if (!incident) throw new Error(`Нет инцидента ${ref.caseId}`);

        return challengeForIncident(baseOf(incident.challengeId), incident);
    }

    if (ref.kind === 'golf') {
        const task = golfById(ref.taskId);
        if (!task) throw new Error(`Нет задачи ${ref.taskId}`);

        return challengeForGolf(baseOf(task.challengeId), task);
    }

    return challengeFromSpec(ref.spec);
}

export function authoredKey(id: string): string {
    return `authored:${id}`;
}

export function refKey(ref: ChallengeRef): string {
    if (ref.kind === 'catalog') return ref.challengeId;
    if (ref.kind === 'interview') return ref.sessionId;
    if (ref.kind === 'incident') return ref.caseId;
    if (ref.kind === 'golf') return ref.taskId;

    return authoredKey(ref.spec.id);
}

export const PRACTICE_COUNTS = {
    interview: INTERVIEWS.length,
    incident: INCIDENTS.length,
    golf: GOLF_TASKS.length,
};
