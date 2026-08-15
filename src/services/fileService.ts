function withExtension(filename: string, extension: string): string {
    return filename.endsWith(extension) ? filename : `${filename}${extension}`;
}

function triggerDownload(filename: string, href: string): void {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.click();
}

function downloadBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    triggerDownload(filename, url);
    URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(withExtension(filename, '.json'), blob);
}

export function downloadMarkdown(filename: string, text: string): void {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(withExtension(filename, '.md'), blob);
}

export function downloadText(filename: string, text: string): void {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(filename, blob);
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
    triggerDownload(filename, dataUrl);
}

export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return copyViaSelection(text);
    }
}

function copyViaSelection(text: string): boolean {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();

    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(field);
    }
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

export function pickTextFile(accept: string): Promise<string | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;

        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }

            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
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
