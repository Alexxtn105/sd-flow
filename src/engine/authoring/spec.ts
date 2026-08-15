import registry from '../ComponentRegistry';
import { buildScheme } from '../../services/schemeBuilder';
import type { LinkSpec, NodeSpec, SchemeSpec } from '../../services/schemeBuilder';
import { SCENARIOS } from '../sim/scenarios';
import type { ScenarioId } from '../sim/scenarios';
import type { ComponentParams } from '../types/component';
import type {
    Challenge,
    ChallengeHint,
    ChallengeLevel,
    LocalizedText,
    Requirement,
    RequirementKind,
} from '../challenges/types';

export interface AuthoringIssue {
    path: string;
    code: string;
    values: Record<string, string | number>;
}

export interface ReferenceSolutionSpec {
    id: string;
    name: LocalizedText;
    tradeoff: LocalizedText;
    scheme: SchemeSpec;
}

export interface ChallengeSpec {
    id: string;
    level: ChallengeLevel;
    estimatedMinutes: number;
    tags: string[];
    title: LocalizedText;
    brief: LocalizedText;
    given: Record<string, number | string>;
    flows: { id: string; name: LocalizedText; weightInScore: number }[];
    constraints: { maxNodes?: number; allowedGroups?: string[]; forbiddenTypes?: string[] };
    requirements: Requirement[];
    bonusObjectives: Requirement[];
    scenarios: { required: ScenarioId[]; bonus: ScenarioId[] };
    relaxation: Partial<Record<ScenarioId, { latencyFactor?: number; utilizationFactor?: number; availabilityFloor?: number }>>;
    requiredConsistencyModel?: 'anomalies';
    lockedParams: Record<string, ComponentParams>;
    starter: SchemeSpec;
    hints: ChallengeHint[];
    referenceSolutions: ReferenceSolutionSpec[];
}

export type SpecResult = { ok: true; spec: ChallengeSpec } | { ok: false; issues: AuthoringIssue[] };

const LEVELS = [1, 2, 3, 4, 5];
const HINT_LEVELS = [1, 2, 3];
const SLO_METRICS = ['latency.p50', 'latency.p95', 'latency.p99', 'availability', 'errorRate'];
const CONSISTENCY_LEVELS = ['strong', 'read-your-writes', 'eventual'];
const SECURITY_CONTROLS = ['auth-on-edge', 'no-direct-client-to-db', 'tls-terminate', 'rate-limit-at-edge'];
const ANOMALY_CODES = [
    'stale-read',
    'read-your-writes',
    'monotonic-read',
    'lost-update',
    'write-conflict',
    'lost-write-lww',
    'duplicate-processing',
    'ordering-violation',
    'dirty-read',
    'non-repeatable-read',
    'phantom-read',
];

const REQUIREMENT_KINDS: RequirementKind[] = [
    'capability',
    'slo',
    'capacity',
    'durability',
    'redundancy',
    'budget',
    'storage',
    'freshness',
    'consistency',
    'anomaly',
    'geo',
    'rpo-rto',
    'security',
];

const MAX_ESTIMATED_MINUTES = 600;

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Checker {
    issues: AuthoringIssue[] = [];

    fail(path: string, code: string, values: Record<string, string | number> = {}): void {
        this.issues.push({ path, code, values });
    }

    bag(value: unknown, path: string): Bag | null {
        if (isBag(value)) return value;

        this.fail(path, 'expected-mapping');
        return null;
    }

    list(value: unknown, path: string): unknown[] | null {
        if (Array.isArray(value)) return value;

        this.fail(path, 'expected-list');
        return null;
    }

    text(value: unknown, path: string): string | null {
        if (typeof value === 'string' && value.trim() !== '') return value;

        this.fail(path, 'expected-text');
        return null;
    }

    slug(value: unknown, path: string): string | null {
        const raw = this.text(value, path);
        if (raw === null) return null;
        if (/^[a-zA-Z][\w-]*$/.test(raw)) return raw;

        this.fail(path, 'expected-slug');
        return null;
    }

    number(value: unknown, path: string, min = -Infinity, max = Infinity): number | null {
        if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) return value;

        this.fail(path, 'expected-number', { min: min === -Infinity ? '−∞' : min, max: max === Infinity ? '∞' : max });
        return null;
    }

    localized(value: unknown, path: string): LocalizedText | null {
        if (typeof value === 'string' && value.trim() !== '') return { ru: value, en: value };

        const bag = this.bag(value, path);
        if (!bag) return null;

        const ru = typeof bag.ru === 'string' ? bag.ru : null;
        const en = typeof bag.en === 'string' ? bag.en : null;

        if (ru === null && en === null) {
            this.fail(path, 'expected-localized');
            return null;
        }

        return { ru: ru ?? (en as string), en: en ?? (ru as string) };
    }

    oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | null {
        if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;

        this.fail(path, 'unknown-value', { allowed: allowed.join(', ') });
        return null;
    }
}

