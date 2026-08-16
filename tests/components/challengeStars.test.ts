import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../src/locales/i18n';
import {
    AuthoredList,
    GolfList,
    IncidentList,
    InterviewList,
} from '../../src/components/panels/Challenges/PracticeLists';
import type { PracticeListProps } from '../../src/components/panels/Challenges/PracticeLists';
import { GOLF_TASKS, INCIDENTS, INTERVIEWS } from '../../src/data/practice';
import type { LocalizedText } from '../../src/engine/challenges/types';
import type { AuthoredChallenge } from '../../src/services/authoredChallenges';
import type { EarnedProgress } from '../../src/store/challengeStore';

const STARS_PER_CARD = 3;

const AUTHORED: AuthoredChallenge = {
    id: 'my-task',
    title: 'Своё задание',
    source: 'id: my-task',
    updatedAt: '2026-08-17T00:00:00.000Z',
};

type PracticeList = (props: PracticeListProps) => ReactElement;

const SETS: { name: string; list: PracticeList; cards: number }[] = [
    { name: 'интервью', list: InterviewList, cards: INTERVIEWS.length },
    { name: 'инциденты', list: IncidentList, cards: INCIDENTS.length },
    { name: 'гольф', list: GolfList, cards: GOLF_TASKS.length },
];

function occurrences(markup: string, marker: string): number {
    return markup.split(marker).length - 1;
}

function localized(text: LocalizedText): string {
    return text.ru;
}

function earned(stars: EarnedProgress['stars']): EarnedProgress {
    return { stars, attempts: 4 };
}

function renderPractice(list: PracticeList, stars: EarnedProgress['stars']): string {
    return renderToStaticMarkup(
        createElement(list, { localized, records: {}, earned: () => earned(stars), onOpen: () => {} }),
    );
}

function renderAuthored(stars: EarnedProgress['stars']): string {
    return renderToStaticMarkup(
        createElement(AuthoredList, {
            items: [AUTHORED],
            earned: () => earned(stars),
            onOpen: () => {},
            onEdit: () => {},
            onRemove: () => {},
        }),
    );
}

beforeAll(async () => {
    await i18n.changeLanguage('en');
});

describe('звёзды в списках заданий', () => {
    for (const set of SETS) {
        it(`${set.name}: каждая карточка показывает заработанные звёзды`, () => {
            const markup = renderPractice(set.list, 2);

            expect(set.cards).toBeGreaterThan(0);
            expect(occurrences(markup, 'chl-star-on')).toBe(2 * set.cards);
            expect(occurrences(markup, 'chl-star-off')).toBe((STARS_PER_CARD - 2) * set.cards);
        });

        it(`${set.name}: без прогресса рисуется пустая шкала, а не пусто`, () => {
            const markup = renderPractice(set.list, 0);

            expect(occurrences(markup, 'chl-star-on')).toBe(0);
            expect(occurrences(markup, 'chl-star-off')).toBe(STARS_PER_CARD * set.cards);
        });
    }

    it('свои задания показывают и звёзды, и число попыток', () => {
        const markup = renderAuthored(3);

        expect(occurrences(markup, 'chl-star-on')).toBe(STARS_PER_CARD);
        expect(occurrences(markup, 'chl-star-off')).toBe(0);
        expect(markup).toContain('attempts: 4');
    });

    it('шкала подписана числом звёзд', () => {
        expect(renderPractice(GolfList, 2)).toContain('Stars earned: 2 of 3');
    });
});
