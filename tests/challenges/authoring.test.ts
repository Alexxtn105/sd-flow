import { beforeAll, describe, expect, it } from 'vitest';
import registry from '../../src/engine/ComponentRegistry';
import initComponents from '../../src/engine/initComponents';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import { challengeFromSpec, validateSpec } from '../../src/engine/authoring/spec';
import type { ChallengeSpec } from '../../src/engine/authoring/spec';
import { schemeToSpecYaml } from '../../src/engine/authoring/emit';
import { CHALLENGE_TEMPLATE } from '../../src/engine/authoring/template';
import { parseYaml } from '../../src/engine/authoring/yaml';
import { compileTopology } from '../../src/engine/sim/compile';
import { CHALLENGES } from '../../src/data/challenges';
import { resolveChallenge } from '../../src/data/practice';

const SAMPLE_COUNT = 1000;

beforeAll(() => {
    registry.reset();
    initComponents();
});

function specFrom(source: string): ChallengeSpec {
    const parsed = parseYaml(source);
    if (!parsed.ok) throw new Error(`${parsed.code} на строке ${parsed.line}`);

    const outcome = validateSpec(parsed.value);
    if (!outcome.ok) throw new Error(outcome.issues.map((issue) => `${issue.path}: ${issue.code}`).join('; '));

    return outcome.spec;
}

function issuesFrom(source: string): string[] {
    const parsed = parseYaml(source);
    if (!parsed.ok) return [parsed.code];

    const outcome = validateSpec(parsed.value);

    return outcome.ok ? [] : outcome.issues.map((issue) => issue.code);
}

function replaced(from: string, to: string): string {
    return CHALLENGE_TEMPLATE.replace(from, to);
}

describe('авторский формат заданий', () => {
    it('шаблон разбирается, проверяется и превращается в задание', () => {
        const spec = specFrom(CHALLENGE_TEMPLATE);
        const challenge = challengeFromSpec(spec);

        expect(challenge.id).toBe('my-challenge');
        expect(challenge.requirements.map((requirement) => requirement.kind)).toEqual(['slo', 'capacity', 'budget']);
        expect(challenge.bonusObjectives).toHaveLength(1);
        expect(challenge.hints).toHaveLength(1);
        expect(challenge.flows[0].id).toBe('users');
        expect(challenge.brief.ru.startsWith('Опишите задачу')).toBe(true);
    });

    it('стартовая схема шаблона компилируется и не сдаётся', () => {
        const challenge = challengeFromSpec(specFrom(CHALLENGE_TEMPLATE));
        const scheme = challenge.starter();
        const errors = compileTopology(scheme).issues.filter((issue) => issue.severity === 'error');

        expect(errors).toEqual([]);
        expect(acceptChallenge({ challenge, scheme, attempt: 1, hintsUsed: [], sampleCount: SAMPLE_COUNT }).stars).toBe(0);
    });

    it('запертые параметры шаблона совпадают со стартовой схемой', () => {
        const challenge = challengeFromSpec(specFrom(CHALLENGE_TEMPLATE));
        const scheme = challenge.starter();
        const verdict = acceptChallenge({ challenge, scheme, attempt: 1, hintsUsed: [], sampleCount: SAMPLE_COUNT });

        expect(verdict.realism).toEqual([]);
    });

    it('ссылка на авторское задание решается тем же движком', () => {
        const spec = specFrom(CHALLENGE_TEMPLATE);

        expect(resolveChallenge({ kind: 'authored', spec }).id).toBe(spec.id);
    });

    it('спецификация сериализуема: в ней нет функций', () => {
        const spec = specFrom(CHALLENGE_TEMPLATE);

        expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    });

    it('принимает JSON вместо YAML', () => {
        const spec = specFrom(CHALLENGE_TEMPLATE);
        const asJson = JSON.stringify(spec);

        expect(specFrom(asJson).id).toBe(spec.id);
    });
});

describe('проверка авторского задания', () => {
    it('ловит неизвестный блок, группу и поток', () => {
        expect(issuesFrom(replaced('type: client-web', 'type: no-such-block'))).toContain('unknown-type');
        expect(issuesFrom(replaced('allowedGroups: [clients', 'allowedGroups: [no-such-group'))).toContain('unknown-group');
        expect(issuesFrom(replaced('flow: users\n    metric: latency.p99', 'flow: ghosts\n    metric: latency.p99'))).toContain(
            'unknown-flow',
        );
    });

    it('требует, чтобы поток совпадал с узлом стартовой схемы', () => {
        expect(issuesFrom(replaced('  - id: users\n    name:', '  - id: ghosts\n    name:'))).toContain('flow-without-node');
    });

    it('ловит недопустимый вид требования и недостающий порог', () => {
        expect(issuesFrom(replaced('kind: slo', 'kind: telepathy'))).toContain('unknown-value');
        expect(issuesFrom(replaced('    metric: latency.p99\n    max: 250', '    metric: latency.p99'))).toContain(
            'slo-without-threshold',
        );
    });

    it('ловит неизвестный сценарий и повтор идентификатора требования', () => {
        expect(issuesFrom(replaced('required: [peak]', 'required: [armageddon]'))).toContain('unknown-value');
        expect(issuesFrom(replaced('  - id: R2\n    kind: capacity', '  - id: R1\n    kind: capacity'))).toContain(
            'duplicate-requirement-id',
        );
    });

    it('сообщает, что схема не собирается, вместо падения', () => {
        const broken = replaced('  links: []', '  links:\n    - { from: users, to: users }');

        expect(issuesFrom(broken)).toContain('scheme-build-failed');
    });

    it('отвергает не-набор полей на верхнем уровне', () => {
        expect(issuesFrom('- просто список\n')).toContain('expected-mapping');
    });

    it('требует хотя бы один поток и хотя бы одно требование', () => {
        const outcome = validateSpec({ id: 'x', level: 1, estimatedMinutes: 10, title: 'x', brief: 'x' });
        const codes = outcome.ok ? [] : outcome.issues.map((issue) => issue.code);

        expect(codes).toContain('no-flows');
        expect(codes).toContain('no-requirements');
    });
});

describe('выгрузка схемы в авторский формат', () => {
    it('превращает схему холста в разбираемый фрагмент', () => {
        const scheme = CHALLENGES[0].referenceSolutions[0].build();
        const emitted = schemeToSpecYaml(scheme, 'starter', 0);
        const parsed = parseYaml(emitted);

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const starter = (parsed.value as { starter: { nodes: { id: string }[]; links: unknown[] } }).starter;

        expect(starter.nodes.map((node) => node.id)).toEqual(scheme.nodes.map((node) => node.id));
        expect(starter.links).toHaveLength(scheme.edges.length);
    });

    it('вставленная схема годится как стартовая для задания', () => {
        const scheme = CHALLENGES[0].referenceSolutions[0].build();
        const parsed = parseYaml(schemeToSpecYaml(scheme, 'starter', 0));

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const outcome = validateSpec({
            id: 'from-canvas',
            level: 2,
            estimatedMinutes: 30,
            title: 'Схема с холста',
            brief: 'Проверка выгрузки схемы в авторский формат',
            flows: [{ id: scheme.nodes[0].id, name: 'Поток', weightInScore: 1 }],
            requirements: [
                { id: 'R1', kind: 'capacity', desc: 'Ни один блок не перегружен', maxUtilization: 0.8 },
            ],
            scenarios: { required: ['peak'] },
            starter: (parsed.value as { starter: unknown }).starter,
        });

        expect(outcome.ok ? [] : outcome.issues).toEqual([]);
    });
});
