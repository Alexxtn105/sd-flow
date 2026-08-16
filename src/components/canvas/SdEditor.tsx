import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, useReactFlow } from '@xyflow/react';
import type { Edge, Node, OnConnectStart, XYPosition } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import '@xyflow/react/dist/style.css';

import SdNode from './SdNode';
import GroupNode from './GroupNode';
import ProbeNode from './ProbeNode';
import ProbeWindows from './ProbeWindows';
import TrafficEdge from './TrafficEdge';
import NodeContextMenu from './NodeContextMenu';
import type { ContextMenuTarget } from './NodeContextMenu';
import registry from '../../engine/ComponentRegistry';
import { useGraphStore } from '../../store/graphStore';
import type { SdNode as SdNodeModel } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useTouchContext } from '../../contexts/TouchContext';
import { PALETTE_DRAG_TYPE } from '../panels/Palette/Palette';
import './SdEditor.css';
import './ReactFlowTheme.css';

const nodeTypes = { sd: SdNode, group: GroupNode, probe: ProbeNode };
const edgeTypes = { traffic: TrafficEdge };

function absolutePosition(node: SdNodeModel, nodes: SdNodeModel[]): XYPosition {
    let x = node.position.x;
    let y = node.position.y;
    let parentId = node.parentId;

    while (parentId) {
        const parent = nodes.find((candidate) => candidate.id === parentId);
        if (!parent) break;
        x += parent.position.x;
        y += parent.position.y;
        parentId = parent.parentId;
    }

    return { x, y };
}

function nodeSize(node: SdNodeModel): { width: number; height: number } {
    const width = typeof node.style?.width === 'number' ? node.style.width : (node.measured?.width ?? 0);
    const height = typeof node.style?.height === 'number' ? node.style.height : (node.measured?.height ?? 0);
    return { width, height };
}

function containerAt(nodes: SdNodeModel[], point: XYPosition): SdNodeModel | null {
    const containers = nodes.filter((node) => node.type === 'group');
    let best: SdNodeModel | null = null;
    let bestArea = Number.POSITIVE_INFINITY;

    for (const container of containers) {
        const origin = absolutePosition(container, nodes);
        const { width, height } = nodeSize(container);
        const inside =
            point.x >= origin.x && point.x <= origin.x + width && point.y >= origin.y && point.y <= origin.y + height;
        const area = width * height;
        if (inside && area < bestArea) {
            best = container;
            bestArea = area;
        }
    }

    return best;
}

