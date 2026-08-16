import { useTranslation } from 'react-i18next';
import type { ParamField, ParamValue } from '../../../engine/types/component';
import { rangeStatus } from '../../../utils/paramRange';
import { fromSlider, sliderScaleOf, SLIDER_STEPS, toSlider } from '../../../utils/paramSlider';
import './ParamInput.css';

interface ParamInputProps {
    id?: string;
    field: ParamField | undefined;
    value: ParamValue;
    label: string;
    disabled?: boolean;
    withSlider?: boolean;
    onChange: (value: ParamValue) => void;
}

export default function ParamInput({
    id,
    field,
    value,
    label,
    disabled = false,
    withSlider = false,
    onChange,
}: ParamInputProps) {
    const { t } = useTranslation(['params']);

    if (field?.kind === 'boolean') {
        return (
            <input
                id={id}
                type="checkbox"
                className="ins-checkbox"
                checked={Boolean(value)}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
            />
        );
    }

    if (field?.kind === 'enum') {
        return (
            <select
                id={id}
                className="ins-input"
                value={String(value)}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
            >
                {field.options.map((option) => (
                    <option key={option} value={option}>
                        {t(`enum.${option}`, { defaultValue: option })}
                    </option>
                ))}
            </select>
        );
    }

    if (field?.kind === 'number') {
        const numeric = Number(value);
        const status = rangeStatus(value, field);
        const scale = withSlider ? sliderScaleOf(field, numeric) : null;

        return (
            <span className="param-number">
                <input
                    id={id}
                    type="number"
                    className={`ins-input ${status === 'ok' ? '' : `ins-input-${status}`}`}
                    value={numeric}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 'any'}
                    disabled={disabled}
                    onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value);
                        if (Number.isFinite(parsed)) onChange(parsed);
                    }}
                />
                {scale && (
                    <input
                        type="range"
                        className="param-slider nodrag"
                        min={0}
                        max={SLIDER_STEPS}
                        step={1}
                        value={toSlider(scale, numeric)}
                        disabled={disabled}
                        aria-label={label}
                        onChange={(event) => onChange(fromSlider(scale, Number(event.target.value)))}
                    />
                )}
            </span>
        );
    }

    return (
        <input
            id={id}
            type="text"
            className="ins-input"
            value={String(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
        />
    );
}
