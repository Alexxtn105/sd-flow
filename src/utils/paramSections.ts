import type { ComponentParams, ParamField, ParamSection, ParamValue } from '../engine/types/component';

export const SECTION_ORDER: ParamSection[] = [
    'scale',
    'performance',
    'capacity',
    'behaviour',
    'consistency',
    'data',
    'reliability',
    'topology',
    'cost',
];

export interface ParamEntry {
    key: string;
    value: ParamValue;
    field: ParamField | undefined;
}

export interface ParamGroup {
    section: ParamSection;
    entries: ParamEntry[];
}

export function groupParams(params: ComponentParams, schema: Record<string, ParamField>): ParamGroup[] {
    const grouped = new Map<ParamSection, ParamEntry[]>();

    for (const [key, value] of Object.entries(params)) {
        const field = schema[key];
        const section = field?.section ?? 'behaviour';
        const bucket = grouped.get(section) ?? [];
        bucket.push({ key, value, field });
        grouped.set(section, bucket);
    }

    return SECTION_ORDER.filter((section) => grouped.has(section)).map((section) => ({
        section,
        entries: grouped.get(section) ?? [],
    }));
}
