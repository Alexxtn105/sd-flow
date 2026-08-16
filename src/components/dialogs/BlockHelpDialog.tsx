import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '../common/Dialog/Dialog';
import Icon from '../common/Icons/Icon';
import registry from '../../engine/ComponentRegistry';
import useParamHelp from '../../hooks/useParamHelp';
import useReference from '../../hooks/useReference';
import { referenceLanguage } from '../../services/referenceBundle';
import { referenceLimits } from '../../utils/blockReference';
import { formatNumber, formatRps } from '../../utils/format';
import { groupParams } from '../../utils/paramSections';
import { useUiStore } from '../../store/uiStore';
import './BlockHelpDialog.css';

export interface BlockHelpDialogProps {
    componentType: string;
    onClose: () => void;
}

const DIALOG_WIDTH = 760;

const MIN_BAR = 12;

export default function BlockHelpDialog({ componentType, onClose }: BlockHelpDialogProps) {
    const { t, i18n } = useTranslation(['common', 'blocks', 'groups', 'params', 'help', 'hints']);
    const ready = useReference(['help', 'hints']);
    const language = referenceLanguage(i18n.language);
    const openBlockHelp = useUiStore((state) => state.openBlockHelp);
    const paramHelp = useParamHelp();

    const definition = registry.get(componentType);

    const siblings = useMemo(() => {
        if (!definition) return [];
        return registry
            .getGroups()
            .find((group) => group.id === definition.group)
            ?.components.filter((item) => item.id !== definition.id) ?? [];
    }, [definition]);

    const limits = useMemo(() => {
        if (!definition) return [];
        return [...referenceLimits(definition)].sort((left, right) => left.value - right.value);
    }, [definition]);

    const sections = useMemo(() => {
        if (!definition) return [];
        return groupParams(registry.getDefaultParams(definition.id), definition.paramSchema);
    }, [definition]);

    if (!definition) return null;

    const name = t(definition.id, { ns: 'blocks', defaultValue: definition.id });
    const text = (field: string) => t(`${definition.helpId}.${field}`, { ns: 'help', defaultValue: '' });
    const list = (field: string): string[] => {
        const value = i18n.getResource(language, 'help', `${definition.helpId}.${field}`);
        return Array.isArray(value) ? (value as string[]) : [];
    };

    const summary = text('summary');
    const capacity = text('capacity');
    const practices = list('practices');
    const pitfalls = list('pitfalls');
    const tightest = limits.length > 0 ? limits[0].value : 0;
    const widest = limits.length > 0 ? limits[limits.length - 1].value : 0;

    const headroom = (value: number) => {
        const ratio = value / tightest;
        return formatNumber(ratio >= 100 ? Math.round(ratio) : Math.round(ratio * 10) / 10);
    };

    const barWidth = (value: number) => {
        if (tightest <= 0 || widest <= 0) return 0;
        if (widest === tightest) return 100;
        return MIN_BAR + (100 - MIN_BAR) * (Math.log10(value / tightest) / Math.log10(widest / tightest));
    };

    const unit = (key: string) => t(`units.${key}`, { ns: 'params', defaultValue: key });

    return (
        <Dialog title={t('blockHelp.title')} onClose={onClose} width={DIALOG_WIDTH}>
            <div className="bhelp">
                <header className="bhelp-head">
                    <span className="bhelp-icon">
                        <Icon name={definition.icon} size="large" />
                    </span>
                    <div className="bhelp-head-main">
                        <h2 className="bhelp-name">{name}</h2>
                        <div className="bhelp-badges">
                            <span className="bhelp-badge">
                                {t(definition.group, { ns: 'groups', defaultValue: definition.group })}
                            </span>
                            <span className="bhelp-badge bhelp-badge-wave">{definition.wave.toUpperCase()}</span>
                            {definition.managed && (
                                <span className="bhelp-badge bhelp-badge-managed">{t('blockHelp.managed')}</span>
                            )}
                        </div>
                    </div>
                </header>

                {!ready && <p className="bhelp-loading">{t('blockHelp.loading')}</p>}

                {ready && !summary && <p className="bhelp-loading">{t('blockHelp.missing')}</p>}

                {summary && (
                    <section className="bhelp-section">
                        <h3 className="bhelp-section-title">{t('blockHelp.summary')}</h3>
                        <p className="bhelp-text">{summary}</p>
                    </section>
                )}

                {(capacity || limits.length > 0) && (
                    <section className="bhelp-section">
                        <h3 className="bhelp-section-title">{t('blockHelp.capacity')}</h3>
                        {capacity && <p className="bhelp-text">{capacity}</p>}
                        {limits.length > 0 && (
                            <>
                                <p className="bhelp-note">{t('blockHelp.atDefaults')}</p>
                                <ul className="bhelp-limits">
                                    {limits.map((limit, index) => (
                                        <li
                                            key={limit.resource}
                                            className={`bhelp-limit ${index === 0 ? 'bhelp-limit-bound' : ''}`}
                                        >
                                            <span className="bhelp-limit-name">
                                                <span className="bhelp-limit-title">
                                                    {t(`bound.${limit.resource}`, { defaultValue: limit.resource })}
                                                </span>
                                                {index === 0 ? (
                                                    <span className="bhelp-limit-tag">{t('blockHelp.bindsFirst')}</span>
                                                ) : (
                                                    <span className="bhelp-limit-slack">
                                                        ×{headroom(limit.value)} {t('blockHelp.headroom')}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="bhelp-limit-bar">
                                                <span
                                                    className="bhelp-limit-fill"
                                                    style={{ width: `${barWidth(limit.value)}%` }}
                                                />
                                            </span>
                                            <span className="bhelp-limit-value">
                                                {formatRps(limit.value)} {unit(limit.explain.unit)}
                                            </span>
                                            <span className="bhelp-limit-formula">
                                                {limit.explain.formula}
                                                {Object.entries(limit.explain.inputs).length > 0 && (
                                                    <span className="bhelp-limit-inputs">
                                                        {Object.entries(limit.explain.inputs)
                                                            .map(
                                                                ([key, value]) =>
                                                                    `${key} = ${
                                                                        typeof value === 'number'
                                                                            ? formatNumber(value)
                                                                            : value
                                                                    }`,
                                                            )
                                                            .join(', ')}
                                                    </span>
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                        {!definition.model && <p className="bhelp-note">{t('inspector.noModel')}</p>}
                    </section>
                )}

                {practices.length > 0 && (
                    <section className="bhelp-section">
                        <h3 className="bhelp-section-title">{t('blockHelp.practices')}</h3>
                        <ul className="bhelp-list bhelp-list-good">
                            {practices.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </section>
                )}

                {pitfalls.length > 0 && (
                    <section className="bhelp-section">
                        <h3 className="bhelp-section-title">{t('blockHelp.pitfalls')}</h3>
                        <ul className="bhelp-list bhelp-list-bad">
                            {pitfalls.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className="bhelp-section">
                    <h3 className="bhelp-section-title">{t('blockHelp.params')}</h3>
                    {sections.map((group) => (
                        <div key={group.section} className="bhelp-param-group">
                            <span className="bhelp-param-section">{t(`section.${group.section}`)}</span>
                            <table className="bhelp-params">
                                <tbody>
                                    {group.entries.map(({ key, value, field }) => {
                                        const help = paramHelp(key, field);

                                        return (
                                            <tr key={key}>
                                                <td className="bhelp-param-name">
                                                    {help.name}
                                                    <span className="bhelp-param-key">{key}</span>
                                                </td>
                                                <td className="bhelp-param-value">
                                                    {typeof value === 'boolean'
                                                        ? t(value ? 'blockHelp.on' : 'blockHelp.off')
                                                        : String(value)}
                                                    {help.unit && <span className="bhelp-param-unit">{help.unit}</span>}
                                                </td>
                                                <td className="bhelp-param-hint">
                                                    {help.hint}
                                                    {help.limits && (
                                                        <span className="bhelp-param-range">
                                                            {t('blockHelp.range')} {help.limits}
                                                            {help.unit ? ` ${help.unit}` : ''}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </section>

                <section className="bhelp-section">
                    <h3 className="bhelp-section-title">{t('blockHelp.ports')}</h3>
                    <div className="bhelp-ports">
                        <span className="bhelp-port-label">{t('inspector.portsIn')}</span>
                        <span className="bhelp-port-list">
                            {definition.ports.in.map((port) => `${port.id} · ${port.protocols.join(', ')}`).join(' | ') ||
                                '—'}
                        </span>
                        <span className="bhelp-port-label">{t('inspector.portsOut')}</span>
                        <span className="bhelp-port-list">
                            {definition.ports.out
                                .map((port) => `${port.id} · ${port.protocols.join(', ')}`)
                                .join(' | ') || '—'}
                        </span>
                    </div>
                </section>

                {siblings.length > 0 && (
                    <section className="bhelp-section">
                        <h3 className="bhelp-section-title">{t('blockHelp.siblings')}</h3>
                        <div className="bhelp-siblings">
                            {siblings.map((item) => (
                                <button
                                    key={item.id}
                                    className="bhelp-sibling"
                                    onClick={() => openBlockHelp(item.id)}
                                >
                                    <Icon name={item.icon} size="small" />
                                    <span>{t(item.id, { ns: 'blocks', defaultValue: item.id })}</span>
                                </button>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </Dialog>
    );
}
