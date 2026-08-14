import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import Header from './components/layout/Header/Header';
import Footer from './components/layout/Footer/Footer';
import Palette from './components/panels/Palette/Palette';
import Inspector from './components/panels/Inspector/Inspector';
import Dashboard from './components/panels/Dashboard/Dashboard';
import SdEditor from './components/canvas/SdEditor';
import ErrorBoundary from './components/common/ErrorBoundary/ErrorBoundary';
import SaveDialog from './components/dialogs/SaveDialog';
import LoadDialog from './components/dialogs/LoadDialog';
import ConfirmDialog from './components/dialogs/ConfirmDialog';
import Icon from './components/common/Icons/Icon';

import { DEMO_SCHEMES } from './data/demoSchemes';
import { useAutoSave } from './hooks/useAutoSave';
import { useDialogManager } from './hooks/useDialogManager';
import { useSimulation } from './hooks/useSimulation';
import { useGraphStore } from './store/graphStore';
import { useIsDirty, useSchemeStore } from './store/schemeStore';
import type { StoredSchemeInfo } from './store/schemeStore';
import { useSimStore } from './store/simStore';
import { useUiStore } from './store/uiStore';
import { downloadJson, pickJsonFile, slugify } from './services/fileService';
import './App.css';

interface ConfirmState {
    title: string;
    message: string;
    action: () => void;
}

export default function App() {
    const { t } = useTranslation();
    const dialogs = useDialogManager();
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
    const restored = useRef(false);

    const isDirty = useIsDirty();
    const replaceGraph = useGraphStore((state) => state.replaceGraph);
    const inspectorOpen = useUiStore((state) => state.inspectorOpen);
    const toggleInspector = useUiStore((state) => state.toggleInspector);
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

    useEffect(() => {
        if (restored.current) return;
        restored.current = true;

        refreshLibrary();
        const autoSaved = loadAutoSave();
        if (autoSaved && autoSaved.nodes.length > 0) {
            replaceGraph(autoSaved.nodes, autoSaved.edges);
        }
    }, [loadAutoSave, refreshLibrary, replaceGraph]);

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
                />

                <div className="app-content">
                    <ErrorBoundary>
                        <Palette />
                    </ErrorBoundary>

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
