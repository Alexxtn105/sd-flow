import registry from './ComponentRegistry';
import type { GroupId } from './types/component';
import { cacheComponents } from './components/cache';
import { clientComponents } from './components/clients';
import { computeComponents } from './components/compute';
import { edgeComponents } from './components/edge';
import { messagingComponents } from './components/messaging';
import { nosqlComponents } from './components/nosql';
import { observabilityComponents } from './components/observability';
import { olapComponents } from './components/olap';
import { platformComponents } from './components/platform';
import { probeComponents } from './components/probes';
import { searchComponents } from './components/search';
import { sqlComponents } from './components/sql';
import { storageComponents } from './components/storage';
import { topologyComponents } from './components/topology';

const GROUP_ORDER: GroupId[] = [
    'clients',
    'edge',
    'compute',
    'sql',
    'nosql',
    'search',
    'olap',
    'cache',
    'messaging',
    'storage',
    'platform',
    'observability',
    'topology',
    'probes',
];

export default function initComponents(): void {
    if (registry.isFrozen()) return;

    for (const group of GROUP_ORDER) {
        registry.registerGroup(group);
    }

    registry.registerAll([
        ...clientComponents,
        ...edgeComponents,
        ...computeComponents,
        ...sqlComponents,
        ...nosqlComponents,
        ...searchComponents,
        ...olapComponents,
        ...cacheComponents,
        ...messagingComponents,
        ...storageComponents,
        ...platformComponents,
        ...observabilityComponents,
        ...topologyComponents,
        ...probeComponents,
    ]);

    registry.freeze();
}
