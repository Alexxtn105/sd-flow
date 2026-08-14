import type {
    ComponentDefinition,
    ComponentParams,
    ComponentTypeId,
    GroupId,
    GroupWithComponents,
    ParamSchema,
    PortSpec,
} from './types/component';

const REQUIRED_FIELDS: (keyof ComponentDefinition)[] = [
    'id',
    'group',
    'shape',
    'wave',
    'icon',
    'ports',
    'defaultParams',
    'paramSchema',
    'helpId',
];

const EMPTY_PORTS: PortSpec = { in: [], out: [] };

class ComponentRegistry {
    #components: Map<ComponentTypeId, ComponentDefinition> = new Map();
    #groups: GroupId[] = [];
    #frozen = false;

    register<P extends ComponentParams>(definition: ComponentDefinition<P>): void {
        if (this.#frozen) {
            throw new Error(`ComponentRegistry заморожен, невозможно зарегистрировать "${definition?.id}"`);
        }

        for (const field of REQUIRED_FIELDS) {
            if (definition[field as keyof ComponentDefinition<P>] === undefined) {
                throw new Error(`Блок "${definition?.id ?? '?'}" не содержит обязательное поле "${field}"`);
            }
        }

        if (this.#components.has(definition.id)) {
            throw new Error(`Блок "${definition.id}" уже зарегистрирован`);
        }

        const paramKeys = Object.keys(definition.defaultParams);
        const schemaKeys = Object.keys(definition.paramSchema);

        for (const key of paramKeys) {
            if (!schemaKeys.includes(key)) {
                throw new Error(`Блок "${definition.id}": параметр "${key}" не описан в paramSchema`);
            }
        }

        for (const key of schemaKeys) {
            if (!paramKeys.includes(key)) {
                throw new Error(`Блок "${definition.id}": в paramSchema описан несуществующий параметр "${key}"`);
            }
        }

        this.#components.set(definition.id, definition as unknown as ComponentDefinition);
    }

    registerAll(definitions: ComponentDefinition[]): void {
        for (const definition of definitions) {
            this.register(definition);
        }
    }

    registerGroup(group: GroupId): void {
        if (this.#frozen) {
            throw new Error('ComponentRegistry заморожен');
        }
        if (this.#groups.includes(group)) {
            throw new Error(`Группа "${group}" уже зарегистрирована`);
        }
        this.#groups.push(group);
    }

    get(type: ComponentTypeId): ComponentDefinition | null {
        return this.#components.get(type) ?? null;
    }

    has(type: ComponentTypeId): boolean {
        return this.#components.has(type);
    }

    getPorts(type: ComponentTypeId): PortSpec {
        return this.#components.get(type)?.ports ?? EMPTY_PORTS;
    }

    getDefaultParams(type: ComponentTypeId): ComponentParams {
        const defaults = this.#components.get(type)?.defaultParams;
        return defaults ? { ...defaults } : {};
    }

    getParamSchema(type: ComponentTypeId): ParamSchema<ComponentParams> | null {
        return this.#components.get(type)?.paramSchema ?? null;
    }

    getIcon(type: ComponentTypeId): string {
        return this.#components.get(type)?.icon ?? 'widgets';
    }

    getShape(type: ComponentTypeId): ComponentDefinition['shape'] {
        return this.#components.get(type)?.shape ?? 'node';
    }

    getGroups(): GroupWithComponents[] {
        return this.#groups.map((group) => ({
            id: group,
            components: [...this.#components.values()].filter((component) => component.group === group),
        }));
    }

    getGroupIds(): GroupId[] {
        return [...this.#groups];
    }

    list(): ComponentDefinition[] {
        return [...this.#components.values()];
    }

    size(): number {
        return this.#components.size;
    }

    isFrozen(): boolean {
        return this.#frozen;
    }

    freeze(): void {
        this.#frozen = true;
    }

    reset(): void {
        this.#components.clear();
        this.#groups = [];
        this.#frozen = false;
    }
}

export default new ComponentRegistry();
