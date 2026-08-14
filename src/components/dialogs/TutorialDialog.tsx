import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../store/uiStore';
import Dialog from '../common/Dialog/Dialog';
import Icon from '../common/Icons/Icon';
import './TutorialDialog.css';

const STEP_COUNT = 5;

export default function TutorialDialog() {
    const { t } = useTranslation('common');
    const step = useUiStore((state) => state.tutorialStep);
    const close = useUiStore((state) => state.closeTutorial);
    const setStep = useUiStore((state) => state.setTutorialStep);
    const last = step === STEP_COUNT - 1;

    return (
        <Dialog
            title={t('tutorial.title')}
            onClose={close}
            width={520}
            footer={
                <div className="tutorial-actions">
                    <button type="button" className="tutorial-secondary" onClick={close}>
                        {t('tutorial.skip')}
                    </button>
                    <span className="tutorial-spacer" />
                    <button
                        type="button"
                        className="tutorial-secondary"
                        onClick={() => setStep(step - 1)}
                        disabled={step === 0}
                    >
                        {t('tutorial.back')}
                    </button>
                    <button
                        type="button"
                        className="tutorial-primary"
                        onClick={() => (last ? close() : setStep(step + 1))}
                    >
                        {last ? t('tutorial.finish') : t('tutorial.next')}
                    </button>
                </div>
            }
        >
            <div className="tutorial-progress" aria-label={t('tutorial.progress', { current: step + 1, total: STEP_COUNT })}>
                {Array.from({ length: STEP_COUNT }, (_, index) => (
                    <span key={index} className={index <= step ? 'active' : ''} />
                ))}
            </div>
            <div className="tutorial-step-icon">
                <Icon name={t(`tutorial.steps.${step}.icon`)} size="large" />
            </div>
            <p className="tutorial-kicker">{t('tutorial.progress', { current: step + 1, total: STEP_COUNT })}</p>
            <h3 className="tutorial-step-title">{t(`tutorial.steps.${step}.title`)}</h3>
            <p className="tutorial-step-body">{t(`tutorial.steps.${step}.body`)}</p>
            <div className="tutorial-tip">
                <Icon name="lightbulb" size="small" />
                <span>{t(`tutorial.steps.${step}.tip`)}</span>
            </div>
        </Dialog>
    );
}
