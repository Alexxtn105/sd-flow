import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';
import { LANGUAGES } from '../../../locales/i18n';
import { SCENARIOS } from '../../../engine/sim/scenarios';
import { DEMO_SCHEMES } from '../../../data/demoSchemes';
import { useThemeContext } from '../../../contexts/ThemeContext';
import { useGraphStore } from '../../../store/graphStore';
import { useIsDirty, useSchemeStore } from '../../../store/schemeStore';
import { useSimStore } from '../../../store/simStore';
import { useUiStore } from '../../../store/uiStore';
import type { AppMode } from '../../../store/uiStore';
import './Header.css';

const MODES: AppMode[] = ['sandbox', 'challenges'];

export interface HeaderProps {
    onNew: () => void;
    onSave: () => void;
    onSaveAs: () => void;
    onLoad: () => void;
    onExport: () => void;
    onImport: () => void;
    onLoadDemo: (demoId: string) => void;
    onShare: () => void;
    onExportImage: () => void;
    onExportReport: () => void;
}

export default function Header({
    onNew,
    onSave,
    onSaveAs,
    onLoad,
    onExport,
    onImport,
    onLoadDemo,
    onShare,
    onExportImage,
    onExportReport,
}: HeaderProps) {
    const { t, i18n } = useTranslation();
    const { isDarkTheme, toggleTheme } = useThemeContext();
    const [langOpen, setLangOpen] = useState(false);
    const langRef = useRef<HTMLDivElement>(null);

    const name = useSchemeStore((state) => state.meta.name);
    const isDirty = useIsDirty();
    const mode = useUiStore((state) => state.mode);
    const setMode = useUiStore((state) => state.setMode);
    const xray = useUiStore((state) => state.xray);
    const toggleXray = useUiStore((state) => state.toggleXray);
    const undo = useGraphStore((state) => state.undo);
    const redo = useGraphStore((state) => state.redo);
    const canUndo = useGraphStore((state) => state.past.length > 0);
    const canRedo = useGraphStore((state) => state.future.length > 0);
    const scenario = useSimStore((state) => state.scenario);
    const setScenario = useSimStore((state) => state.setScenario);
    const dashboardOpen = useSimStore((state) => state.dashboardOpen);
    const toggleDashboard = useSimStore((state) => state.toggleDashboard);
    const hasResult = useSimStore((state) => state.result !== null);
    const hasNodes = useGraphStore((state) => state.nodes.length > 0);

    useEffect(() => {
        if (!langOpen) return;
        const handler = (event: MouseEvent) => {
            if (langRef.current && !langRef.current.contains(event.target as HTMLElement)) setLangOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [langOpen]);

    const currentLang = LANGUAGES.find((language) => i18n.language.startsWith(language.code)) ?? LANGUAGES[0];

    return (
        <header className="hdr">
            <div className="hdr-brand">
                <span className="hdr-logo">{t('app.logo')}</span>
                <span className="hdr-title">{t('app.name')}</span>
            </div>

            <div className="hdr-modes">
                {MODES.map((item) => (
                    <button
                        key={item}
                        className={`hdr-mode ${mode === item ? 'active' : ''}`}
                        onClick={() => setMode(item)}
                        title={t(`mode.${item}`)}
                    >
                        {t(`mode.${item}`)}
                    </button>
                ))}
            </div>

            <div className="hdr-center">
                <div className={`hdr-scheme ${isDirty ? 'hdr-scheme-unsaved' : ''}`}>
                    <span className="hdr-scheme-dot" />
                    <span className="hdr-scheme-name" title={name}>
                        {name || t('header.unnamed')}
                    </span>
                    {isDirty && <span className="hdr-scheme-badge">{t('header.modified')}</span>}
                </div>

                <div className="hdr-actions">
                    <button className="hdr-btn" onClick={onNew} title={t('header.newScheme')}>
                        <Icon name="note_add" size="small" />
                    </button>
                    <button className="hdr-btn" onClick={onSave} title={t('header.save')}>
                        <Icon name="save" size="small" />
                    </button>
                    <button className="hdr-btn" onClick={onSaveAs} title={t('header.saveAs')}>
                        <Icon name="save_as" size="small" />
                    </button>
                    <button className="hdr-btn" onClick={onLoad} title={t('header.load')}>
                        <Icon name="folder_open" size="small" />
                    </button>
                    <select
                        className="hdr-select"
                        value=""
                        onChange={(event) => {
                            if (event.target.value) onLoadDemo(event.target.value);
                        }}
                        title={t('header.demos')}
                        aria-label={t('header.demos')}
                    >
                        <option value="">{t('header.demos')}</option>
                        {DEMO_SCHEMES.map((demo) => (
                            <option key={demo.id} value={demo.id}>
                                {t(`demo.${demo.id}`)}
                            </option>
                        ))}
                    </select>
                    <span className="hdr-divider" />
                    <button className="hdr-btn" onClick={onExport} title={t('header.export')}>
                        <Icon name="download" size="small" />
                    </button>
                    <button className="hdr-btn" onClick={onImport} title={t('header.import')}>
                        <Icon name="upload" size="small" />
                    </button>
                    <span className="hdr-divider" />
                    <button className="hdr-btn" onClick={onShare} disabled={!hasNodes} title={t('share.action')}>
                        <Icon name="share" size="small" />
                    </button>
                    <button
                        className="hdr-btn"
                        onClick={onExportImage}
                        disabled={!hasNodes}
                        title={t('export.png')}
                    >
                        <Icon name="image" size="small" />
                    </button>
                    <button
                        className="hdr-btn"
                        onClick={onExportReport}
                        disabled={!hasResult}
                        title={t('export.markdown')}
                    >
                        <Icon name="description" size="small" />
                    </button>
                </div>
            </div>

            <div className="hdr-right">
                <select
                    className="hdr-select"
                    value={scenario}
                    onChange={(event) => setScenario(event.target.value)}
                    title={t('dashboard.scenario')}
                    aria-label={t('dashboard.scenario')}
                >
                    {SCENARIOS.map((item) => (
                        <option key={item} value={item}>
                            {t(`scenario.${item}`)}
                        </option>
                    ))}
                </select>
                <button
                    className={`hdr-btn ${xray ? 'active' : ''}`}
                    onClick={toggleXray}
                    title={t('header.xray')}
                >
                    <Icon name="visibility" size="small" />
                </button>
                <button
                    className={`hdr-btn ${dashboardOpen ? 'active' : ''}`}
                    onClick={toggleDashboard}
                    title={dashboardOpen ? t('dashboard.hide') : t('dashboard.show')}
                >
                    <Icon name="dashboard" size="small" />
                </button>
                <span className="hdr-divider" />
                <button className="hdr-btn" onClick={undo} disabled={!canUndo} title={t('header.undo')}>
                    <Icon name="undo" size="small" />
                </button>
                <button className="hdr-btn" onClick={redo} disabled={!canRedo} title={t('header.redo')}>
                    <Icon name="redo" size="small" />
                </button>
                <span className="hdr-divider" />
                <a
                    className="hdr-btn"
                    href="https://github.com/Alexxtn105/sd-flow"
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('header.source')}
                >
                    <Icon name="code" size="small" />
                </a>
                <button
                    className="hdr-btn"
                    onClick={toggleTheme}
                    title={isDarkTheme ? t('header.lightTheme') : t('header.darkTheme')}
                >
                    <Icon name={isDarkTheme ? 'light_mode' : 'dark_mode'} size="small" />
                </button>

                <div className="hdr-lang" ref={langRef}>
                    <button
                        className={`hdr-lang-btn ${langOpen ? 'active' : ''}`}
                        onClick={() => setLangOpen((open) => !open)}
                        title={currentLang.label}
                    >
                        {currentLang.code.toUpperCase()}
                    </button>
                    {langOpen && (
                        <div className="hdr-lang-dropdown">
                            {LANGUAGES.map((language) => (
                                <button
                                    key={language.code}
                                    className={`hdr-lang-option ${language.code === currentLang.code ? 'active' : ''}`}
                                    onClick={() => {
                                        i18n.changeLanguage(language.code);
                                        setLangOpen(false);
                                    }}
                                >
                                    {language.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
