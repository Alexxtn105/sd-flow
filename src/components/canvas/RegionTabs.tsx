import { useEffect, useMemo } from 'react';
import { Panel } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../store/graphStore';
import type { SdNode } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { REGION_VIEWS } from '../../utils/canvasView';
import { roleName } from '../../utils/nodeName';
import type { Translate } from '../../utils/nodeName';
import './RegionTabs.css';

function regionLabel(node: SdNode, translate: Translate): string {
    const code = typeof node.data.params.code === 'string' ? node.data.params.code : '';

    return node.data.label || code || roleName(node.id, translate) || node.id;
}

export default function RegionTabs() {
    const { t } = useTranslation(['common', 'nodes', 'blocks']);
    const nodes = useGraphStore((state) => state.nodes);
    const regions = useMemo(
        () => nodes.filter((node) => node.data.componentType === 'region'),
        [nodes],
    );

    const regionView = useUiStore((state) => state.regionView);
    const activeRegionId = useUiStore((state) => state.activeRegionId);
    const setRegionView = useUiStore((state) => state.setRegionView);
    const setActiveRegion = useUiStore((state) => state.setActiveRegion);

    const known = regions.some((region) => region.id === activeRegionId);

    useEffect(() => {
        if (regions.length === 0 || known) return;

        setActiveRegion(regions[0].id);
    }, [known, regions, setActiveRegion]);

    if (regions.length < 2) return null;

    return (
        <Panel position="top-left" className="sd-regions">
            <select
                className="sd-regions-select"
                value={regionView}
                onChange={(event) => setRegionView(event.target.value as (typeof REGION_VIEWS)[number])}
                aria-label={t('canvas.regionView')}
            >
                {REGION_VIEWS.map((view) => (
                    <option key={view} value={view}>
                        {t(`canvas.regionViewMode.${view}`)}
                    </option>
                ))}
            </select>

            {regionView === 'single' && (
                <div className="sd-regions-tabs" role="tablist">
                    {regions.map((region) => (
                        <button
                            key={region.id}
                            type="button"
                            role="tab"
                            className={`sd-regions-tab ${region.id === activeRegionId ? 'active' : ''}`}
                            aria-selected={region.id === activeRegionId}
                            onClick={() => setActiveRegion(region.id)}
                        >
                            {regionLabel(region, t)}
                        </button>
                    ))}
                </div>
            )}
        </Panel>
    );
}
