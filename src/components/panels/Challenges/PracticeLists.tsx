import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';
import { GOLF_TASKS, INCIDENTS, INTERVIEWS } from '../../../data/practice';
import type { ChallengeRef } from '../../../data/practice';
import type { LocalizedText } from '../../../engine/challenges/types';
import type { PracticeRecord } from '../../../engine/practice/types';
import type { AuthoredChallenge } from '../../../services/authoredChallenges';
import { formatClock, formatNumber } from '../../../utils/format';

export interface PracticeListProps {
    localized: (text: LocalizedText) => string;
    records: Record<string, PracticeRecord>;
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

export function InterviewList({ localized, records, onOpen }: PracticeListProps) {
    const { t } = useTranslation();

    return (
        <div className="chl-body">
            <p className="chl-brief">{t('practice.interviewIntro')}</p>
            {INTERVIEWS.map((session) => (
                <article key={session.id} className="chl-card">
                    <div className="chl-card-head">
                        <span className="chl-card-name">{localized(session.title)}</span>
                    </div>
                    <div className="chl-card-meta">
                        <span>{t('challenge.minutes', { value: session.durationMinutes })}</span>
                        <span>{t('practice.stages', { value: session.stages.length })}</span>
                    </div>
                    <p className="chl-solution-tradeoff">{localized(session.brief)}</p>
                    <RecordLine record={records[session.id]} />
                    <StartButton onClick={() => onOpen({ kind: 'interview', sessionId: session.id, stage: 0 })} />
                </article>
            ))}
        </div>
    );
}

export function IncidentList({ localized, records, onOpen }: PracticeListProps) {
    const { t } = useTranslation();

    return (
        <div className="chl-body">
            <p className="chl-brief">{t('practice.incidentIntro')}</p>
            {INCIDENTS.map((incident) => (
                <article key={incident.id} className="chl-card">
                    <div className="chl-card-head">
                        <span className="chl-card-name">{localized(incident.title)}</span>
                    </div>
                    <div className="chl-card-meta">
                        <span>{t('challenge.minutes', { value: incident.timeLimitMinutes })}</span>
                    </div>
                    <p className="chl-solution-tradeoff">{localized(incident.symptom)}</p>
                    <RecordLine record={records[incident.id]} />
                    <StartButton onClick={() => onOpen({ kind: 'incident', caseId: incident.id })} />
                </article>
            ))}
        </div>
    );
}

export function GolfList({ localized, records, onOpen }: PracticeListProps) {
    const { t } = useTranslation();

    return (
        <div className="chl-body">
            <p className="chl-brief">{t('practice.golfIntro')}</p>
            {GOLF_TASKS.map((task) => (
                <article key={task.id} className="chl-card">
                    <div className="chl-card-head">
                        <span className="chl-card-name">{localized(task.title)}</span>
                    </div>
                    <div className="chl-card-meta">
                        <span>{t('practice.par', { value: formatNumber(task.parUsdMonth) })}</span>
                    </div>
                    <p className="chl-solution-tradeoff">{localized(task.brief)}</p>
                    <RecordLine record={records[task.id]} />
                    <StartButton onClick={() => onOpen({ kind: 'golf', taskId: task.id })} />
                </article>
            ))}
        </div>
    );
}

export interface AuthoredListProps {
    items: AuthoredChallenge[];
    onOpen: (item: AuthoredChallenge) => void;
    onEdit: (item: AuthoredChallenge | null) => void;
    onRemove: (item: AuthoredChallenge) => void;
}

export function AuthoredList({ items, onOpen, onEdit, onRemove }: AuthoredListProps) {
    const { t } = useTranslation();

    return (
        <div className="chl-body">
            <p className="chl-brief">{t('practice.authoredIntro')}</p>

            <button type="button" className="chl-btn chl-btn-primary chl-btn-wide" onClick={() => onEdit(null)}>
                <Icon name="note_add" size="small" />
                <span>{t('authoring.create')}</span>
            </button>

            {items.length === 0 && <div className="chl-empty">{t('authoring.empty')}</div>}

            {items.map((item) => (
                <article key={item.id} className="chl-card">
                    <div className="chl-card-head">
                        <span className="chl-card-name">{item.title}</span>
                    </div>
                    <div className="chl-card-meta">
                        <span>{item.id}</span>
                        <span>{item.updatedAt.slice(0, 10)}</span>
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
            ))}
        </div>
    );
}
