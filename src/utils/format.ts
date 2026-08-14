import type { ParamField, ParamValue } from '../engine/types/component';

export function formatNumber(value: number): string {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return '0';

    const magnitude = Math.abs(value);
    if (magnitude >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}G`;
    if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (magnitude >= 10_000) return `${(value / 1000).toFixed(0)}k`;
    if (magnitude >= 1) return String(Number(value.toFixed(2)));
    if (magnitude >= 0.001) return String(Number(value.toFixed(4)));
    return value.toExponential(1);
}

export function formatParamValue(
    value: ParamValue,
    field: ParamField | undefined,
    translateUnit: (unitKey: string) => string,
): string {
    if (typeof value === 'boolean') return value ? '✓' : '—';
    if (typeof value === 'string') return value === '' ? '—' : value;

    const unit = field && 'unitKey' in field && field.unitKey ? translateUnit(field.unitKey) : '';
    return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDateTime(iso: string, locale: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}
