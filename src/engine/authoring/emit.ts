import registry from '../ComponentRegistry';
import type { ParamValue } from '../types/component';
import type { SchemeV1 } from '../types/scheme';

const INDENT = '    ';

function scalar(value: ParamValue): string {
    if (typeof value === 'string') return /^[\w.-]+$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`;

    return String(value);
}

function changedParams(type: string, params: Record<string, ParamValue>): string {
    const defaults = registry.getDefaultParams(type);
    const changed = Object.entries(params).filter(([key, value]) => defaults[key] !== value);
    if (changed.length === 0) return '';

    return `, params: { ${changed.map(([key, value]) => `${key}: ${scalar(value)}`).join(', ')} }`;
}

export function schemeToSpecYaml(scheme: SchemeV1, key: string, level: number): string {
    const pad = INDENT.repeat(level);
    const lines = [`${pad}${key}:`, `${pad}${INDENT}nodes:`];

    for (const node of scheme.nodes) {
        const position = `, position: { x: ${Math.round(node.position.x)}, y: ${Math.round(node.position.y)} }`;
        lines.push(`${pad}${INDENT.repeat(2)}- { id: ${node.id}, type: ${node.type}${changedParams(node.type, node.params)}${position} }`);
    }

    if (scheme.edges.length === 0) {
        lines.push(`${pad}${INDENT}links: []`);
        return lines.join('\n');
    }

    lines.push(`${pad}${INDENT}links:`);

    for (const edge of scheme.edges) {
        lines.push(`${pad}${INDENT.repeat(2)}- { from: ${edge.source}, to: ${edge.target} }`);
    }

    return lines.join('\n');
}
