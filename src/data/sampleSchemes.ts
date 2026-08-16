import { challengesByLevel } from './challenges';
import { DEMO_SCHEMES } from './demoSchemes';
import type { Challenge, LocalizedText, ReferenceSolution } from '../engine/challenges/types';
import type { SchemeV1 } from '../engine/types/scheme';

export interface SampleScheme {
    id: string;
    name: LocalizedText;
    schemeName: LocalizedText;
    build: () => SchemeV1;
}

export interface SampleGroup {
    id: string;
    name: LocalizedText;
    level: number | null;
    items: SampleScheme[];
}

const DEMO_GROUP: LocalizedText = { ru: 'Демо-схемы', en: 'Demo schemes' };

export function referenceSchemeName(challenge: Challenge, solution: ReferenceSolution): LocalizedText {
    return {
        ru: `${challenge.title.ru} · ${solution.name.ru}`,
        en: `${challenge.title.en} · ${solution.name.en}`,
    };
}

export function sampleGroups(): SampleGroup[] {
    const demos: SampleGroup = {
        id: 'demo',
        name: DEMO_GROUP,
        level: null,
        items: DEMO_SCHEMES.map((demo) => ({
            id: `demo:${demo.id}`,
            name: demo.name,
            schemeName: demo.name,
            build: demo.build,
        })),
    };

    const references = challengesByLevel().flatMap((bucket) =>
        bucket.items
            .filter((challenge) => challenge.referenceSolutions.length > 0)
            .map((challenge) => ({
                id: `challenge:${challenge.id}`,
                name: challenge.title,
                level: bucket.level,
                items: challenge.referenceSolutions.map((solution) => ({
                    id: `reference:${challenge.id}:${solution.id}`,
                    name: solution.name,
                    schemeName: referenceSchemeName(challenge, solution),
                    build: solution.build,
                })),
            })),
    );

    return [demos, ...references];
}

export function sampleById(id: string): SampleScheme | undefined {
    for (const group of sampleGroups()) {
        const found = group.items.find((item) => item.id === id);
        if (found) return found;
    }

    return undefined;
}
