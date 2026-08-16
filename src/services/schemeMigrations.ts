import registry from '../engine/ComponentRegistry';
import { protocolOptions } from '../engine/ports';
import type { ComponentTypeId } from '../engine/types/component';
import { DEFAULT_POLICY, DEFAULT_SETTINGS, MODEL_VERSION } from '../engine/types/scheme';
import type { SchemeEdge, SchemeMeta, SchemeNode, SchemeV1, SchemeViewport } from '../engine/types/scheme';

export const SCHEME_VERSION = 1;

export type MigrationCode = 'unknown-blocks' | 'dropped-links' | 'model-behind' | 'model-ahead';

export interface MigrationNote {
    code: MigrationCode;
    values: Record<string, string | number>;
}

export interface MigrationReport {
    version: number;
    modelVersion: string;
    notes: MigrationNote[];
}

export type SchemeReadFailure = 'not-a-scheme' | 'future-version';

export type SchemeRead =
    | { ok: true; scheme: SchemeV1; report: MigrationReport }
    | { ok: false; reason: SchemeReadFailure };

const UNKNOWN_MODEL_VERSION = '0.0.0';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNodeLike(value: unknown): value is SchemeNode {
    return isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string';
}

function isEdgeLike(value: unknown): value is SchemeEdge {
    return isRecord(value) && typeof value.source === 'string' && typeof value.target === 'string';
}

function versionOf(value: Record<string, unknown>): number {
    return typeof value.version === 'number' ? value.version : Number.NaN;
}

export function compareModelVersions(left: string, right: string): number {
    const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
    const [leftParts, rightParts] = [parse(left), parse(right)];
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) return difference < 0 ? -1 : 1;
    }

    return 0;
}

function metaOf(value: unknown): SchemeMeta {
    const source = isRecord(value) ? value : {};
    const timestamp = typeof source.updatedAt === 'string' ? source.updatedAt : '';

    return {
        id: typeof source.id === 'string' ? source.id : 'scheme',
        name: typeof source.name === 'string' ? source.name : '',
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : timestamp,
        updatedAt: timestamp,
        ...(typeof source.description === 'string' ? { description: source.description } : {}),
        ...(typeof source.challengeId === 'string' ? { challengeId: source.challengeId } : {}),
        ...(typeof source.author === 'string' ? { author: source.author } : {}),
        ...(Array.isArray(source.tags) ? { tags: source.tags as string[] } : {}),
    };
}

function viewportOf(value: unknown): SchemeViewport {
    if (!isRecord(value)) return { x: 0, y: 0, zoom: 1 };

    const coordinate = (key: string, fallback: number) =>
        typeof value[key] === 'number' ? (value[key] as number) : fallback;

    return { x: coordinate('x', 0), y: coordinate('y', 0), zoom: coordinate('zoom', 1) };
}

function normalizeNode(node: SchemeNode): SchemeNode {
    return {
        ...node,
        position: node.position ?? { x: 0, y: 0 },
        params: node.params ?? {},
    };
}

function normalizeEdge(edge: SchemeEdge, typeById: Map<string, ComponentTypeId>): SchemeEdge {
    const source = typeById.get(edge.source);
    const target = typeById.get(edge.target);
    const known =
        source && target
            ? protocolOptions(source, edge.sourceHandle ?? '', target, edge.targetHandle ?? '')
            : [];
    const protocol = edge.protocol && known.includes(edge.protocol) ? edge.protocol : known[0];

    return {
        ...edge,
        id: edge.id ?? `${edge.source}-${edge.target}`,
        kind: edge.kind ?? 'sync',
        ...(protocol ? { protocol } : {}),
        calls: Array.isArray(edge.calls) ? edge.calls : [],
        policy: { ...DEFAULT_POLICY, ...(edge.policy ?? {}) },
        sourceHandle: edge.sourceHandle ?? '',
        targetHandle: edge.targetHandle ?? '',
        weight: typeof edge.weight === 'number' ? edge.weight : 1,
        pull: edge.pull === true,
    };
}

function modelNotes(modelVersion: string): MigrationNote[] {
    const order = compareModelVersions(modelVersion, MODEL_VERSION);
    if (order === 0) return [];

    return [
        {
            code: order < 0 ? 'model-behind' : 'model-ahead',
            values: { saved: modelVersion, current: MODEL_VERSION },
        },
    ];
}

export function migrateScheme(raw: unknown): SchemeRead {
    if (!isRecord(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
        return { ok: false, reason: 'not-a-scheme' };
    }

    const version = versionOf(raw);
    if (!Number.isFinite(version) || version < 1) return { ok: false, reason: 'not-a-scheme' };
    if (version > SCHEME_VERSION) return { ok: false, reason: 'future-version' };

    const modelVersion = typeof raw.modelVersion === 'string' ? raw.modelVersion : UNKNOWN_MODEL_VERSION;
    const declared = raw.nodes.filter(isNodeLike);
    const known = declared.filter((node) => registry.has(node.type));
    const keptIds = new Set(known.map((node) => node.id));
    const typeById = new Map(known.map((node) => [node.id, node.type]));
    const links = raw.edges
        .filter(isEdgeLike)
        .filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target));

    const unknownTypes = [...new Set(declared.filter((node) => !registry.has(node.type)).map((node) => node.type))];
    const notes: MigrationNote[] = modelNotes(modelVersion);

    if (unknownTypes.length > 0) {
        notes.push({
            code: 'unknown-blocks',
            values: { count: declared.length - known.length, types: unknownTypes.join(', ') },
        });
    }

    const droppedLinks = raw.edges.length - links.length;
    if (droppedLinks > 0) notes.push({ code: 'dropped-links', values: { count: droppedLinks } });

    const ui = isRecord(raw.ui) ? raw.ui : {};
    const viewport = viewportOf(ui.viewport);

    return {
        ok: true,
        scheme: {
            version: 1,
            modelVersion: MODEL_VERSION,
            meta: metaOf(raw.meta),
            nodes: known.map(normalizeNode),
            edges: links.map((edge) => normalizeEdge(edge, typeById)),
            settings: { ...DEFAULT_SETTINGS, ...(isRecord(raw.settings) ? raw.settings : {}) },
            ui: { viewport, xray: ui.xray === true },
        },
        report: { version, modelVersion, notes },
    };
}
