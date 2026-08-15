import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '../common/Dialog/Dialog';
import Icon from '../common/Icons/Icon';
import { schemeToSpecYaml } from '../../engine/authoring/emit';
import { CHALLENGE_TEMPLATE } from '../../engine/authoring/template';
import type { AuthoringIssue } from '../../engine/authoring/spec';
import { downloadText, pickTextFile } from '../../services/fileService';
import { parseChallengeSource, saveAuthored } from '../../services/authoredChallenges';
import type { AuthoredChallenge } from '../../services/authoredChallenges';
import { useSchemeStore } from '../../store/schemeStore';
import './ChallengeEditor.css';

const EDITOR_WIDTH = 860;

export interface ChallengeEditorProps {
    item: AuthoredChallenge | null;
    onClose: () => void;
}

export default function ChallengeEditor({ item, onClose }: ChallengeEditorProps) {
    const { t } = useTranslation();
    const [source, setSource] = useState(item?.source ?? CHALLENGE_TEMPLATE);
    const [issues, setIssues] = useState<AuthoringIssue[] | null>(null);
    const [valid, setValid] = useState(false);

    const change = useCallback((next: string) => {
        setSource(next);
        setIssues(null);
        setValid(false);
    }, []);

    const check = useCallback(() => {
        const outcome = parseChallengeSource(source);
        setIssues(outcome.ok ? [] : outcome.issues);
        setValid(outcome.ok);

        return outcome.ok;
    }, [source]);

    const store = useCallback(() => {
        const outcome = saveAuthored(source, new Date().toISOString());

        if (!outcome.ok) {
            setIssues(outcome.issues);
            setValid(false);
            return;
        }

        onClose();
    }, [onClose, source]);

    const insertScheme = useCallback(() => {
        const scheme = useSchemeStore.getState().exportScheme();
        change(`${source.trimEnd()}\n\n${schemeToSpecYaml(scheme, 'starter', 0)}\n`);
    }, [change, source]);

    const importFile = useCallback(async () => {
        const text = await pickTextFile('.yaml,.yml,.json,text/yaml,application/json');
        if (text !== null) change(text);
    }, [change]);

    const issueText = useCallback(
        (issue: AuthoringIssue) =>
            t(`authoring.issue.${issue.code}`, { ...issue.values, defaultValue: issue.code }),
        [t],
    );

    return (
        <Dialog
            title={item ? t('authoring.editTitle', { id: item.id }) : t('authoring.createTitle')}
            onClose={onClose}
            width={EDITOR_WIDTH}
            footer={
                <>
                    <button className="dlg-btn" onClick={onClose}>
                        {t('dialog.cancel')}
                    </button>
                    <button className="dlg-btn" onClick={check}>
                        {t('authoring.check')}
                    </button>
                    <button className="dlg-btn dlg-btn-primary" onClick={store}>
                        {t('authoring.save')}
                    </button>
                </>
            }
        >
            <p className="ced-hint">{t('authoring.hint')}</p>

            <div className="ced-toolbar">
                <button className="dlg-btn" onClick={() => change(CHALLENGE_TEMPLATE)}>
                    <Icon name="note_add" size="small" />
                    <span>{t('authoring.template')}</span>
                </button>
                <button className="dlg-btn" onClick={insertScheme}>
                    <Icon name="add_circle_outline" size="small" />
                    <span>{t('authoring.fromCanvas')}</span>
                </button>
                <button className="dlg-btn" onClick={() => void importFile()}>
                    <Icon name="upload" size="small" />
                    <span>{t('authoring.import')}</span>
                </button>
                <button className="dlg-btn" onClick={() => downloadText(`${item?.id ?? 'challenge'}.yaml`, source)}>
                    <Icon name="download" size="small" />
                    <span>{t('authoring.export')}</span>
                </button>
            </div>

            <textarea
                className="ced-source"
                spellCheck={false}
                value={source}
                onChange={(event) => change(event.target.value)}
                aria-label={t('authoring.sourceLabel')}
            />

            {valid && <div className="ced-valid">{t('authoring.valid')}</div>}

            {issues !== null && issues.length > 0 && (
                <ul className="ced-issues">
                    {issues.map((issue, index) => (
                        <li key={`${issue.path}-${index}`} className="ced-issue">
                            <span className="ced-issue-path">{issue.path}</span>
                            <span className="ced-issue-text">{issueText(issue)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </Dialog>
    );
}
