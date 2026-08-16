import { useTranslation } from 'react-i18next';
import Dialog from '../common/Dialog/Dialog';
import { PRICING_PROFILES } from '../../engine/sim/constants';
import { DEFAULT_SETTINGS } from '../../engine/types/scheme';
import type { SchemeSettings } from '../../engine/types/scheme';
import { useChallengeStore } from '../../store/challengeStore';
import { useSchemeStore } from '../../store/schemeStore';
import { useUiStore } from '../../store/uiStore';
import './SettingsDialog.css';

const CONSISTENCY_MODES: SchemeSettings['consistencyModel'][] = ['off', 'attribute', 'anomalies'];
const MODEL_DEPTHS: SchemeSettings['modelDepth'][] = ['learning', 'standard', 'expert'];

interface SettingsDialogProps {
    onClose: () => void;
}

export default function SettingsDialog({ onClose }: SettingsDialogProps) {
    const { t } = useTranslation();
    const settings = useSchemeStore((state) => state.settings);
    const setSetting = useSchemeStore((state) => state.setSetting);
    const required = useChallengeStore((state) => state.active?.requiredConsistencyModel ?? null);
    const defaultConsistencyModel = useUiStore((state) => state.defaultConsistencyModel);
    const setDefaultConsistencyModel = useUiStore((state) => state.setDefaultConsistencyModel);

    const profiles = Object.values(PRICING_PROFILES);
    const profile = PRICING_PROFILES[settings.pricingProfile] ?? profiles[0];

    return (
        <Dialog title={t('settings.title')} onClose={onClose} width={460}>
            <div className="set-row">
                <label className="set-label" htmlFor="set-consistency">
                    {t('settings.consistency')}
                </label>
                <select
                    id="set-consistency"
                    className="set-input"
                    value={settings.consistencyModel}
                    disabled={required !== null}
                    onChange={(event) =>
                        setSetting('consistencyModel', event.target.value as SchemeSettings['consistencyModel'])
                    }
                >
                    {CONSISTENCY_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                            {t(`settings.consistencyMode.${mode}`)}
                        </option>
                    ))}
                </select>
            </div>
            <p className="set-hint">
                {required
                    ? t('settings.consistencyLocked', { mode: t(`settings.consistencyMode.${required}`) })
                    : t(`settings.consistencyHint.${settings.consistencyModel}`)}
            </p>

            <label className="set-check">
                <input
                    type="checkbox"
                    checked={defaultConsistencyModel === settings.consistencyModel}
                    disabled={required !== null}
                    onChange={(event) =>
                        setDefaultConsistencyModel(
                            event.target.checked ? settings.consistencyModel : DEFAULT_SETTINGS.consistencyModel,
                        )
                    }
                />
                {t('settings.consistencyDefault')}
            </label>

            <div className="set-row">
                <label className="set-label" htmlFor="set-pricing">
                    {t('settings.pricing')}
                </label>
                <select
                    id="set-pricing"
                    className="set-input"
                    value={settings.pricingProfile}
                    onChange={(event) => setSetting('pricingProfile', event.target.value)}
                >
                    {profiles.map((item) => (
                        <option key={item.id} value={item.id}>
                            {t(`settings.pricingProfile.${item.id}`, { defaultValue: item.id })}
                        </option>
                    ))}
                </select>
            </div>
            <p className="set-hint">{t('settings.pricingAsOf', { date: profile.asOf })}</p>

            <div className="set-row">
                <label className="set-label" htmlFor="set-depth">
                    {t('settings.depth')}
                </label>
                <select
                    id="set-depth"
                    className="set-input"
                    value={settings.modelDepth}
                    onChange={(event) =>
                        setSetting('modelDepth', event.target.value as SchemeSettings['modelDepth'])
                    }
                >
                    {MODEL_DEPTHS.map((depth) => (
                        <option key={depth} value={depth}>
                            {t(`settings.depthLevel.${depth}`)}
                        </option>
                    ))}
                </select>
            </div>
            <p className="set-hint">{t(`settings.depthHint.${settings.modelDepth}`)}</p>

            <div className="set-row">
                <label className="set-label" htmlFor="set-seed">
                    {t('settings.seed')}
                </label>
                <input
                    id="set-seed"
                    className="set-input"
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    value={settings.seed}
                    onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        if (Number.isFinite(parsed)) setSetting('seed', Math.max(1, parsed));
                    }}
                />
            </div>
            <p className="set-hint">{t('settings.seedHint')}</p>
        </Dialog>
    );
}
