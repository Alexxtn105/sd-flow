let counter = 0;

export function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}-${counter}`;
}

export function syncIdCounter(existingIds: string[]): void {
    for (const id of existingIds) {
        const tail = id.slice(id.lastIndexOf('-') + 1);
        const parsed = Number.parseInt(tail, 10);
        if (Number.isFinite(parsed) && parsed > counter) {
            counter = parsed;
        }
    }
}

export function resetIdCounter(): void {
    counter = 0;
}
