import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import Header from './components/layout/Header/Header';
import Footer from './components/layout/Footer/Footer';
import Palette from './components/panels/Palette/Palette';
import ChallengePanel from './components/panels/Challenges/ChallengePanel';
import Inspector from './components/panels/Inspector/Inspector';
import Dashboard from './components/panels/Dashboard/Dashboard';
import SdEditor from './components/canvas/SdEditor';
import ErrorBoundary from './components/common/ErrorBoundary/ErrorBoundary';
import SaveDialog from './components/dialogs/SaveDialog';
import LoadDialog from './components/dialogs/LoadDialog';
import ConfirmDialog from './components/dialogs/ConfirmDialog';
import Icon from './components/common/Icons/Icon';
import Toast from './components/common/Toast/Toast';
import type { ToastTone } from './components/common/Toast/Toast';
import Tutorial from './components/tutorial/Tutorial';

import { DEMO_SCHEMES } from './data/demoSchemes';
import { useAutoSave } from './hooks/useAutoSave';
import { useDialogManager } from './hooks/useDialogManager';
import { useSimulation } from './hooks/useSimulation';
import { useGraphStore } from './store/graphStore';
import { useIsDirty, useSchemeStore } from './store/schemeStore';
import type { StoredSchemeInfo } from './store/schemeStore';
import { useSimStore } from './store/simStore';
import { useUiStore } from './store/uiStore';
import {
    copyText,
    downloadDataUrl,
    downloadJson,
    downloadMarkdown,
    pickJsonFile,
    slugify,
} from './services/fileService';
import { renderSchemePng } from './services/imageExport';
import { buildMarkdownReport } from './services/reportExport';
import { buildShareUrl, clearShareHash, decodeScheme, encodeScheme, isShareUrlTooLong, readSharePayload } from './services/shareLink';
import './App.css';

interface ConfirmState {
    title: string;
    message: string;
    action: () => void;
}

interface ToastState {
    id: number;
    text: string;
    tone: ToastTone;
}