export default function SdEditor() {
    const { t } = useTranslation();
    const { isDarkTheme } = useThemeContext();
    const isTouch = useTouchContext();
    const { fitView, screenToFlowPosition } = useReactFlow();
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [menuTarget, setMenuTarget] = useState<ContextMenuTarget | null>(null);

    const nodes = useGraphStore((state) => state.nodes);
    const edges = useGraphStore((state) => state.edges);
    const onNodesChange = useGraphStore((state) => state.onNodesChange);
    const onEdgesChange = useGraphStore((state) => state.onEdgesChange);
    const connect = useGraphStore((state) => state.connect);
    const isValidConnection = useGraphStore((state) => state.isValidConnection);
    const addComponent = useGraphStore((state) => state.addComponent);
    const duplicateNode = useGraphStore((state) => state.duplicateNode);
    const removeElements = useGraphStore((state) => state.removeElements);
    const setNodeParent = useGraphStore((state) => state.setNodeParent);
    const beginTransaction = useGraphStore((state) => state.beginTransaction);
    const commitTransaction = useGraphStore((state) => state.commitTransaction);
    const undo = useGraphStore((state) => state.undo);
    const redo = useGraphStore((state) => state.redo);

    const setSelection = useUiStore((state) => state.setSelection);
    const focusRequest = useUiStore((state) => state.focusRequest);
    const selectOnly = useGraphStore((state) => state.selectOnly);
    const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
    const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
    const pendingAdd = useUiStore((state) => state.pendingAdd);
    const clearPendingAdd = useUiStore((state) => state.clearPendingAdd);
    const toggleProbeWindow = useUiStore((state) => state.toggleProbeWindow);
    const openBlockHelp = useUiStore((state) => state.openBlockHelp);
    const startConnection = useUiStore((state) => state.startConnection);
    const endConnection = useUiStore((state) => state.endConnection);

    const handleConnectStart = useCallback<OnConnectStart>(
        (_, { nodeId, handleId, handleType }) => {
            const node = useGraphStore.getState().nodes.find((candidate) => candidate.id === nodeId);
            if (!node || !nodeId || !handleId || !handleType) return;

            startConnection({ nodeId, componentType: node.data.componentType, handleId, handleType });
        },
        [startConnection],
    );

    const dropComponent = useCallback(
        (type: string, flowPosition: XYPosition) => {
            const shape = registry.getShape(type);
            const container = shape === 'container' ? null : containerAt(useGraphStore.getState().nodes, flowPosition);

            if (!container) {
                addComponent(type, flowPosition);
                return;
            }

            const origin = absolutePosition(container, useGraphStore.getState().nodes);
            addComponent(type, { x: flowPosition.x - origin.x, y: flowPosition.y - origin.y }, container.id);
        },
        [addComponent],
    );

    const onDrop = useCallback(
        (event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const type = event.dataTransfer.getData(PALETTE_DRAG_TYPE);
            if (!type) return;
            dropComponent(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        },
        [dropComponent, screenToFlowPosition],
    );

    const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const addToCenter = useCallback(
        (type: string) => {
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            dropComponent(
                type,
                screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
            );
        },
        [dropComponent, screenToFlowPosition],
    );

    useEffect(() => {
        if (!pendingAdd) return;
        addToCenter(pendingAdd);
        clearPendingAdd();
    }, [addToCenter, clearPendingAdd, pendingAdd]);

    useEffect(() => {
        if (focusRequest === 0 || selectedNodeIds.length === 0) return;

        selectOnly(selectedNodeIds, selectedEdgeIds);
        void fitView({
            nodes: selectedNodeIds.map((id) => ({ id })),
            duration: 350,
            padding: 0.45,
            maxZoom: 1.3,
        });
    }, [fitView, focusRequest, selectOnly, selectedEdgeIds, selectedNodeIds]);

    const deleteSelection = useCallback(() => {
        removeElements(selectedNodeIds, selectedEdgeIds);
        setSelection([], []);
    }, [removeElements, selectedNodeIds, selectedEdgeIds, setSelection]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

            const modifier = event.metaKey || event.ctrlKey;

            if (modifier && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                if (event.shiftKey) redo();
                else undo();
                return;
            }

            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                deleteSelection();
                return;
            }

            if (event.key === 'F1' || event.key === '?') {
                if (selectedNodeIds.length !== 1) return;
                const model = useGraphStore.getState().nodes.find((item) => item.id === selectedNodeIds[0]);
                if (!model) return;
                event.preventDefault();
                openBlockHelp(model.data.componentType);
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [deleteSelection, openBlockHelp, redo, selectedNodeIds, undo]);

    const openMenu = useCallback(
        (event: React.MouseEvent, node: Node) => {
            event.preventDefault();
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            const model = useGraphStore.getState().nodes.find((item) => item.id === node.id);
            setMenuTarget({
                nodeId: node.id,
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                hasParent: Boolean(node.parentId),
                isProbe: model !== undefined && registry.getShape(model.data.componentType) === 'probe',
            });
        },
        [],
    );

    const handleSelectionChange = useCallback(
        ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) => {
            setSelection(
                selectedNodes.map((node) => node.id),
                selectedEdges.map((edge) => edge.id),
            );
        },
        [setSelection],
    );

    const minimapColor = useCallback(() => (isDarkTheme ? '#30363d' : '#d1d5db'), [isDarkTheme]);

    const isEmpty = nodes.length === 0;

    const flowProps = useMemo(
        () => ({
            deleteKeyCode: null,
            multiSelectionKeyCode: ['Meta', 'Shift'],
            proOptions: { hideAttribution: true },
            fitViewOptions: { padding: 0.3, maxZoom: 1 },
            minZoom: 0.2,
            maxZoom: 2.5,
        }),
        [],
    );

    return (
        <div className="sd-editor" ref={wrapperRef} onDrop={onDrop} onDragOver={onDragOver}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={connect}
                onConnectStart={handleConnectStart}
                onConnectEnd={endConnection}
                isValidConnection={isValidConnection}
                onNodeDragStart={beginTransaction}
                onNodeDragStop={commitTransaction}
                onNodeContextMenu={openMenu}
                onNodeClick={isTouch ? openMenu : undefined}
                onPaneClick={() => setMenuTarget(null)}
                onSelectionChange={handleSelectionChange}
                fitView
                {...flowProps}
            >
                <Background color={isDarkTheme ? '#30363d' : '#e5e7eb'} gap={18} size={1} />
                <Controls showInteractive={false} className={isDarkTheme ? 'sd-controls-dark' : ''} />
                <MiniMap
                    pannable
                    zoomable
                    nodeColor={minimapColor}
                    maskColor={isDarkTheme ? 'rgba(13,17,23,0.7)' : 'rgba(249,250,251,0.7)'}
                    className="sd-minimap"
                />
            </ReactFlow>

            <ProbeWindows />

            {isEmpty && (
                <div className="sd-editor-empty">
                    <span className="sd-editor-empty-title">{t('canvas.empty')}</span>
                    <span className="sd-editor-empty-hint">{t('canvas.emptyHint')}</span>
                </div>
            )}

            {menuTarget && (
                <NodeContextMenu
                    target={menuTarget}
                    onClose={() => setMenuTarget(null)}
                    onDuplicate={duplicateNode}
                    onDelete={(nodeId) => removeElements([nodeId], [])}
                    onDetach={(nodeId) => setNodeParent(nodeId, undefined)}
                    onOpenProbeWindow={toggleProbeWindow}
                    onOpenHelp={(nodeId) => {
                        const model = useGraphStore.getState().nodes.find((item) => item.id === nodeId);
                        if (model) openBlockHelp(model.data.componentType);
                    }}
                />
            )}
        </div>
    );
}