function readNodeMatcher(check: Checker, value: unknown, path: string): { group?: string; type?: string } | null {
    const bag = check.bag(value, path);
    if (!bag) return null;

    const matcher: { group?: string; type?: string } = {};

    if (bag.group !== undefined) {
        const group = check.text(bag.group, `${path}.group`);
        if (group !== null && !registry.getGroupIds().includes(group as never)) {
            check.fail(`${path}.group`, 'unknown-group', { group });
        }
        if (group !== null) matcher.group = group;
    }

    if (bag.type !== undefined) {
        const type = check.text(bag.type, `${path}.type`);
        if (type !== null && !registry.has(type)) check.fail(`${path}.type`, 'unknown-type', { type });
        if (type !== null) matcher.type = type;
    }

    if (matcher.group === undefined && matcher.type === undefined) check.fail(path, 'empty-matcher');

    return matcher;
}

function readMatcherList(check: Checker, value: unknown, path: string): { group?: string; type?: string }[] | undefined {
    if (value === undefined) return undefined;

    const list = check.list(value, path);
    if (!list) return undefined;

    return list
        .map((item, index) => readNodeMatcher(check, item, `${path}[${index}]`))
        .filter((item): item is { group?: string; type?: string } => item !== null);
}

function readRequirement(check: Checker, value: unknown, path: string, flowIds: Set<string>): Requirement | null {
    const bag = check.bag(value, path);
    if (!bag) return null;

    const id = check.slug(bag.id, `${path}.id`);
    const kind = check.oneOf(bag.kind, `${path}.kind`, REQUIREMENT_KINDS);
    const desc = check.localized(bag.desc, `${path}.desc`);
    if (id === null || kind === null || desc === null) return null;

    const base: { id: string; desc: LocalizedText; scenario?: ScenarioId } = { id, desc };

    if (bag.scenario !== undefined) {
        const scenario = check.oneOf(bag.scenario, `${path}.scenario`, SCENARIOS);
        if (scenario !== null) base.scenario = scenario;
    }

    const flow = (): string | null => {
        const value = check.text(bag.flow, `${path}.flow`);
        if (value !== null && !flowIds.has(value)) check.fail(`${path}.flow`, 'unknown-flow', { flow: value });
        return value;
    };

    switch (kind) {
        case 'capability': {
            const target = readNodeMatcher(check, bag.to, `${path}.to`);
            const source = flow();
            if (target === null || source === null) return null;

            const asyncBefore = bag.asyncBefore === undefined ? undefined : readNodeMatcher(check, bag.asyncBefore, `${path}.asyncBefore`);
            const viaAny = readMatcherList(check, bag.viaAny, `${path}.viaAny`);
            const notVia = readMatcherList(check, bag.notVia, `${path}.notVia`);

            return {
                ...base,
                kind,
                flow: source,
                to: target,
                ...(viaAny ? { viaAny } : {}),
                ...(notVia ? { notVia } : {}),
                ...(asyncBefore ? { asyncBefore } : {}),
            };
        }
        case 'slo': {
            const source = flow();
            const metric = check.oneOf(bag.metric, `${path}.metric`, SLO_METRICS);
            const max = bag.max === undefined ? null : check.number(bag.max, `${path}.max`, 0);
            const min = bag.min === undefined ? null : check.number(bag.min, `${path}.min`, 0);
            if (source === null || metric === null) return null;
            if (max === null && min === null) {
                check.fail(path, 'slo-without-threshold');
                return null;
            }

            return {
                ...base,
                kind,
                flow: source,
                metric,
                ...(max === null ? {} : { max }),
                ...(min === null ? {} : { min }),
            } as Requirement;
        }
        case 'capacity': {
            const maxUtilization = check.number(bag.maxUtilization, `${path}.maxUtilization`, 0, 1);
            return maxUtilization === null ? null : { ...base, kind, maxUtilization };
        }
        case 'durability': {
            const source = flow();
            const minReplication = check.number(bag.minReplication, `${path}.minReplication`, 1);
            return source === null || minReplication === null ? null : { ...base, kind, flow: source, minReplication };
        }
        case 'redundancy': {
            const source = flow();
            const minRedundancy = check.number(bag.minRedundancy, `${path}.minRedundancy`, 1);
            const spanAzs = bag.spanAzs === undefined ? undefined : check.number(bag.spanAzs, `${path}.spanAzs`, 1);
            if (source === null || minRedundancy === null) return null;

            return { ...base, kind, flow: source, minRedundancy, ...(spanAzs === null || spanAzs === undefined ? {} : { spanAzs }) };
        }
        case 'budget': {
            const maxMonthlyCostUsd = check.number(bag.maxMonthlyCostUsd, `${path}.maxMonthlyCostUsd`, 0);
            return maxMonthlyCostUsd === null ? null : { ...base, kind, maxMonthlyCostUsd };
        }
        case 'storage': {
            const horizonYears = check.number(bag.horizonYears, `${path}.horizonYears`, 0);
            const headroom = check.number(bag.headroom, `${path}.headroom`, 1);
            return horizonYears === null || headroom === null ? null : { ...base, kind, horizonYears, headroom };
        }
        case 'freshness': {
            const maxLagSec = check.number(bag.maxLagSec, `${path}.maxLagSec`, 0);
            return maxLagSec === null ? null : { ...base, kind, maxLagSec };
        }
        case 'consistency': {
            const source = flow();
            const requires = check.oneOf(bag.requires, `${path}.requires`, CONSISTENCY_LEVELS);
            if (source === null || requires === null) return null;

            return { ...base, kind, flow: source, requires } as Requirement;
        }
        case 'anomaly': {
            const code = check.oneOf(bag.code, `${path}.code`, ANOMALY_CODES);
            const maxRatePerSec = bag.maxRatePerSec === undefined ? null : check.number(bag.maxRatePerSec, `${path}.maxRatePerSec`, 0);
            const maxSharePercent =
                bag.maxSharePercent === undefined ? null : check.number(bag.maxSharePercent, `${path}.maxSharePercent`, 0, 100);
            if (code === null) return null;
            if (maxRatePerSec === null && maxSharePercent === null) {
                check.fail(path, 'anomaly-without-threshold');
                return null;
            }

            return {
                ...base,
                kind,
                code,
                ...(maxRatePerSec === null ? {} : { maxRatePerSec }),
                ...(maxSharePercent === null ? {} : { maxSharePercent }),
            };
        }
        case 'geo': {
            const minRegions = bag.minRegions === undefined ? undefined : check.number(bag.minRegions, `${path}.minRegions`, 1);
            const maxClientRttMs =
                bag.maxClientRttMs === undefined ? undefined : check.number(bag.maxClientRttMs, `${path}.maxClientRttMs`, 0);
            const residency = bag.residency === undefined ? undefined : bag.residency === true;

            if (minRegions === undefined && maxClientRttMs === undefined && residency === undefined) {
                check.fail(path, 'geo-without-target');
                return null;
            }

            return {
                ...base,
                kind,
                ...(minRegions === null || minRegions === undefined ? {} : { minRegions }),
                ...(maxClientRttMs === null || maxClientRttMs === undefined ? {} : { maxClientRttMs }),
                ...(residency === undefined ? {} : { residency }),
            };
        }
        case 'rpo-rto': {
            const maxRpoSec = check.number(bag.maxRpoSec, `${path}.maxRpoSec`, 0);
            const maxRtoSec = check.number(bag.maxRtoSec, `${path}.maxRtoSec`, 0);
            return maxRpoSec === null || maxRtoSec === null ? null : { ...base, kind, maxRpoSec, maxRtoSec };
        }
        default: {
            const list = check.list(bag.requires, `${path}.requires`);
            if (!list) return null;

            const controls = list
                .map((item, index) => check.oneOf(item, `${path}.requires[${index}]`, SECURITY_CONTROLS))
                .filter((item): item is string => item !== null);

            return { ...base, kind: 'security', requires: controls } as Requirement;
        }
    }
}