export default function App() {
    const { t, i18n } = useTranslation();
    const dialogs = useDialogManager();
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
    const [toast, setToast] = useState<ToastState | null>(null);
    const restored = useRef(false);
    const toastCounter = useRef(0);

    const isDirty = useIsDirty();
    const replaceGraph = useGraphStore((state) => state.replaceGraph);
    const mode = useUiStore((state) => state.mode);
    const inspectorOpen = useUiStore((state) => state.inspectorOpen);
    const toggleInspector = useUiStore((state) => state.toggleInspector);
    const tutorialOpen = useUiStore((state) => state.tutorialOpen);
    const dashboardOpen = useSimStore((state) => state.dashboardOpen);

    const meta = useSchemeStore((state) => state.meta);
    const library = useSchemeStore((state) => state.library);
    const refreshLibrary = useSchemeStore((state) => state.refreshLibrary);
    const createNew = useSchemeStore((state) => state.createNew);
    const saveScheme = useSchemeStore((state) => state.save);
    const saveAs = useSchemeStore((state) => state.saveAs);
    const loadScheme = useSchemeStore((state) => state.load);
    const removeScheme = useSchemeStore((state) => state.remove);
    const exportScheme = useSchemeStore((state) => state.exportScheme);
    const importScheme = useSchemeStore((state) => state.importScheme);

    const { loadAutoSave, clearAutoSave } = useAutoSave(true);

    useSimulation();

    const showToast = useCallback((text: string, tone: ToastTone = 'info') => {
        toastCounter.current += 1;
        setToast({ id: toastCounter.current, text, tone });
    }, []);

    useEffect(() => {
        if (restored.current) return;
        restored.current = true;

        refreshLibrary();

        const payload = readSharePayload();
        if (payload) {
            clearShareHash();
            void decodeScheme(payload).then((shared) => {
                if (shared && importScheme(shared)) {
                    showToast(t('share.opened'));
                    return;
                }
                showToast(t('share.brokenLink'), 'error');
            });
            return;
        }

        const autoSaved = loadAutoSave();
        if (autoSaved && autoSaved.nodes.length > 0) {
            replaceGraph(autoSaved.nodes, autoSaved.edges);
        }
    }, [importScheme, loadAutoSave, refreshLibrary, replaceGraph, showToast, t]);

    const guard = useCallback(
        (title: string, message: string, action: () => void) => {
            if (!isDirty) {
                action();
                return;
            }
            setConfirmState({ title, message, action });
        },
        [isDirty],
    );

    const handleNew = useCallback(() => {
        guard(t('dialog.confirmNew.title'), t('dialog.confirmNew.message'), () => {
            createNew();
            clearAutoSave();
        });
    }, [clearAutoSave, createNew, guard, t]);

    const handleSave = useCallback(() => {
        if (meta.name) {
            saveScheme();
            return;
        }
        dialogs.open('save');
    }, [dialogs, meta.name, saveScheme]);

    const handleLoad = useCallback(() => {
        refreshLibrary();
        dialogs.open('load');
    }, [dialogs, refreshLibrary]);

    const handlePick = useCallback(
        (id: string) => {
            guard(t('dialog.confirmLoad.title'), t('dialog.confirmLoad.message'), () => {
                loadScheme(id);
                dialogs.close();
            });
        },
        [dialogs, guard, loadScheme, t],
    );

    const handleRemove = useCallback(
        (item: StoredSchemeInfo) => {
            setConfirmState({
                title: t('dialog.confirmRemove.title'),
                message: t('dialog.confirmRemove.message', { name: item.name }),
                action: () => removeScheme(item.id),
            });
        },
        [removeScheme, t],
    );

    const handleExport = useCallback(() => {
        const scheme = exportScheme();
        downloadJson(slugify(scheme.meta.name || 'sd-flow-scheme'), scheme);
    }, [exportScheme]);

    const handleImport = useCallback(async () => {
        const raw = await pickJsonFile();
        if (raw === null) return;

        if (!importScheme(raw)) {
            setConfirmState({
                title: t('dialog.importFailed.title'),
                message: t('dialog.importFailed.message'),
                action: () => undefined,
            });
        }
    }, [importScheme, t]);

    const handleShare = useCallback(async () => {
        const scheme = exportScheme();
        const url = buildShareUrl(await encodeScheme(scheme));
        const copied = await copyText(url);

        if (!copied) {
            showToast(t('share.copyFailed'), 'error');
            return;
        }

        showToast(isShareUrlTooLong(url) ? t('share.copiedTooLong') : t('share.copied'), isShareUrlTooLong(url) ? 'warn' : 'info');
    }, [exportScheme, showToast, t]);

    const handleExportImage = useCallback(async () => {
        const scheme = exportScheme();
        const rendered = await renderSchemePng(useGraphStore.getState().nodes);

        if (!rendered.ok) {
            showToast(t(`export.imageFailed.${rendered.reason}`), 'error');
            return;
        }

        downloadDataUrl(`${slugify(scheme.meta.name || 'sd-flow-scheme')}.png`, rendered.dataUrl);
        showToast(t('export.imageDone'));
    }, [exportScheme, showToast, t]);

    const handleExportReport = useCallback(() => {
        const result = useSimStore.getState().result;
        if (!result) {
            showToast(t('export.reportUnavailable'), 'warn');
            return;
        }

        const scheme = exportScheme();
        downloadMarkdown(slugify(scheme.meta.name || 'sd-flow-scheme'), buildMarkdownReport(scheme, result, i18n.language));
        showToast(t('export.reportDone'));
    }, [exportScheme, i18n.language, showToast, t]);

    const handleLoadDemo = useCallback(
        (demoId: string) => {
            const demo = DEMO_SCHEMES.find((item) => item.id === demoId);
            if (!demo) return;

            guard(t('dialog.confirmLoad.title'), t('dialog.confirmLoad.message'), () => {
                const scheme = demo.build();
                scheme.meta.name = t(`demo.${demoId}`);
                importScheme(scheme);
            });
        },
        [guard, importScheme, t],
    );

    return (
        <ReactFlowProvider>
            <div className="app">
                <Header
                    onNew={handleNew}
                    onSave={handleSave}
                    onSaveAs={() => dialogs.open('saveAs')}
                    onLoad={handleLoad}
                    onExport={handleExport}
                    onImport={handleImport}
                    onLoadDemo={handleLoadDemo}
                    onShare={() => void handleShare()}
                    onExportImage={() => void handleExportImage()}
                    onExportReport={handleExportReport}
                />

                <div className="app-content">
                    <ErrorBoundary>
                        <Palette />
                    </ErrorBoundary>

                    {mode === 'challenges' && (
                        <ErrorBoundary>
                            <ChallengePanel />
                        </ErrorBoundary>
                    )}

                    <ErrorBoundary>
                        <SdEditor />
                    </ErrorBoundary>

                    {inspectorOpen ? (
                        <ErrorBoundary>
                            <Inspector />
                        </ErrorBoundary>
                    ) : (
                        <button
                            className="app-inspector-toggle"
                            onClick={toggleInspector}
                            title={t('inspector.title')}
                        >
                            <Icon name="chevron_left" size="small" />
                        </button>
                    )}
                </div>

                {dashboardOpen && (
                    <ErrorBoundary>
                        <Dashboard />
                    </ErrorBoundary>
                )}

                <Footer />

                {(dialogs.openDialog === 'save' || dialogs.openDialog === 'saveAs') && (
                    <SaveDialog
                        initialName={meta.name}
                        onClose={dialogs.close}
                        onSave={(name) => (dialogs.openDialog === 'saveAs' || !meta.name ? saveAs(name) : saveScheme())}
                    />
                )}

                {dialogs.openDialog === 'load' && (
                    <LoadDialog
                        items={library}
                        onClose={dialogs.close}
                        onPick={handlePick}
                        onRemove={handleRemove}
                    />
                )}

                {toast && (
                    <Toast
                        key={toast.id}
                        text={toast.text}
                        tone={toast.tone}
                        onDismiss={() => setToast(null)}
                    />
                )}

                {tutorialOpen && (
                    <ErrorBoundary>
                        <Tutorial />
                    </ErrorBoundary>
                )}

                {confirmState && (
                    <ConfirmDialog
                        title={confirmState.title}
                        message={confirmState.message}
                        onCancel={() => setConfirmState(null)}
                        onConfirm={() => {
                            confirmState.action();
                            setConfirmState(null);
                        }}
                    />
                )}
            </div>
        </ReactFlowProvider>
    );
}
