import { Fragment, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';
import ResizeHandle from '../../common/ResizeHandle/ResizeHandle';
import { AuthoredList, GolfList, IncidentList, InterviewList } from './PracticeLists';
import { CHALLENGES, challengesByLevel } from '../../../data/challenges';
import { golfById, incidentById, interviewById } from '../../../data/practice';
import { evaluateLive } from '../../../engine/challenges/accept';
import { golfMedal } from '../../../engine/practice/derive';
import { compileTopology } from '../../../engine/sim/compile';
import type {
    AxisScore,
    Challenge,
    ComparisonRow,
    LintHit,
    LocalizedText,
    Penalty,
    RealismViolation,
    ReferenceSolution,
    RequirementEvaluation,
    RequirementStatus,
    ScenarioRun,
    SolutionComparison,
} from '../../../engine/challenges/types';
import { parseChallengeSource } from '../../../services/authoredChallenges';
import type { AuthoredChallenge } from '../../../services/authoredChallenges';
import { removeAuthored } from '../../../services/authoredChallenges';
import { toScheme } from '../../../services/schemeSerializer';
import { useChallengeStore } from '../../../store/challengeStore';
import type { PracticeTrack } from '../../../store/challengeStore';
import { useGraphStore } from '../../../store/graphStore';
import { useSchemeStore } from '../../../store/schemeStore';
import { useSimStore } from '../../../store/simStore';
import { useUiStore } from '../../../store/uiStore';
import { formatClock, formatNumber } from '../../../utils/format';
import './ChallengePanel.css';

const STATUS_ICON: Record<RequirementStatus, string> = {
    met: 'check_circle',
    unmet: 'cancel',
    unknown: 'help_outline',
};

const STAR_SLOTS = [0, 1, 2];

const MAX_AXIS_SCORE = 100;

const AVAILABILITY_DIGITS = 4;

const LETTER_ALPHABET_SIZE = 26;

const TICK_MS = 1000;

const TRACKS: PracticeTrack[] = ['catalog', 'interview', 'incident', 'golf', 'authored'];

const DIRECTION_ARROW: Record<ComparisonRow['better'], string> = {
    lower: '↓',
    higher: '↑',
};

function pickLanguage(code: string): keyof LocalizedText {
    return code.startsWith('en') ? 'en' : 'ru';
}

function solutionLetter(index: number): string {
    if (index >= LETTER_ALPHABET_SIZE) return String(index + 1);

    return String.fromCharCode('A'.charCodeAt(0) + index);
}

function Stars({ value }: { value: number }) {
    return (
        <span className="chl-stars">
            {STAR_SLOTS.map((slot) => (
                <Icon
                    key={slot}
                    name={slot < value ? 'star' : 'star_border'}
                    size="small"
                    className={slot < value ? 'chl-star-on' : 'chl-star-off'}
                />
            ))}
        </span>
    );
}

export default function ChallengePanel() {
    const { t, i18n } = useTranslation(['common', 'params', 'blocks', 'groups']);
    const language = pickLanguage(i18n.language);

    const width = useUiStore((state) => state.panels.challenge);
    const collapsed = useUiStore((state) => state.challengeCollapsed);
    const togglePanel = useUiStore((state) => state.toggleChallengePanel);
    const setSelection = useUiStore((state) => state.setSelection);

    const track = useChallengeStore((state) => state.track);
    const setTrack = useChallengeStore((state) => state.setTrack);
    const activeRef = useChallengeStore((state) => state.ref);
    const challenge = useChallengeStore((state) => state.active);
    const session = useChallengeStore((state) => state.session);
    const status = useChallengeStore((state) => state.status);
    const error = useChallengeStore((state) => state.error);
    const verdict = useChallengeStore((state) => state.verdict);
    const hintsUsed = useChallengeStore((state) => state.hintsUsed);
    const progress = useChallengeStore((state) => state.progress);
    const practice = useChallengeStore((state) => state.practice);
    const authored = useChallengeStore((state) => state.authored);
    const openRef = useChallengeStore((state) => state.open);
    const restart = useChallengeStore((state) => state.restart);
    const closeChallenge = useChallengeStore((state) => state.close);
    const revealHint = useChallengeStore((state) => state.revealHint);
    const submit = useChallengeStore((state) => state.submit);
    const tick = useChallengeStore((state) => state.tick);
    const refreshAuthored = useChallengeStore((state) => state.refreshAuthored);
    const openEditor = useChallengeStore((state) => state.openEditor);

    const nodes = useGraphStore((state) => state.nodes);
    const edges = useGraphStore((state) => state.edges);
    const meta = useSchemeStore((state) => state.meta);
    const settings = useSchemeStore((state) => state.settings);
    const result = useSimStore((state) => state.result);

    useEffect(() => {
        if (!session) return;

        const timer = window.setInterval(tick, TICK_MS);
        return () => window.clearInterval(timer);
    }, [session, tick]);

    const localized = useCallback((text: LocalizedText) => text[language], [language]);

    const golfTask = activeRef?.kind === 'golf' ? golfById(activeRef.taskId) : undefined;
    const incident = activeRef?.kind === 'incident' ? incidentById(activeRef.caseId) : undefined;
    const interview = activeRef?.kind === 'interview' ? interviewById(activeRef.sessionId) : undefined;

    const labels = useMemo(() => {
        const map = new Map<string, string>();

        for (const node of nodes) {
            const fallback = t(node.data.componentType, {
                ns: 'blocks',
                defaultValue: node.data.componentType,
            });
            map.set(node.id, node.data.label || fallback);
        }

        return map;
    }, [nodes, t]);

    const live = useMemo<RequirementEvaluation[]>(() => {
        if (!challenge || !result) return [];

        const topology = compileTopology(toScheme({ meta, nodes, edges, settings }));
        if (topology.issues.some((issue) => issue.severity === 'error')) return [];

        return evaluateLive(challenge, topology, result);
    }, [challenge, edges, meta, nodes, result, settings]);

    const measure = useCallback(
        (value: number, unit: string): string => {
            if (unit === 'ratio') return `${formatNumber(value * 100)} %`;
            if (unit === '') return formatNumber(value);

            return `${formatNumber(value)} ${t(`challenge.unit.${unit}`, { defaultValue: unit })}`;
        },
        [t],
    );

    const measureComparison = useCallback(
        (value: number, unit: string): string =>
            unit === 'nines' ? `${(value * 100).toFixed(AVAILABILITY_DIGITS)} %` : measure(value, unit),
        [measure],
    );

    const comparisonDelta = useCallback(
        (delta: number, unit: string): string => {
            const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';

            return `${sign}${measureComparison(Math.abs(delta), unit)}`;
        },
        [measureComparison],
    );

    const decorate = useCallback(
        (values: Record<string, string | number>): Record<string, string | number> => {
            const decorated: Record<string, string | number> = {};

            for (const [key, value] of Object.entries(values)) {
                decorated[key] = typeof value === 'number' ? formatNumber(value) : value;
            }

            if (typeof values.param === 'string') {
                decorated.param = t(values.param, { ns: 'params', defaultValue: values.param });
            }
            if (typeof values.type === 'string') {
                decorated.type = t(values.type, { ns: 'blocks', defaultValue: values.type });
            }
            if (typeof values.group === 'string') {
                decorated.group = t(values.group, { ns: 'groups', defaultValue: values.group });
            }
            if (typeof values.boundBy === 'string') {
                decorated.boundBy = t(`bound.${values.boundBy}`, { defaultValue: values.boundBy });
            }
            if (typeof values.node === 'string') {
                decorated.node = labels.get(values.node) ?? values.node;
            }

            return decorated;
        },
        [labels, t],
    );

    const requirementDesc = useCallback(
        (id: string): string => {
            if (!challenge) return id;

            const requirement = [...challenge.requirements, ...challenge.bonusObjectives].find(
                (item) => item.id === id,
            );

            return requirement ? localized(requirement.desc) : id;
        },
        [challenge, localized],
    );

    const penaltyText = useCallback(
        (penalty: Penalty): string => {
            if (penalty.code.startsWith('override-')) {
                const param = penalty.code.slice('override-'.length);
                return t('challenge.penalty.override', {
                    param: t(param, { ns: 'params', defaultValue: param }),
                });
            }

            if (penalty.code.startsWith('hint-')) {
                return t('challenge.penalty.hint', { level: penalty.code.slice('hint-'.length) });
            }

            return t(`challenge.penalty.${penalty.code}`, { defaultValue: penalty.code });
        },
        [t],
    );

    const handleSubmit = useCallback(() => {
        submit(useSchemeStore.getState().exportScheme());
    }, [submit]);

    const loadSolution = useCallback((solution: ReferenceSolution) => {
        useSchemeStore.getState().importScheme(solution.build());
    }, []);

    const openAuthored = useCallback(
        (item: AuthoredChallenge) => {
            const outcome = parseChallengeSource(item.source);
            if (!outcome.ok) {
                openEditor(item);
                return;
            }

            openRef({ kind: 'authored', spec: outcome.spec });
        },
        [openEditor, openRef],
    );

    const removeAuthoredItem = useCallback(
        (item: AuthoredChallenge) => {
            removeAuthored(item.id);
            refreshAuthored();
        },
        [refreshAuthored],
    );

    const highlight = useCallback((nodeIds: string[]) => setSelection(nodeIds, []), [setSelection]);

    const showButton = (nodeIds: string[]) => {
        if (nodeIds.length === 0) return null;

        return (
            <button
                type="button"
                className="chl-show"
                onClick={() => highlight(nodeIds)}
                title={t('challenge.showOnScheme')}
                aria-label={t('challenge.showOnScheme')}
            >
                <Icon name="my_location" size="small" />
            </button>
        );
    };

    const renderRequirement = (evaluation: RequirementEvaluation, key: string) => {
        const hasNumbers = evaluation.actual !== null && evaluation.target !== null;
        const met = evaluation.status === 'met';
        const showHeadroom = met && evaluation.headroom !== null && evaluation.headroom > 0;

        return (
            <li key={key} className={`chl-req chl-req-${evaluation.status}`}>
                <Icon name={STATUS_ICON[evaluation.status]} size="small" className="chl-req-icon" />
                <div className="chl-req-body">
                    <span className="chl-req-head">
                        <span className="chl-req-id">{evaluation.id}</span>
                        <span className="chl-req-desc">{requirementDesc(evaluation.id)}</span>
                    </span>
                    {hasNumbers && (
                        <span className="chl-req-fact">
                            {t('challenge.fact', {
                                actual: measure(evaluation.actual as number, evaluation.unit),
                                target: measure(evaluation.target as number, evaluation.unit),
                            })}
                            {showHeadroom && (
                                <span className="chl-req-headroom">
                                    {t('challenge.headroom', {
                                        value: formatNumber((evaluation.headroom as number) * 100),
                                    })}
                                </span>
                            )}
                        </span>
                    )}
                    {!met && (
                        <span className="chl-req-reason">
                            {t(`challenge.reason.${evaluation.reason}`, { defaultValue: evaluation.reason })}
                        </span>
                    )}
                </div>
                {showButton(evaluation.nodeIds)}
            </li>
        );
    };

    const renderRealism = (violation: RealismViolation, index: number) => (
        <li key={`${violation.code}-${index}`} className="chl-hit chl-hit-bad">
            <div className="chl-hit-body">
                <span className="chl-rule">{violation.code}</span>
                <span className="chl-hit-text">
                    {t(`challenge.realism.${violation.code}`, {
                        ...decorate(violation.values),
                        defaultValue: violation.code,
                    })}
                </span>
            </div>
            {showButton(violation.nodeIds)}
        </li>
    );

    const renderLint = (hit: LintHit, index: number) => (
        <li key={`${hit.rule}-${index}`} className={`chl-hit chl-hit-${hit.kind === 'positive' ? 'good' : 'bad'}`}>
            <div className="chl-hit-body">
                <span className="chl-rule">
                    {hit.rule}
                    {hit.kind === 'antipattern' && <span className="chl-rule-weight">−{hit.weight}</span>}
                </span>
                <span className="chl-hit-text">
                    {t(`challenge.lint.${hit.rule}`, { ...decorate(hit.values), defaultValue: hit.rule })}
                </span>
            </div>
            {showButton(hit.nodeIds)}
        </li>
    );

    const renderScenario = (run: ScenarioRun) => (
        <div key={run.scenario} className={`chl-scenario ${run.passed ? 'chl-scenario-pass' : 'chl-scenario-fail'}`}>
            <div className="chl-scenario-head">
                <Icon name={run.passed ? 'check_circle' : 'cancel'} size="small" className="chl-req-icon" />
                <span className="chl-scenario-name">
                    {t(`scenario.${run.scenario}`, { defaultValue: run.scenario })}
                </span>
                <span className="chl-badge">
                    {run.required ? t('challenge.scenarioRequired') : t('challenge.scenarioBonus')}
                </span>
            </div>
            {run.failures.length > 0 && (
                <ul className="chl-reqs">
                    {run.failures.map((failure, index) => renderRequirement(failure, `${run.scenario}-${index}`))}
                </ul>
            )}
        </div>
    );

    const renderAxis = (axis: AxisScore) => (
        <div key={axis.axis} className="chl-axis">
            <span className="chl-axis-name">{t(`challenge.axis.${axis.axis}`, { defaultValue: axis.axis })}</span>
            <span className="chl-axis-track">
                <span
                    className="chl-axis-fill"
                    style={{ width: `${Math.max(0, Math.min(MAX_AXIS_SCORE, axis.score))}%` }}
                />
            </span>
            <span className="chl-axis-value">{formatNumber(axis.score)}</span>
            <span className="chl-axis-weight">{t('challenge.axisWeight', { value: axis.weight })}</span>
        </div>
    );

    const renderSolution = (solution: ReferenceSolution, index: number) => (
        <article key={solution.id} className="chl-solution">
            <div className="chl-solution-head">
                <span className="chl-solution-letter">{solutionLetter(index)}</span>
                <span className="chl-solution-name">{localized(solution.name)}</span>
                <button type="button" className="chl-btn" onClick={() => loadSolution(solution)}>
                    {t('challenge.loadSolution')}
                </button>
            </div>
            <p className="chl-solution-tradeoff">{localized(solution.tradeoff)}</p>
        </article>
    );

    const renderComparisonRow = (row: ComparisonRow) => (
        <Fragment key={row.metric}>
            <span className="chl-diff-metric">
                <span className="chl-diff-metric-name">
                    {t(`challenge.comparison.metric.${row.metric}`, { defaultValue: row.metric })}
                </span>
                <span
                    className="chl-diff-direction"
                    title={t(`challenge.comparison.direction.${row.better}`, { defaultValue: row.better })}
                    aria-label={t(`challenge.comparison.direction.${row.better}`, { defaultValue: row.better })}
                >
                    {DIRECTION_ARROW[row.better]}
                </span>
            </span>
            <span className="chl-diff-cell chl-diff-own">
                <span className="chl-diff-value">{measureComparison(row.mine, row.unit)}</span>
            </span>
            {row.references.map((cell) => (
                <span key={cell.solutionId} className={`chl-diff-cell chl-diff-${cell.outcome}`}>
                    <span className="chl-diff-value">{measureComparison(cell.value, row.unit)}</span>
                    <span className="chl-diff-delta">{comparisonDelta(cell.delta, row.unit)}</span>
                </span>
            ))}
        </Fragment>
    );

    const renderComparison = (item: Challenge, comparison: SolutionComparison) => {
        const solutionName = (id: string) =>
            item.referenceSolutions.find((solution) => solution.id === id)?.name ?? null;

        return (
            <section className="chl-section">
                <h3 className="chl-section-title">{t('challenge.section.comparison')}</h3>
                <p className="chl-diff-caption">
                    {comparison.comparable
                        ? t('challenge.comparison.caption')
                        : t('challenge.comparison.incomparable')}
                </p>
                <div
                    className="chl-diff"
                    style={{
                        gridTemplateColumns: `minmax(0, 1.3fr) repeat(${comparison.solutionIds.length + 1}, minmax(0, 1fr))`,
                    }}
                >
                    <span className="chl-diff-corner" />
                    <span className="chl-diff-column">{t('challenge.comparison.mine')}</span>
                    {comparison.solutionIds.map((id, index) => {
                        const name = solutionName(id);

                        return (
                            <span key={id} className="chl-diff-column" title={name ? localized(name) : id}>
                                {solutionLetter(index)}
                            </span>
                        );
                    })}
                    {comparison.rows.map(renderComparisonRow)}
                </div>
            </section>
        );
    };

    const renderCatalog = () => (
        <div className="chl-body">
            {CHALLENGES.length === 0 && <div className="chl-empty">{t('challenge.catalogEmpty')}</div>}

            {challengesByLevel().map((bucket) => (
                <section key={bucket.level} className="chl-section">
                    <h3 className="chl-section-title">{t('challenge.level', { level: bucket.level })}</h3>

                    {bucket.items.map((item) => {
                        const stars = progress[item.id]?.stars ?? 0;
                        const attempts = progress[item.id]?.attempts ?? 0;

                        return (
                            <article key={item.id} className="chl-card">
                                <div className="chl-card-head">
                                    <span className="chl-card-name">{localized(item.title)}</span>
                                    <Stars value={stars} />
                                </div>

                                <div className="chl-card-meta">
                                    <span>{t('challenge.minutes', { value: item.estimatedMinutes })}</span>
                                    <span>{t('challenge.requirements', { value: item.requirements.length })}</span>
                                    {attempts > 0 && <span>{t('challenge.attempts', { value: attempts })}</span>}
                                </div>

                                {item.tags.length > 0 && (
                                    <div className="chl-tags">
                                        {item.tags.map((tag) => (
                                            <span key={tag} className="chl-tag">
                                                {t(`challenge.tag.${tag}`, { defaultValue: tag })}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <button
                                    type="button"
                                    className="chl-btn chl-btn-primary"
                                    onClick={() => openRef({ kind: 'catalog', challengeId: item.id })}
                                    title={t('challenge.startHint')}
                                >
                                    <Icon name="play_arrow" size="small" />
                                    <span>{t('challenge.start')}</span>
                                </button>
                            </article>
                        );
                    })}
                </section>
            ))}
        </div>
    );

    const renderTrack = () => {
        if (track === 'interview') {
            return <InterviewList localized={localized} records={practice} onOpen={openRef} />;
        }
        if (track === 'incident') {
            return <IncidentList localized={localized} records={practice} onOpen={openRef} />;
        }
        if (track === 'golf') {
            return <GolfList localized={localized} records={practice} onOpen={openRef} />;
        }
        if (track === 'authored') {
            return (
                <AuthoredList items={authored} onOpen={openAuthored} onEdit={openEditor} onRemove={removeAuthoredItem} />
            );
        }

        return renderCatalog();
    };

    const renderTimer = () => {
        if (!session) return null;

        const remaining = session.limitSec - session.elapsedSec;
        const stageCount = interview?.stages.length ?? 1;

        return (
            <div className={`chl-timer ${session.expired ? 'chl-timer-expired' : ''}`}>
                <Icon name="timer" size="small" />
                <span className="chl-timer-value">{formatClock(remaining)}</span>
                {interview && (
                    <span className="chl-timer-stage">
                        {t('practice.stage', { value: session.stage + 1, total: stageCount })}
                    </span>
                )}
                {session.expired && <span className="chl-timer-note">{t('practice.expired')}</span>}
            </div>
        );
    };

    const renderGolfGauge = () => {
        if (!golfTask) return null;

        const cost = result?.totals.costMonth ?? null;
        const medal = cost === null ? 'none' : golfMedal(cost, golfTask.parUsdMonth);

        return (
            <div className={`chl-golf chl-golf-${medal}`}>
                <span className="chl-line-label">{t('practice.par', { value: formatNumber(golfTask.parUsdMonth) })}</span>
                <span className="chl-line-value">
                    {cost === null ? t('challenge.notCompiled') : t('practice.cost', { value: formatNumber(cost) })}
                </span>
                {cost !== null && <span className="chl-badge">{t(`practice.medal.${medal}`)}</span>}
            </div>
        );
    };

    const renderActive = (item: Challenge) => (
        <div className="chl-body">
            {renderTimer()}
            {renderGolfGauge()}

            <p className="chl-brief">{localized(item.brief)}</p>

            <section className="chl-section">
                <h3 className="chl-section-title">{t('challenge.section.given')}</h3>
                {Object.entries(item.given).map(([key, value]) => (
                    <div key={key} className="chl-line">
                        <span className="chl-line-label">{t(key, { ns: 'params', defaultValue: key })}</span>
                        <span className="chl-line-value">
                            {typeof value === 'number' ? formatNumber(value) : value}
                        </span>
                    </div>
                ))}

                {item.flows.map((flow) => (
                    <div key={flow.id} className="chl-line">
                        <span className="chl-line-label">{localized(flow.name)}</span>
                        <span className="chl-line-value">
                            {t('challenge.flowWeight', { value: formatNumber(flow.weightInScore * 100) })}
                        </span>
                    </div>
                ))}

                {item.constraints.maxNodes !== undefined && (
                    <div className="chl-line">
                        <span className="chl-line-label">{t('challenge.constraint.maxNodes')}</span>
                        <span className="chl-line-value">{item.constraints.maxNodes}</span>
                    </div>
                )}

                {item.constraints.allowedGroups && (
                    <div className="chl-line chl-line-wrap">
                        <span className="chl-line-label">{t('challenge.constraint.allowedGroups')}</span>
                        <span className="chl-line-value">
                            {item.constraints.allowedGroups
                                .map((group) => t(group, { ns: 'groups', defaultValue: group }))
                                .join(', ')}
                        </span>
                    </div>
                )}

                {item.constraints.forbiddenTypes && item.constraints.forbiddenTypes.length > 0 && (
                    <div className="chl-line chl-line-wrap">
                        <span className="chl-line-label">{t('challenge.constraint.forbiddenTypes')}</span>
                        <span className="chl-line-value">
                            {item.constraints.forbiddenTypes
                                .map((type) => t(type, { ns: 'blocks', defaultValue: type }))
                                .join(', ')}
                        </span>
                    </div>
                )}
            </section>

            <section className="chl-section">
                <h3 className="chl-section-title">{t('challenge.section.requirements')}</h3>
                {live.length === 0 ? (
                    <p className="chl-hint-text">{t('challenge.notCompiled')}</p>
                ) : (
                    <ul className="chl-reqs">
                        {live.map((evaluation) => renderRequirement(evaluation, evaluation.id))}
                    </ul>
                )}
            </section>

            {item.hints.length > 0 && (
                <section className="chl-section">
                    <h3 className="chl-section-title">{t('challenge.section.hints')}</h3>
                    {item.hints.map((hint, index) =>
                        hintsUsed.includes(index) ? (
                            <p key={`${hint.level}-${index}`} className="chl-hint-open">
                                <span className="chl-rule">{t('challenge.hintLevel', { level: hint.level })}</span>
                                <span className="chl-hit-text">{localized(hint.text)}</span>
                            </p>
                        ) : (
                            <button
                                key={`${hint.level}-${index}`}
                                type="button"
                                className="chl-btn chl-btn-wide"
                                onClick={() => revealHint(index)}
                            >
                                <Icon name="lightbulb_outline" size="small" />
                                <span>{t('challenge.revealHint', { level: hint.level, cost: hint.cost })}</span>
                            </button>
                        ),
                    )}
                </section>
            )}

            {status === 'error' && <p className="chl-error">{t('challenge.failed', { message: error ?? '' })}</p>}

            <button
                type="button"
                className="chl-btn chl-btn-primary chl-btn-wide"
                onClick={handleSubmit}
                disabled={status === 'running'}
            >
                {status === 'running' ? t('challenge.submitting') : t('challenge.submit')}
            </button>
        </div>
    );

    const renderOutcome = () => {
        if (!verdict) return null;

        const solved = verdict.stage === 'passed';

        if (golfTask) {
            const medal = solved ? golfMedal(verdict.metrics.costMonth, golfTask.parUsdMonth) : 'none';

            return (
                <section className="chl-section">
                    <h3 className="chl-section-title">{t('practice.section.golf')}</h3>
                    <div className={`chl-golf chl-golf-${medal}`}>
                        <span className="chl-line-label">
                            {t('practice.par', { value: formatNumber(golfTask.parUsdMonth) })}
                        </span>
                        <span className="chl-line-value">
                            {t('practice.cost', { value: formatNumber(verdict.metrics.costMonth) })}
                        </span>
                        <span className="chl-badge">{t(`practice.medal.${medal}`)}</span>
                    </div>
                    {!solved && <p className="chl-hint-text">{t('practice.golfGateFailed')}</p>}
                </section>
            );
        }

        if (incident) {
            return (
                <section className="chl-section">
                    <h3 className="chl-section-title">{t('practice.section.incident')}</h3>
                    <p className={solved ? 'chl-tone-ok' : 'chl-tone-hot'}>
                        {solved ? t('practice.incidentFixed') : t('practice.incidentOpen')}
                    </p>
                    {solved && <p className="chl-hint-open">{localized(incident.rootCause)}</p>}
                </section>
            );
        }

        if (!interview) return null;

        return (
            <section className="chl-section">
                <h3 className="chl-section-title">{t('practice.section.interview')}</h3>
                <p className="chl-hint-text">
                    {t('practice.interviewOutcome', {
                        stage: (session?.stage ?? 0) + 1,
                        total: interview.stages.length,
                    })}
                </p>
            </section>
        );
    };

    const renderReport = (item: Challenge) => {
        if (!verdict) return null;

        const antipatterns = verdict.lint.antipatterns;
        const positives = verdict.lint.positives;

        return (
            <div className="chl-body">
                <div className={`chl-verdict chl-verdict-${verdict.stage}`}>
                    <Stars value={verdict.stars} />
                    <span className="chl-verdict-stage">
                        {t(`challenge.stage.${verdict.stage}`, { defaultValue: verdict.stage })}
                    </span>
                    <span className="chl-verdict-score">
                        {t('challenge.score', { value: formatNumber(verdict.rubric.total) })}
                    </span>
                </div>

                {renderOutcome()}

                {verdict.stage === 'compile' && <p className="chl-error">{t('challenge.notCompiled')}</p>}

                {verdict.realism.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.realism')}</h3>
                        <ul className="chl-hits">{verdict.realism.map(renderRealism)}</ul>
                    </section>
                )}

                {verdict.requirements.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.requirements')}</h3>
                        <ul className="chl-reqs">
                            {verdict.requirements.map((evaluation) => renderRequirement(evaluation, evaluation.id))}
                        </ul>
                    </section>
                )}

                {verdict.bonusObjectives.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.bonus')}</h3>
                        <ul className="chl-reqs">
                            {verdict.bonusObjectives.map((evaluation) =>
                                renderRequirement(evaluation, `bonus-${evaluation.id}`),
                            )}
                        </ul>
                    </section>
                )}

                {verdict.scenarioRuns.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.scenarios')}</h3>
                        {verdict.scenarioRuns.map(renderScenario)}
                    </section>
                )}

                {antipatterns.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.antipatterns')}</h3>
                        <ul className="chl-hits">{antipatterns.map(renderLint)}</ul>
                    </section>
                )}

                {positives.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.practices')}</h3>
                        <ul className="chl-hits">{positives.map(renderLint)}</ul>
                    </section>
                )}

                {verdict.rubric.axes.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.rubric')}</h3>
                        {verdict.rubric.axes.map(renderAxis)}
                    </section>
                )}

                {verdict.rubric.penalties.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.penalties')}</h3>
                        {verdict.rubric.penalties.map((penalty, index) => (
                            <div key={`${penalty.code}-${index}`} className="chl-line">
                                <span className="chl-line-label">{penaltyText(penalty)}</span>
                                <span className="chl-line-value chl-tone-hot">−{formatNumber(penalty.points)}</span>
                            </div>
                        ))}
                    </section>
                )}

                {verdict.comparison !== null && renderComparison(item, verdict.comparison)}

                {item.referenceSolutions.length > 0 && (
                    <section className="chl-section">
                        <h3 className="chl-section-title">{t('challenge.section.solutions')}</h3>
                        {item.referenceSolutions.map(renderSolution)}
                    </section>
                )}

                <button type="button" className="chl-btn chl-btn-primary chl-btn-wide" onClick={restart}>
                    {t('challenge.retry')}
                </button>
            </div>
        );
    };

    const title = challenge ? localized(challenge.title) : t(`practice.track.${track}`);

    if (collapsed) {
        return (
            <aside className="chl chl-collapsed">
                <div className="chl-header">
                    <button
                        type="button"
                        className="chl-collapse-btn"
                        onClick={togglePanel}
                        title={t('challenge.expandPanel')}
                        aria-label={t('challenge.expandPanel')}
                    >
                        <Icon name="chevron_right" size="small" />
                    </button>
                </div>

                <button type="button" className="chl-rail" onClick={togglePanel} title={title}>
                    <Icon name="assignment" size="small" />
                    <span className="chl-rail-title">{title}</span>
                    {status === 'running' && <span className="chl-running-dot" />}
                </button>
            </aside>
        );
    }

    return (
        <aside className="chl" style={{ width }}>
            <ResizeHandle panel="challenge" side="right" label={t('resize.challenge')} />

            <div className="chl-header">
                {challenge && (
                    <button
                        type="button"
                        className="chl-back"
                        onClick={closeChallenge}
                        title={t('challenge.backToCatalog')}
                        aria-label={t('challenge.backToCatalog')}
                    >
                        <Icon name="arrow_back" size="small" />
                    </button>
                )}
                <span className="chl-title" title={title}>
                    {title}
                </span>
                {status === 'running' && (
                    <span className="chl-running">
                        <span className="chl-running-dot" />
                    </span>
                )}
                <button
                    type="button"
                    className="chl-collapse-btn"
                    onClick={togglePanel}
                    title={t('challenge.collapsePanel')}
                    aria-label={t('challenge.collapsePanel')}
                >
                    <Icon name="chevron_left" size="small" />
                </button>
            </div>

            {!challenge && (
                <div className="chl-tracks">
                    <select
                        className="chl-track-select"
                        value={track}
                        onChange={(event) => setTrack(event.target.value as PracticeTrack)}
                        aria-label={t('practice.trackLabel')}
                    >
                        {TRACKS.map((item) => (
                            <option key={item} value={item}>
                                {t(`practice.track.${item}`)}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {!challenge && renderTrack()}
            {challenge && verdict === null && renderActive(challenge)}
            {challenge && verdict !== null && renderReport(challenge)}
        </aside>
    );
}