function readParams(check: Checker, value: unknown, path: string): ComponentParams {
    const bag = check.bag(value, path);
    if (!bag) return {};

    const params: ComponentParams = {};

    for (const [key, raw] of Object.entries(bag)) {
        if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') {
            params[key] = raw;
            continue;
        }

        check.fail(`${path}.${key}`, 'expected-param-value');
    }

    return params;
}

function readSchemeSpec(check: Checker, value: unknown, path: string): SchemeSpec | null {
    const bag = check.bag(value, path);
    if (!bag) return null;

    const rawNodes = check.list(bag.nodes, `${path}.nodes`);
    if (!rawNodes) return null;

    const nodes: NodeSpec[] = [];

    rawNodes.forEach((item, index) => {
        const nodePath = `${path}.nodes[${index}]`;
        const nodeBag = check.bag(item, nodePath);
        if (!nodeBag) return;

        const id = check.slug(nodeBag.id, `${nodePath}.id`);
        const type = check.text(nodeBag.type, `${nodePath}.type`);
        if (id === null || type === null) return;
        if (!registry.has(type)) {
            check.fail(`${nodePath}.type`, 'unknown-type', { type });
            return;
        }

        nodes.push({
            id,
            type,
            ...(nodeBag.params === undefined ? {} : { params: readParams(check, nodeBag.params, `${nodePath}.params`) }),
            ...(typeof nodeBag.parentId === 'string' ? { parentId: nodeBag.parentId } : {}),
            ...(isBag(nodeBag.position) && typeof nodeBag.position.x === 'number' && typeof nodeBag.position.y === 'number'
                ? { position: { x: nodeBag.position.x, y: nodeBag.position.y } }
                : {}),
            ...(isBag(nodeBag.size) && typeof nodeBag.size.width === 'number' && typeof nodeBag.size.height === 'number'
                ? { size: { width: nodeBag.size.width, height: nodeBag.size.height } }
                : {}),
        });
    });

    const known = new Set(nodes.map((node) => node.id));
    if (known.size !== nodes.length) check.fail(`${path}.nodes`, 'duplicate-node-id');

    const links: LinkSpec[] = [];
    const rawLinks = bag.links === undefined ? [] : (check.list(bag.links, `${path}.links`) ?? []);

    rawLinks.forEach((item, index) => {
        const linkPath = `${path}.links[${index}]`;
        const linkBag = check.bag(item, linkPath);
        if (!linkBag) return;

        const from = check.text(linkBag.from, `${linkPath}.from`);
        const to = check.text(linkBag.to, `${linkPath}.to`);
        if (from === null || to === null) return;

        if (!known.has(from)) check.fail(`${linkPath}.from`, 'unknown-node', { node: from });
        if (!known.has(to)) check.fail(`${linkPath}.to`, 'unknown-node', { node: to });

        const calls = isBag(linkBag.calls) ? linkBag.calls : null;

        links.push({
            from,
            to,
            ...(typeof linkBag.weight === 'number' ? { weight: linkBag.weight } : {}),
            ...(typeof linkBag.readShare === 'number' ? { readShare: linkBag.readShare } : {}),
            ...(calls
                ? {
                      calls: {
                          ...(typeof calls.requestBytes === 'number' ? { requestBytes: calls.requestBytes } : {}),
                          ...(typeof calls.responseBytes === 'number' ? { responseBytes: calls.responseBytes } : {}),
                          ...(typeof calls.fanout === 'number' ? { fanout: calls.fanout } : {}),
                      },
                  }
                : {}),
            ...(isBag(linkBag.policy)
                ? {
                      policy: {
                          ...(typeof linkBag.policy.timeoutMs === 'number' ? { timeoutMs: linkBag.policy.timeoutMs } : {}),
                          ...(typeof linkBag.policy.retries === 'number' ? { retries: linkBag.policy.retries } : {}),
                          ...(typeof linkBag.policy.circuitBreaker === 'boolean'
                              ? { circuitBreaker: linkBag.policy.circuitBreaker }
                              : {}),
                          ...(typeof linkBag.policy.idempotent === 'boolean' ? { idempotent: linkBag.policy.idempotent } : {}),
                      },
                  }
                : {}),
        });
    });

    const spec: SchemeSpec = { id: `${path}`, name: `${path}`, nodes, links };

    try {
        buildScheme(spec);
    } catch (error) {
        check.fail(path, 'scheme-build-failed', { message: error instanceof Error ? error.message : String(error) });
        return null;
    }

    return spec;
}

