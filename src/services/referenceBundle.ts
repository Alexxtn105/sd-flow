import i18n from '../locales/i18n';

export type ReferenceNamespace = 'help' | 'hints';

type Bundle = Record<string, unknown>;

type Loader = () => Promise<{ default: Bundle }>;

const LOADERS: Record<string, Record<ReferenceNamespace, Loader>> = {
    ru: {
        help: () => import('../locales/ru/help.json'),
        hints: () => import('../locales/ru/hints.json'),
    },
    en: {
        help: () => import('../locales/en/help.json'),
        hints: () => import('../locales/en/hints.json'),
    },
};

const ready = new Set<string>();
const pending = new Map<string, Promise<void>>();

export function referenceLanguage(code: string): string {
    return code.startsWith('en') ? 'en' : 'ru';
}

export function isReferenceReady(code: string, namespaces: ReferenceNamespace[]): boolean {
    const language = referenceLanguage(code);
    return namespaces.every((namespace) => ready.has(`${language}:${namespace}`));
}

export function loadReference(code: string, namespaces: ReferenceNamespace[]): Promise<void> {
    const language = referenceLanguage(code);

    return Promise.all(namespaces.map((namespace) => loadOne(language, namespace))).then(() => undefined);
}

function loadOne(language: string, namespace: ReferenceNamespace): Promise<void> {
    const token = `${language}:${namespace}`;
    if (ready.has(token)) return Promise.resolve();

    const running = pending.get(token);
    if (running) return running;

    const task = LOADERS[language][namespace]()
        .then((bundle) => {
            i18n.addResourceBundle(language, namespace, bundle.default, true, true);
            ready.add(token);
        })
        .finally(() => {
            pending.delete(token);
        });

    pending.set(token, task);
    return task;
}
