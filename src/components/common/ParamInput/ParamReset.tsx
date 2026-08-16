import { useTranslation } from 'react-i18next';
import type { ParamValue } from '../../../engine/types/component';
import { formatDefault, isDefaultValue } from '../../../utils/paramDefault';
import './ParamInput.css';

interface ParamResetProps {
    value: ParamValue;
    defaultValue: ParamValue | undefined;
    onReset: (value: ParamValue) => void;
}

export default function ParamReset({ value, defaultValue, onReset }: ParamResetProps) {
    const { t } = useTranslation(['common']);

    if (defaultValue === undefined) return null;

    const untouched = isDefaultValue(value, defaultValue);

    return (
        <button
            type="button"
            className={`param-reset ${untouched ? 'param-reset-idle' : ''}`}
            disabled={untouched}
            title={
                untouched
                    ? t('inspector.defaultValue', { value: formatDefault(defaultValue) })
                    : t('inspector.resetToDefault', { value: formatDefault(defaultValue) })
            }
            aria-label={t('inspector.resetToDefault', { value: formatDefault(defaultValue) })}
            onClick={() => onReset(defaultValue)}
        >
            ↺
        </button>
    );
}
