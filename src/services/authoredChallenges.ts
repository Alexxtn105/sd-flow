import { parseYaml } from '../engine/authoring/yaml';
import { validateSpec } from '../engine/authoring/spec';
import type { AuthoringIssue, ChallengeSpec } from '../engine/authoring/spec';
import StorageService, { STORAGE_KEYS } from './storageService';

export interface AuthoredChallenge {
    id: string;
    title: string;
    source: string;
    updatedAt: string;
}

export type ParseOutcome = { ok: true; spec: ChallengeSpec } | { ok: false; issues: AuthoringIssue[] };

export function parseChallengeSource(source: string): ParseOutcome {
    const parsed = parseYaml(source);

    if (!parsed.ok) {
        return { ok: false, issues: [{ path: `line ${parsed.line}`, code: parsed.code, values: { line: parsed.line } }] };
    }

    return validateSpec(parsed.value);
}

export function loadAuthored(): AuthoredChallenge[] {
    return StorageService.load<AuthoredChallenge[]>(STORAGE_KEYS.AUTHORED) ?? [];
}

export function saveAuthored(source: string, updatedAt: string): ParseOutcome {
    const outcome = parseChallengeSource(source);
    if (!outcome.ok) return outcome;

    const stored = loadAuthored().filter((item) => item.id !== outcome.spec.id);
    const entry: AuthoredChallenge = { id: outcome.spec.id, title: outcome.spec.title.ru, source, updatedAt };

    StorageService.save(STORAGE_KEYS.AUTHORED, [...stored, entry]);

    return outcome;
}

export function removeAuthored(id: string): void {
    StorageService.save(
        STORAGE_KEYS.AUTHORED,
        loadAuthored().filter((item) => item.id !== id),
    );
}
