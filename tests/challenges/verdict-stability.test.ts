import { beforeAll, describe, expect, it } from 'vitest';
import initComponents from '../../src/engine/initComponents';
import registry from '../../src/engine/ComponentRegistry';
import { acceptChallenge } from '../../src/engine/challenges/accept';
import { evaluateRequirement } from '../../src/engine/challenges/predicates';
import { compileTopology } from '../../src/engine/sim/compile';
import { simulate } from '../../src/engine/sim/simulate';
import { CHALLENGES } from '../../src/data/challenges';
import { buildScheme } from '../helpers/scheme';
import type { Challenge, StorageRequirement } from '../../src/engine/challenges/types';
import type { SchemeV1 } from '../../src/engine/types/scheme';

beforeAll(() => {
    registry.reset();
    initComponents();
});

const SAMPLES = 2000;

function challengeOf(id: string): Challenge {
    const challenge = CHALLENGES.find((item) => item.id === id);
    if (!challenge) throw new Error(`Нет задания ${id}`);

    return challenge;
}

function withSettings(scheme: SchemeV1, settings: Partial<SchemeV1['settings']>): SchemeV1 {
    return { ...scheme, settings: { ...scheme.settings, ...settings } };
}

function starsFor(challenge: Challenge, scheme: SchemeV1): number {
    return acceptChallenge({ challenge, scheme, attempt: 1, hintsUsed: [], sampleCount: SAMPLES }).stars;
}

describe('вердикт не зависит от настроек песочницы', () => {
    const challenge = challengeOf('image-resize');
    const solution = challenge.referenceSolutions[1];

    it('сид схемы вердикт не двигает', () => {
        const verdicts = [1, 2, 5, 13, 14].map((seed) =>
            acceptChallenge({
                challenge,
                scheme: withSettings(solution.build(), { seed }),
                attempt: 1,
                hintsUsed: [],
                sampleCount: SAMPLES,
            }),
        );

        expect(new Set(verdicts.map((verdict) => verdict.stars)).size).toBe(1);
        expect(new Set(verdicts.map((verdict) => verdict.metrics.latencyP99)).size).toBe(1);
        expect(new Set(verdicts.map((verdict) => verdict.rubric.total)).size).toBe(1);
    });

    it('профиль цен вердикт не двигает', () => {
        const verdicts = ['aws-2026-q2', 'gcp-2026-q2', 'hetzner-2026-q2', 'on-prem'].map((pricingProfile) =>
            acceptChallenge({
                challenge,
                scheme: withSettings(solution.build(), { pricingProfile }),
                attempt: 1,
                hintsUsed: [],
                sampleCount: SAMPLES,
            }),
        );

        expect(new Set(verdicts.map((verdict) => verdict.stars)).size).toBe(1);
        expect(new Set(verdicts.map((verdict) => verdict.metrics.costMonth)).size).toBe(1);
    });

    it('глубина модели вердикт не двигает', () => {
        const stars = (['learning', 'standard', 'expert'] as const).map((modelDepth) =>
            starsFor(challenge, withSettings(solution.build(), { modelDepth })),
        );

        expect(new Set(stars).size).toBe(1);
    });
});

describe('требование по хранилищу считает только работающие блоки', () => {
    const requirement: StorageRequirement = {
        id: 'R',
        kind: 'storage',
        desc: { ru: 'Хватает места на год', en: 'Enough space for a year' },
        horizonYears: 1,
        headroom: 1,
    };

    function evaluate(withOrphan: boolean) {
        const scheme = buildScheme({
            nodes: [
                { id: 'client', type: 'client-web' },
                { id: 'api', type: 'service' },
                { id: 'db', type: 'postgres', params: { storageGb: 100 } },
                ...(withOrphan
                    ? [{ id: 'orphan', type: 'postgres', params: { storageGb: 1000000 } }]
                    : []),
            ],
            links: [
                { from: 'client', to: 'api' },
                { from: 'api', to: 'db' },
            ],
        });

        const topology = compileTopology(scheme);
        const result = simulate(scheme, { sampleCount: SAMPLES });

        return evaluateRequirement(requirement, {
            topology,
            result,
            scenario: 'baseline',
            relaxation: {},
        });
    }

    it('неподключённый блок не закрывает требование', () => {
        expect(evaluate(false).status).toBe('unmet');
        expect(evaluate(true).status).toBe('unmet');
        expect(evaluate(true).actual).toBe(evaluate(false).actual);
    });
});
