import { beforeEach, describe, expect, it } from 'vitest';
import {
    buildProgressBundle,
    mergeChallengeProgress,
    mergePracticeRecords,
    PROGRESS_FORMAT,
    PROGRESS_VERSION,
    readProgressBundle,
} from '../../src/services/progressTransfer';
import StorageService, { STORAGE_KEYS } from '../../src/services/storageService';
import { useChallengeStore } from '../../src/store/challengeStore';
import ruCommon from '../../src/locales/ru/common.json';
import enCommon from '../../src/locales/en/common.json';

const CHALLENGE = {
    'catalog:url-shortener': {
        challengeId: 'catalog:url-shortener',
        stars: 2 as const,
        attempts: 3,
        hintsUsed: [0],
        bestScore: 71,
    },
};

const PRACTICE = {
    'golf:cheap-feed': {
        id: 'golf:cheap-feed',
        attempts: 2,
        solved: true,
        bestSeconds: 400,
        bestCostUsd: 1200,
        bestStars: 2 as const,
    },
};

describe('файл прогресса', () => {
    it('переживает круг выгрузка → чтение', () => {
        const bundle = buildProgressBundle(CHALLENGE, PRACTICE, '2026-08-16T00:00:00.000Z');
        const read = readProgressBundle(JSON.parse(JSON.stringify(bundle)));

        expect(bundle.format).toBe(PROGRESS_FORMAT);
        expect(bundle.version).toBe(PROGRESS_VERSION);
        expect(read?.challenges).toEqual(CHALLENGE);
        expect(read?.practice).toEqual(PRACTICE);
        expect(read?.exportedAt).toBe('2026-08-16T00:00:00.000Z');
    });

    it('отвергает чужой файл и файл из будущей версии', () => {
        expect(readProgressBundle(null)).toBeNull();
        expect(readProgressBundle({ challenges: {} })).toBeNull();
        expect(readProgressBundle({ format: 'other', challenges: {} })).toBeNull();
        expect(
            readProgressBundle({ format: PROGRESS_FORMAT, version: PROGRESS_VERSION + 1, challenges: {} }),
        ).toBeNull();
    });

    it('чинит битые записи вместо того, чтобы верить им на слово', () => {
        const read = readProgressBundle({
            format: PROGRESS_FORMAT,
            version: PROGRESS_VERSION,
            challenges: {
                broken: { stars: 99, attempts: 'many', hintsUsed: [2, 'x', 0], bestScore: null },
                skipped: 'not-an-object',
            },
            practice: { run: { bestSeconds: 'fast', bestStars: -4, solved: 'yes' } },
        });

        expect(read?.challenges.broken).toEqual({
            challengeId: 'broken',
            stars: 3,
            attempts: 0,
            hintsUsed: [0, 2],
            bestScore: 0,
        });
        expect(read?.challenges.skipped).toBeUndefined();
        expect(read?.practice.run).toEqual({
            id: 'run',
            attempts: 0,
            solved: false,
            bestSeconds: null,
            bestCostUsd: null,
            bestStars: 0,
        });
    });
});

describe('слияние прогресса', () => {
    it('оставляет лучшее из двух наборов заданий', () => {
        const merged = mergeChallengeProgress(CHALLENGE, {
            'catalog:url-shortener': {
                challengeId: 'catalog:url-shortener',
                stars: 3,
                attempts: 1,
                hintsUsed: [1],
                bestScore: 60,
            },
            'catalog:pastebin': {
                challengeId: 'catalog:pastebin',
                stars: 1,
                attempts: 1,
                hintsUsed: [],
                bestScore: 50,
            },
        });

        expect(merged['catalog:url-shortener']).toEqual({
            challengeId: 'catalog:url-shortener',
            stars: 3,
            attempts: 3,
            hintsUsed: [0, 1],
            bestScore: 71,
        });
        expect(merged['catalog:pastebin'].stars).toBe(1);
    });

    it('в наборах практики берёт меньшее время и меньшую цену', () => {
        const merged = mergePracticeRecords(PRACTICE, {
            'golf:cheap-feed': {
                id: 'golf:cheap-feed',
                attempts: 5,
                solved: false,
                bestSeconds: 300,
                bestCostUsd: null,
                bestStars: 1,
            },
        });

        expect(merged['golf:cheap-feed']).toEqual({
            id: 'golf:cheap-feed',
            attempts: 5,
            solved: true,
            bestSeconds: 300,
            bestCostUsd: 1200,
            bestStars: 2,
        });
    });
});

describe('прогресс в сторе заданий', () => {
    beforeEach(() => {
        localStorage.clear();
        useChallengeStore.setState({ progress: {}, practice: {} });
    });

    it('выгружается со всем, что накоплено', () => {
        useChallengeStore.setState({ progress: CHALLENGE, practice: PRACTICE });
        const bundle = useChallengeStore.getState().exportProgress();

        expect(bundle.challenges).toEqual(CHALLENGE);
        expect(bundle.practice).toEqual(PRACTICE);
        expect(bundle.exportedAt.length).toBeGreaterThan(0);
    });

    it('загружается, сливается с текущим и сохраняется', () => {
        useChallengeStore.setState({ progress: CHALLENGE, practice: {} });

        const accepted = useChallengeStore
            .getState()
            .importProgress(buildProgressBundle({}, PRACTICE, '2026-08-16T00:00:00.000Z'));

        expect(accepted).toBe(true);
        expect(useChallengeStore.getState().practice).toEqual(PRACTICE);
        expect(useChallengeStore.getState().progress).toEqual(CHALLENGE);
        expect(StorageService.load(STORAGE_KEYS.PRACTICE)).toEqual(PRACTICE);
        expect(StorageService.load(STORAGE_KEYS.CHALLENGES)).toEqual(CHALLENGE);
    });

    it('чужой файл ничего не меняет', () => {
        useChallengeStore.setState({ progress: CHALLENGE, practice: {} });

        expect(useChallengeStore.getState().importProgress({ hello: 'world' })).toBe(false);
        expect(useChallengeStore.getState().progress).toEqual(CHALLENGE);
    });

    it('сообщения о выгрузке и загрузке переведены на оба языка', () => {
        for (const key of ['export', 'import', 'exported', 'imported', 'failed']) {
            expect(ruCommon.challenge.progress).toHaveProperty(key);
            expect(enCommon.challenge.progress).toHaveProperty(key);
        }
    });
});
