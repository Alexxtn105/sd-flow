export type Translate = (key: string, options: { ns: string; defaultValue: string }) => string;

export interface NamedNode {
    id: string;
    componentType: string;
    label?: string;
}

export function blockName(componentType: string, t: Translate): string {
    return t(componentType, { ns: 'blocks', defaultValue: componentType });
}

export function roleName(id: string, t: Translate): string {
    return t(id, { ns: 'nodes', defaultValue: '' });
}

export function nodeName(node: NamedNode, t: Translate): string {
    return node.label || roleName(node.id, t) || blockName(node.componentType, t);
}
