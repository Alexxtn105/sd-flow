import { DAYS_PER_MONTH, DEFAULT_PRICING } from './constants';
import { withSurcharges } from './cost';
import type { MeteredData } from './cost';
import { backupGbOf, HORIZON_DAYS, logsGbDayOf } from './derived';
import type {
    ComponentDefinition,
    ComponentParams,
    CostBreakdown,
    CostContext,
    ParamField,
    ParamValue,
    PricingProfile,
    StorageContext,
} from '../types/component';

export type CostArticle = 'compute' | 'storage' | 'network' | 'requests';

export const COST_ARTICLES: CostArticle[] = ['compute', 'storage', 'network', 'requests'];

export interface CostDriver {
    param: string;
    articles: CostArticle[];
}

const PROBE_LAMBDA = 5000;
const PROBE_READ_SHARE = 0.8;
const PROBE_REQUEST_BYTES = 2000;
const PROBE_RESPONSE_BYTES = 20000;
const PROBE_STORAGE_GB = 500;
const PROBE_EGRESS_GB_MONTH = 1000;
const PROBE_FACTOR = 2;
const EPSILON = 1e-9;

function baseContext(definition: ComponentDefinition, params: ComponentParams) {
    return {
        nodeId: definition.id,
        params,
        instances: typeof params.instances === 'number' ? params.instances : 1,
        lambda: PROBE_LAMBDA,
        readShare: PROBE_READ_SHARE,
        writeShare: 1 - PROBE_READ_SHARE,
        requestBytes: PROBE_REQUEST_BYTES,
        responseBytes: PROBE_RESPONSE_BYTES,
        blockingSec: 0,
    };
}

function probeStorageGb(definition: ComponentDefinition, params: ComponentParams): number {
    const model = definition.model?.storage;
    if (!model) return PROBE_STORAGE_GB;

    const context: StorageContext = {
        ...baseContext(definition, params),
        writeRps: PROBE_LAMBDA * (1 - PROBE_READ_SHARE),
        recordBytes: PROBE_REQUEST_BYTES,
        horizonDays: HORIZON_DAYS,
    };

    const storage = model(context);

    return Number.isFinite(storage.totalGb) ? storage.totalGb : PROBE_STORAGE_GB;
}

function probeData(definition: ComponentDefinition, params: ComponentParams): MeteredData {
    return {
        egressGbMonth: PROBE_EGRESS_GB_MONTH,
        backupGb: backupGbOf(definition.group, probeStorageGb(definition, params)),
        logsGbMonth: logsGbDayOf(params, PROBE_LAMBDA) * DAYS_PER_MONTH,
        idempotencyGb: 0,
    };
}

function probeContext(
    definition: ComponentDefinition,
    params: ComponentParams,
    pricing: PricingProfile,
): CostContext {
    return {
        ...baseContext(definition, params),
        pricing,
        storageGb: probeStorageGb(definition, params),
        egressGbMonth: PROBE_EGRESS_GB_MONTH,
        regionCostMultiplier: 1,
    };
}

export function costAt(
    definition: ComponentDefinition,
    params: ComponentParams,
    pricing: PricingProfile = DEFAULT_PRICING,
): CostBreakdown | null {
    const bill = definition.model?.cost;
    if (!bill) return null;

    const modelled = bill(probeContext(definition, params, pricing));
    const billed = withSurcharges(
        definition.managed === true,
        params,
        modelled,
        pricing,
        probeData(definition, params),
    );

    return Number.isFinite(billed.total) ? billed : null;
}

function variantOf(field: ParamField | undefined, value: ParamValue): ParamValue | null {
    if (typeof value === 'boolean') return !value;

    if (field?.kind === 'enum') {
        return field.options.find((option) => option !== value) ?? null;
    }

    if (typeof value !== 'number') return null;

    const grown = Math.min(value * PROBE_FACTOR, field?.kind === 'number' ? (field.max ?? Infinity) : Infinity);
    if (grown > value) return grown;

    const shrunk = Math.max(value / PROBE_FACTOR, field?.kind === 'number' ? (field.min ?? 0) : 0);

    return shrunk < value ? shrunk : null;
}

function movedArticles(base: CostBreakdown, probed: CostBreakdown): CostArticle[] {
    return COST_ARTICLES.filter((article) => Math.abs(probed[article] - base[article]) > EPSILON);
}

export function costDrivers(
    definition: ComponentDefinition,
    params: ComponentParams = definition.defaultParams,
    pricing: PricingProfile = DEFAULT_PRICING,
): CostDriver[] {
    const base = costAt(definition, params, pricing);
    if (!base) return [];

    const drivers: CostDriver[] = [];

    for (const [param, value] of Object.entries(params)) {
        const variant = variantOf(definition.paramSchema[param], value);
        if (variant === null) continue;

        const probed = costAt(definition, { ...params, [param]: variant }, pricing);
        if (!probed) continue;

        const articles = movedArticles(base, probed);
        if (articles.length > 0) drivers.push({ param, articles });
    }

    return drivers;
}
