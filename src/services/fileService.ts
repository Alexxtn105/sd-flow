export function downloadJson(filename: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.json') ? filename : `${filename}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

export function pickJsonFile(): Promise<unknown | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';

        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    resolve(JSON.parse(String(reader.result)));
                } catch {
                    resolve(null);
                }
            };
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
        };

        input.click();
    });
}

export function slugify(value: string): string {
    const trimmed = value.trim().toLowerCase().replace(/\s+/g, '-');
    return trimmed.replace(/[^\w-]+/g, '') || 'scheme';
}
