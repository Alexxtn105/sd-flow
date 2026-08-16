import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParamField } from '../engine/types/component';
import { formatNumber } from '../utils/format';

export interface ParamHelp {
    name: string;
    hint: string;
    unit: string;
    limits: string;
    realistic: string;
}

export default function useParamHelp(): (key: string, field?: ParamField) => ParamHelp {
    const { t } = useTranslation(['common', 'params', 'hints']);

    return useCallback(
        (key: string, field?: ParamField): ParamHelp => {
            const numeric = field?.kind === 'number' ? field : undefined;
            const span = (from?: number, to?: number) =>
                from === undefined || to === undefined ? '' : `${formatNumber(from)}–${formatNumber(to)}`;

            return {
                name: t(key, { ns: 'params', defaultValue: key }),
                hint: t(key, { ns: 'hints', defaultValue: '' }),
                unit: field?.unitKey ? t(`units.${field.unitKey}`, { ns: 'params', defaultValue: field.unitKey }) : '',
                limits: span(numeric?.min, numeric?.max),
                realistic: span(numeric?.realistic?.min, numeric?.realistic?.max),
            };
        },
        [t],
    );
}
