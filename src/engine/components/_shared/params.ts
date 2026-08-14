import type {
    ComponentDefinition,
    ComponentParams,
    NumericRange,
    ParamField,
    ParamSection,
} from '../../types/component';

interface NumberOptions {
    unitKey?: string;
    min?: number;
    max?: number;
    step?: number;
    realistic?: NumericRange;
}

export function num(section: ParamSection, options: NumberOptions = {}): ParamField {
    return { kind: 'number', section, ...options };
}

export function bool(section: ParamSection): ParamField {
    return { kind: 'boolean', section };
}

export function choice(section: ParamSection, options: string[]): ParamField {
    return { kind: 'enum', section, options };
}

export function text(section: ParamSection): ParamField {
    return { kind: 'text', section };
}

export function defineComponent<P extends ComponentParams>(
    definition: ComponentDefinition<P>,
): ComponentDefinition<P> {
    return definition;
}