function readHints(check: Checker, value: unknown, requirementIds: Set<string>): ChallengeHint[] {
    if (value === undefined) return [];

    const list = check.list(value, 'hints');
    if (!list) return [];

    const hints: ChallengeHint[] = [];

    list.forEach((item, index) => {
        const path = `hints[${index}]`;
        const bag = check.bag(item, path);
        if (!bag) return;

        const level = check.number(bag.level, `${path}.level`, 1, 3);
        const cost = check.number(bag.cost, `${path}.cost`, 1);
        const text = check.localized(bag.text, `${path}.text`);
        if (level === null || cost === null || text === null) return;
        if (!HINT_LEVELS.includes(level)) {
            check.fail(`${path}.level`, 'unknown-value', { allowed: HINT_LEVELS.join(', ') });
            return;
        }

        const forRequirement = typeof bag.forRequirement === 'string' ? bag.forRequirement : undefined;
        if (forRequirement !== undefined && !requirementIds.has(forRequirement)) {
            check.fail(`${path}.forRequirement`, 'unknown-requirement', { id: forRequirement });
            return;
        }

        hints.push({ level: level as ChallengeHint['level'], cost, text, ...(forRequirement ? { forRequirement } : {}) });
    });

    return hints;
}

function readScenarioList(check: Checker, value: unknown, path: string): ScenarioId[] {
    if (value === undefined) return [];

    const list = check.list(value, path);
    if (!list) return [];

    return list
        .map((item, index) => check.oneOf(item, `${path}[${index}]`, SCENARIOS))
        .filter((item): item is ScenarioId => item !== null);
}

