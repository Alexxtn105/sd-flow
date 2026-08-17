import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { CHALLENGES } from '../../src/data/challenges';
import { DEMO_SCHEMES } from '../../src/data/demoSchemes';
import { GOLF_TASKS, INCIDENTS, INTERVIEWS, resolveChallenge } from '../../src/data/practice';
import type { Challenge } from '../../src/engine/challenges/types';
import type { ComponentParams } from '../../src/engine/types/component';
import type { SchemeV1 } from '../../src/engine/types/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

function foreignKeys(type: string, params: ComponentParams): string[] {
    const schema = registry.get(type)?.paramSchema;
    if (!schema) return [];

    return Object.keys(params).filter((key) => !(key in schema));
}

function foreignInScheme(scheme: SchemeV1, where: string): string[] {
    return scheme.nodes.flatMap((node) =>
        foreignKeys(node.type, node.params).map((key) => `${where}/${node.id} (${node.type}): ${key}`),
    );
}

function foreignInLocked(challenge: Challenge, where: string): string[] {
    const typeById = new Map(challenge.starter().nodes.map((node) => [node.id, node.type]));

    return Object.entries(challenge.lockedParams).flatMap(([nodeId, params]) => {
        const type = typeById.get(nodeId);
        if (!type) return [];

        return foreignKeys(type, params).map((key) => `${where}/locked/${nodeId} (${type}): ${key}`);
    });
}

function foreignInChallenge(challenge: Challenge, where: string): string[] {
    return [
        ...foreignInScheme(challenge.starter(), `${where}/starter`),
        ...foreignInLocked(challenge, where),
        ...challenge.referenceSolutions.flatMap((solution) =>
            foreignInScheme(solution.build(), `${where}/${solution.id}`),
        ),
    ];
}

describe('параметры поставляемых схем', () => {
    it('демо-схемы не носят параметров, которых у блока нет', () => {
        const foreign = DEMO_SCHEMES.flatMap((demo) => foreignInScheme(demo.build(), `demo/${demo.id}`));

        expect(foreign).toEqual([]);
    });

    it('задания каталога, их эталоны и запертые параметры описаны по схеме блока', () => {
        const foreign = CHALLENGES.flatMap((challenge) => foreignInChallenge(challenge, challenge.id));

        expect(foreign).toEqual([]);
    });

    it('наборы практики не подсовывают блоку чужой параметр', () => {
        const foreign = [
            ...INCIDENTS.flatMap((incident) =>
                foreignInChallenge(
                    resolveChallenge({ kind: 'incident', caseId: incident.id }),
                    `incident/${incident.id}`,
                ),
            ),
            ...GOLF_TASKS.flatMap((task) =>
                foreignInChallenge(resolveChallenge({ kind: 'golf', taskId: task.id }), `golf/${task.id}`),
            ),
            ...INTERVIEWS.flatMap((session) =>
                session.stages.flatMap((_, stage) =>
                    foreignInChallenge(
                        resolveChallenge({ kind: 'interview', sessionId: session.id, stage }),
                        `interview/${session.id}#${stage}`,
                    ),
                ),
            ),
        ];

        expect(foreign).toEqual([]);
    });
});
