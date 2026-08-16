import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../store/graphStore';
import { nodeName } from '../utils/nodeName';

export default function useNodeLabels(): (nodeId: string) => string {
    const { t } = useTranslation(['blocks', 'nodes']);
    const nodes = useGraphStore((state) => state.nodes);

    const labels = useMemo(() => {
        const map = new Map<string, string>();

        for (const node of nodes) {
            map.set(
                node.id,
                nodeName({ id: node.id, componentType: node.data.componentType, label: node.data.label }, t),
            );
        }

        return map;
    }, [nodes, t]);

    return useCallback((nodeId: string) => labels.get(nodeId) ?? nodeId, [labels]);
}
