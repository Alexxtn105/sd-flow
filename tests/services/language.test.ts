import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OLD_AUTO_KEY = 'sd-flow-language';
const CHOICE_KEY = 'sd-flow-language-choice';

async function boot(): Promise<{ language: string; remember: (code: string) => void; storedAuto: string | null }> {
    vi.resetModules();

    const module = await import('../../src/locales/i18n');

    return {
        language: module.default.resolvedLanguage ?? '',
        remember: module.rememberLanguage,
        storedAuto: localStorage.getItem(OLD_AUTO_KEY),
    };
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    localStorage.clear();
});

describe('язык интерфейса', () => {
    it('без выбора игрока — английский', async () => {
        const booted = await boot();

        expect(booted.language).toBe('en');
    });

    it('выбор игрока переживает перезагрузку', async () => {
        localStorage.setItem(CHOICE_KEY, 'ru');

        expect((await boot()).language).toBe('ru');
    });

    it('старое автосохранённое значение не считается выбором и стирается', async () => {
        localStorage.setItem(OLD_AUTO_KEY, 'ru');

        const booted = await boot();

        expect(booted.language).toBe('en');
        expect(booted.storedAuto).toBeNull();
    });

    it('переключатель записывает выбор', async () => {
        const booted = await boot();
        booted.remember('ru');

        expect(localStorage.getItem(CHOICE_KEY)).toBe('ru');
    });

    it('сам по себе язык в хранилище не появляется', async () => {
        await boot();

        expect(localStorage.getItem(CHOICE_KEY)).toBeNull();
    });
});
