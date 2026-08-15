export const STORAGE_KEYS = {
    AUTO_SAVE: 'sd-autosave',
    SCHEMES: 'sd-schemes',
    THEME: 'sd-theme',
    PREFERENCES: 'sd-preferences',
    CHALLENGES: 'sd-challenges',
    PRACTICE: 'sd-practice',
    AUTHORED: 'sd-authored',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export type SaveResult =
    | { success: true; sizeMb: number }
    | { success: false; error: 'unavailable' | 'too-large' | 'quota-exceeded' | 'unknown'; sizeMb?: number };

const MAX_SIZE_MB = 4;

class StorageService {
    static isAvailable(): boolean {
        try {
            if (typeof localStorage === 'undefined') return false;
            const probe = '__sd_storage_probe__';
            localStorage.setItem(probe, '1');
            localStorage.removeItem(probe);
            return true;
        } catch {
            return false;
        }
    }

    static save(key: StorageKey, data: unknown): SaveResult {
        if (!this.isAvailable()) {
            return { success: false, error: 'unavailable' };
        }

        const serialized = JSON.stringify(data);
        const sizeMb = serialized.length / (1024 * 1024);

        if (sizeMb > MAX_SIZE_MB) {
            return { success: false, error: 'too-large', sizeMb };
        }

        try {
            localStorage.setItem(key, serialized);
            return { success: true, sizeMb };
        } catch (error) {
            const name = error instanceof Error ? error.name : '';
            if (name === 'QuotaExceededError') {
                this.remove(STORAGE_KEYS.AUTO_SAVE);
                try {
                    localStorage.setItem(key, serialized);
                    return { success: true, sizeMb };
                } catch {
                    return { success: false, error: 'quota-exceeded', sizeMb };
                }
            }
            return { success: false, error: 'unknown', sizeMb };
        }
    }

    static load<T>(key: StorageKey): T | null {
        if (!this.isAvailable()) return null;

        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            return JSON.parse(raw) as T;
        } catch {
            this.remove(key);
            return null;
        }
    }

    static remove(key: StorageKey): void {
        if (!this.isAvailable()) return;
        localStorage.removeItem(key);
    }

    static usedBytes(): number {
        if (!this.isAvailable()) return 0;
        let total = 0;
        for (const key of Object.values(STORAGE_KEYS)) {
            total += (localStorage.getItem(key)?.length ?? 0) + key.length;
        }
        return total;
    }
}

export default StorageService;
