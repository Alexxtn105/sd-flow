import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { CHALLENGES } from '../../src/data/challenges';
import { DEMO_SCHEMES } from '../../src/data/demoSchemes';
import { GOLF_TASKS, INCIDENTS, INTERVIEWS, resolveChallenge } from '../../src/data/practice';
import type { ChallengeRef } from '../../src/data/practice';
import ruNodes from '../../src/locales/ru/nodes.json';
import enNodes from '../../src/locales/en/nodes.json';
import { nodeName } from '../../src/utils/nodeName';
import type { Translate } from '../../src/utils/nodeName';

const DICTIONARIES: Record<string, Record<string, string>> = { ru: ruNodes, en: enNodes };

function translate(language: string): Translate {
    return (key, options) => {
        if (options.ns !== 'nodes') return `${options.ns}:${key}`;
        return DICTIONARIES[language][key] ?? options.defaultValue;
    };
}

function practiceRefs(): ChallengeRef[] {
    return [
        ...INTERVIEWS.flatMap((session) =>
            session.stages.map((_, stage) => ({ kind: 'interview', sessionId: session.id, stage }) as ChallengeRef),
        ),
        ...INCIDENTS.map((incident) => ({ kind: 'incident', caseId: incident.id }) as ChallengeRef),
        ...GOLF_TASKS.map((task) => ({ kind: 'golf', taskId: task.id }) as ChallengeRef),
    ];
}

function shippedNodeIds(): Set<string> {
    const ids = new Set<string>();
    const collect = (nodes: { id: string }[]) => nodes.forEach((node) => ids.add(node.id));

    for (const demo of DEMO_SCHEMES) collect(demo.build().nodes);

    for (const challenge of CHALLENGES) {
        collect(challenge.starter().nodes);
        for (const solution of challenge.referenceSolutions) collect(solution.build().nodes);
    }

    for (const ref of practiceRefs()) collect(resolveChallenge(ref).starter().nodes);

    return ids;
}

beforeAll(() => {
    registry.reset();
    initComponents();
});

describe('имена блоков в готовых схемах', () => {
    it('каждый узел поставляемых схем назван на обоих языках', () => {
        const missing: string[] = [];

        for (const id of shippedNodeIds()) {
            if (!ruNodes[id as keyof typeof ruNodes]) missing.push(`ru: ${id}`);
            if (!enNodes[id as keyof typeof enNodes]) missing.push(`en: ${id}`);
        }

        expect(missing).toEqual([]);
    });

    it('в словаре нет имён для несуществующих узлов', () => {
        const shipped = shippedNodeIds();

        expect(Object.keys(ruNodes).filter((id) => !shipped.has(id))).toEqual([]);
    });

    it('имя узла берётся из подписи, затем из словаря, затем из типа блока', () => {
        const t = translate('ru');

        expect(nodeName({ id: 'hot-links', componentType: 'redis', label: 'Своя подпись' }, t)).toBe('Своя подпись');
        expect(nodeName({ id: 'hot-links', componentType: 'redis' }, t)).toBe('Горячие ссылки');
        expect(nodeName({ id: 'node-7', componentType: 'redis' }, t)).toBe('blocks:redis');
    });

    it('словарь переводит имя вместе с языком интерфейса', () => {
        const node = { id: 'hot-prefixes', componentType: 'redis' };

        expect(nodeName(node, translate('ru'))).toBe('Горячие префиксы');
        expect(nodeName(node, translate('en'))).toBe('Hot prefixes');
    });
});
