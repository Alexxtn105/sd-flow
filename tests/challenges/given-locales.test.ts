import { describe, expect, it } from 'vitest';
import { CHALLENGES } from '../../src/data/challenges';
import ruParams from '../../src/locales/ru/params.json';
import enParams from '../../src/locales/en/params.json';

describe('challenge given-data locales', () => {
    const givenKeys = [...new Set(CHALLENGES.flatMap((challenge) => Object.keys(challenge.given)))].sort();

    it('translates every given key in both languages', () => {
        const missingRu = givenKeys.filter((key) => !(key in ruParams));
        const missingEn = givenKeys.filter((key) => !(key in enParams));

        expect({ missingRu, missingEn }).toEqual({ missingRu: [], missingEn: [] });
    });
});