export function validateSpec(value: unknown): SpecResult {
    const check = new Checker();
    const root = check.bag(value, 'root');
    if (!root) return { ok: false, issues: check.issues };

    const id = check.slug(root.id, 'id');
    const title = check.localized(root.title, 'title');
    const brief = check.localized(root.brief, 'brief');
    const level = check.number(root.level, 'level', 1, 5);
    const estimatedMinutes = check.number(root.estimatedMinutes, 'estimatedMinutes', 1, MAX_ESTIMATED_MINUTES);

    if (level !== null && !LEVELS.includes(level)) check.fail('level', 'unknown-value', { allowed: LEVELS.join(', ') });

    const starter = readSchemeSpec(check, root.starter, 'starter');

    const starterNodeIds = new Set((starter?.nodes ?? []).map((node) => node.id));
    const flows: ChallengeSpec['flows'] = [];
    const rawFlows = check.list(root.flows, 'flows');

    (rawFlows ?? []).forEach((item, index) => {
        const path = `flows[${index}]`;
        const bag = check.bag(item, path);
        if (!bag) return;

        const flowId = check.text(bag.id, `${path}.id`);
        const name = check.localized(bag.name, `${path}.name`);
        const weightInScore = check.number(bag.weightInScore, `${path}.weightInScore`, 0, 1);
        if (flowId === null || name === null || weightInScore === null) return;

        if (starter && !starterNodeIds.has(flowId)) check.fail(`${path}.id`, 'flow-without-node', { flow: flowId });

        flows.push({ id: flowId, name, weightInScore });
    });

    if (flows.length === 0) check.fail('flows', 'no-flows');

    const flowIds = new Set(flows.map((flow) => flow.id));
    const requirements: Requirement[] = [];
    const rawRequirements = check.list(root.requirements, 'requirements');

    (rawRequirements ?? []).forEach((item, index) => {
        const requirement = readRequirement(check, item, `requirements[${index}]`, flowIds);
        if (requirement) requirements.push(requirement);
    });

    if (requirements.length === 0) check.fail('requirements', 'no-requirements');

    const bonusObjectives: Requirement[] = [];

    (root.bonusObjectives === undefined ? [] : (check.list(root.bonusObjectives, 'bonusObjectives') ?? [])).forEach(
        (item, index) => {
            const requirement = readRequirement(check, item, `bonusObjectives[${index}]`, flowIds);
            if (requirement) bonusObjectives.push(requirement);
        },
    );

    const allIds = [...requirements, ...bonusObjectives].map((requirement) => requirement.id);
    if (new Set(allIds).size !== allIds.length) check.fail('requirements', 'duplicate-requirement-id');

    const scenariosBag = root.scenarios === undefined ? {} : (check.bag(root.scenarios, 'scenarios') ?? {});
    const scenarios = {
        required: readScenarioList(check, scenariosBag.required, 'scenarios.required'),
        bonus: readScenarioList(check, scenariosBag.bonus, 'scenarios.bonus'),
    };

    const relaxation: ChallengeSpec['relaxation'] = {};
    const relaxationBag = root.relaxation === undefined ? {} : (check.bag(root.relaxation, 'relaxation') ?? {});

    for (const [key, raw] of Object.entries(relaxationBag)) {
        const scenario = check.oneOf(key, `relaxation.${key}`, SCENARIOS);
        const bag = check.bag(raw, `relaxation.${key}`);
        if (scenario === null || !bag) continue;

        relaxation[scenario] = {
            ...(typeof bag.latencyFactor === 'number' ? { latencyFactor: bag.latencyFactor } : {}),
            ...(typeof bag.utilizationFactor === 'number' ? { utilizationFactor: bag.utilizationFactor } : {}),
            ...(typeof bag.availabilityFloor === 'number' ? { availabilityFloor: bag.availabilityFloor } : {}),
        };
    }

    const constraintsBag = root.constraints === undefined ? {} : (check.bag(root.constraints, 'constraints') ?? {});
    const allowedGroups = constraintsBag.allowedGroups === undefined ? undefined : (check.list(constraintsBag.allowedGroups, 'constraints.allowedGroups') ?? []);
    const forbiddenTypes = constraintsBag.forbiddenTypes === undefined ? undefined : (check.list(constraintsBag.forbiddenTypes, 'constraints.forbiddenTypes') ?? []);

    (allowedGroups ?? []).forEach((group, index) => {
        if (typeof group === 'string' && registry.getGroupIds().includes(group as never)) return;
        check.fail(`constraints.allowedGroups[${index}]`, 'unknown-group', { group: String(group) });
    });

    (forbiddenTypes ?? []).forEach((type, index) => {
        if (typeof type === 'string' && registry.has(type)) return;
        check.fail(`constraints.forbiddenTypes[${index}]`, 'unknown-type', { type: String(type) });
    });

    const lockedParams: Record<string, ComponentParams> = {};
    const lockedBag = root.lockedParams === undefined ? {} : (check.bag(root.lockedParams, 'lockedParams') ?? {});

    for (const [nodeId, raw] of Object.entries(lockedBag)) {
        if (starter && !starterNodeIds.has(nodeId)) {
            check.fail(`lockedParams.${nodeId}`, 'unknown-node', { node: nodeId });
            continue;
        }

        lockedParams[nodeId] = readParams(check, raw, `lockedParams.${nodeId}`);
    }

    const given: Record<string, number | string> = {};
    const givenBag = root.given === undefined ? {} : (check.bag(root.given, 'given') ?? {});

    for (const [key, raw] of Object.entries(givenBag)) {
        if (typeof raw === 'number' || typeof raw === 'string') {
            given[key] = raw;
            continue;
        }

        check.fail(`given.${key}`, 'expected-param-value');
    }

    const referenceSolutions: ReferenceSolutionSpec[] = [];

    (root.referenceSolutions === undefined ? [] : (check.list(root.referenceSolutions, 'referenceSolutions') ?? [])).forEach(
        (item, index) => {
            const path = `referenceSolutions[${index}]`;
            const bag = check.bag(item, path);
            if (!bag) return;

            const solutionId = check.slug(bag.id, `${path}.id`);
            const name = check.localized(bag.name, `${path}.name`);
            const tradeoff = check.localized(bag.tradeoff, `${path}.tradeoff`);
            const scheme = readSchemeSpec(check, bag.scheme, `${path}.scheme`);
            if (solutionId === null || name === null || tradeoff === null || scheme === null) return;

            referenceSolutions.push({ id: solutionId, name, tradeoff, scheme });
        },
    );

    const tags = (root.tags === undefined ? [] : (check.list(root.tags, 'tags') ?? []))
        .map((tag, index) => check.text(tag, `tags[${index}]`))
        .filter((tag): tag is string => tag !== null);

    const hints = readHints(check, root.hints, new Set(requirements.map((requirement) => requirement.id)));

    const consistency =
        root.requiredConsistencyModel === undefined
            ? undefined
            : check.oneOf(root.requiredConsistencyModel, 'requiredConsistencyModel', ['anomalies']);

    if (check.issues.length > 0) return { ok: false, issues: check.issues };
    if (id === null || title === null || brief === null || level === null || estimatedMinutes === null || starter === null) {
        return { ok: false, issues: [{ path: 'root', code: 'incomplete', values: {} }] };
    }

    return {
        ok: true,
        spec: {
            id,
            level: level as ChallengeLevel,
            estimatedMinutes,
            tags,
            title,
            brief,
            given,
            flows,
            constraints: {
                ...(typeof constraintsBag.maxNodes === 'number' ? { maxNodes: constraintsBag.maxNodes } : {}),
                ...(allowedGroups ? { allowedGroups: allowedGroups as string[] } : {}),
                ...(forbiddenTypes ? { forbiddenTypes: forbiddenTypes as string[] } : {}),
            },
            requirements,
            bonusObjectives,
            scenarios,
            relaxation,
            ...(consistency ? { requiredConsistencyModel: consistency } : {}),
            lockedParams,
            starter: { ...starter, id, name: title.ru },
            hints,
            referenceSolutions,
        },
    };
}

export function challengeFromSpec(spec: ChallengeSpec): Challenge {
    return {
        id: spec.id,
        level: spec.level,
        estimatedMinutes: spec.estimatedMinutes,
        tags: spec.tags,
        title: spec.title,
        brief: spec.brief,
        given: spec.given,
        flows: spec.flows,
        constraints: spec.constraints,
        requirements: spec.requirements,
        bonusObjectives: spec.bonusObjectives,
        scenarios: spec.scenarios,
        relaxation: spec.relaxation,
        ...(spec.requiredConsistencyModel ? { requiredConsistencyModel: spec.requiredConsistencyModel } : {}),
        lockedParams: spec.lockedParams,
        starter: () => buildScheme(spec.starter),
        hints: spec.hints,
        referenceSolutions: spec.referenceSolutions.map((solution) => ({
            id: solution.id,
            name: solution.name,
            tradeoff: solution.tradeoff,
            build: () => buildScheme(solution.scheme),
        })),
    };
}
