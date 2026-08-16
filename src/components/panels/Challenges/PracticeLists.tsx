import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';
import Stars from './Stars';
import { GOLF_TASKS, INCIDENTS, INTERVIEWS } from '../../../data/practice';
import type { ChallengeRef } from '../../../data/practice';
import type { LocalizedText } from '../../../engine/challenges/types';
import type { PracticeRecord } from '../../../engine/practice/types';
import type { AuthoredChallenge } from '../../../services/authoredChallenges';
import type { EarnedProgress } from '../../../store/challengeStore';
import { formatClock, formatNumber } from '../../../utils/format';

export interface PracticeListProps {
    localized: (text: LocalizedText) => string;
    records: Record<string, PracticeRecord>;
    earned: (ref: ChallengeRef) => EarnedProgress;
    onOpen: (ref: ChallengeRef) => void;
}

function RecordLine({ record }: { record: PracticeRecord | undefined }) {
    const { t } = useTranslation();
    if (!record || record.attempts === 0) return null;

    return (
        <div className="chl-card-meta">
            <span className={record.solved ? 'chl-tone-ok' : 'chl-tone-hot'}>
                {record.solved ? t('practice.solved') : t('practice.notSolved')}
            </span>
            <span>{t('challenge.attempts', { value: record.attempts })}</span>
            {record.bestSeconds !== null && <span>{t('practice.bestTime', { value: formatClock(record.bestSeconds) })}</span>}
            {record.bestCostUsd !== null && (
                <span>{t('practice.bestCost', { value: formatNumber(record.bestCostUsd) })}</span>
            )}
        </div>
    );
}

function StartButton({ onClick }: { onClick: () => void }) {
    const { t } = useTranslation();

    return (
        <button type="button" className="chl-btn chl-btn-primary" onClick={onClick} title={t('challenge.startHint')}>
            <Icon name="play_arrow" size="small" />
            <span>{t('challenge.start')}</span>
        </button>
    );
}

export function InterviewList({ localized, records, earned, onOpen }: PracticeListProps) {
    const { t } = useTranslation();

    return (
        <div className="chl-body">
            <p className="chl-brief">{t('practice.interviewIntro')}</p>
            {INTERVIEWS.map((session) => {
                const ref: ChallengeRef = { kind: 'interview', sessionId: session.id, stage: 0 };

                return (
                    <article key={session.id} className="chl-card">
                        <div className="chl-card-head">
                            <span className="chl-card-name">{localized(session.title)}</span>
                            <Stars value={earned(ref).stars} />
                        </div>
                        <div className="chl-card-meta">
                            <span>{t('challenge.minutes', { value: session.durationMinutes })}</span>
                            <span>{t('practice.stages', { value: session.stages.length })}</span>
                        </div>
                        <p className="chl-solution-tradeoff">{localized(session.brief)}</p>
                        <RecordLine record={records[session.id]} />
                        <StartButton onClick={() => onOpen(ref)} />
                    </article>
                );
            })}
        </div>
    );
}

export function IncidentList({ localized, records, earned, onOpen }: PracticeListProps) {
    const { t } = useTranslation();

    return (
        <div className="chl-body">
            <p className="chl-brief">{t('practice.incidentIntro')}</p>
            {INCIDENTS.map((incident) => {
                const ref: ChallengeRef = { kind: 'incident', caseId: incident.id };

                return (
                    <article key={incident.id} className="chl-card">
                        <div className="chl-card-head">
                            <span className="chl-card-name">{localized(incident.title)}</span>
                            <Stars value={earned(ref).stars} />
                        </div>
                        <div className="chl-card-meta">
                            <span>{t('challenge.minutes', { value: incident.timeLimitMinutes })}</span>
                        </div>
                        <p className="chl-solution-tradeoff">{localized(incident.symptom)}</p>
                        <RecordLine record={records[incident.id]} />
                        <StartButton onClick={() => onOpen(ref)} />
                    </article>
                );
            })}
        </div>
    );
}

export function GolfList({ localized, records, earned, onOpen }: PracticeListProps) {
    const { t } = useTranslation();

    return (
        <div className="chl-body">
            <p className="chl-brief">{t('practice.golfIntro')}</p>
            {GOLF_TASKS.map((task) => {
                const ref: ChallengeRef = { kind: 'golf', taskId: task.id };

                return (
                    <article key={task.id} className="chl-card">
                        <div className="chl-card-head">
                            <span className="chl-card-name">{localized(task.title)}</span>
                            <Stars value={earned(ref).stars} />
                        </div>
                        <div className="chl-card-meta">
                            <span>{t('practice.par', { value: formatNumber(task.parUsdMonth) })}</span>
                        </div>
                        <p className="chl-solution-tradeoff">{localized(task.brief)}</p>
                        <RecordLine record={records[task.id]} />
                        <StartButton onClick={() => onOpen(ref)} />
                    </article>
                );
            })}
        </div>
    );
}

export interface AuthoredListProps {
    items: AuthoredChallenge[];
    earned: (id: string) => EarnedProgress;
    onOpen: (item: AuthoredChallenge) => void;
    onEdit: (item: AuthoredChallenge | null) => void;
    onRemove: (item: AuthoredChallenge) => void;
}

export function AuthoredList({ items, earned, onOpen, onEdit, onRemove }: AuthoredListProps) {
    const { t } = useTranslation();

    return (
        <div className="chl-body">
            <p className="chl-brief">{t('practice.authoredIntro')}</p>

            <button type="button" className="chl-btn chl-btn-primary chl-btn-wide" onClick={() => onEdit(null)}>
                <Icon name="note_add" size="small" />
                <span>{t('authoring.create')}</span>
            </button>

            {items.length === 0 && <div className="chl-empty">{t('authoring.empty')}</div>}

            {items.map((item) => {
                const progress = earned(item.id);

                return (
                    <article key={item.id} className="chl-card">
                        <div className="chl-card-head">
                            <span className="chl-card-name">{item.title}</span>
                            <Stars value={progress.stars} />
                        </div>
                        <div className="chl-card-meta">
                            <span>{item.id}</span>
                            <span>{item.updatedAt.slice(0, 10)}</span>
                            {progress.attempts > 0 && (
                                <span>{t('challenge.attempts', { value: progress.attempts })}</span>
                            )}
                        </div>
                        <div className="chl-authored-actions">
                            <StartButton onClick={() => onOpen(item)} />
                            <button type="button" className="chl-btn" onClick={() => onEdit(item)}>
                                <Icon name="edit" size="small" />
                                <span>{t('authoring.edit')}</span>
                            </button>
                            <button type="button" className="chl-btn" onClick={() => onRemove(item)}>
                                <Icon name="delete" size="small" />
                                <span>{t('authoring.remove')}</span>
                            </button>
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
