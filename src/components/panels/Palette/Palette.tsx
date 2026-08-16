import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';
import ResizeHandle from '../../common/ResizeHandle/ResizeHandle';
import registry from '../../../engine/ComponentRegistry';
import type { ComponentDefinition } from '../../../engine/types/component';
import { useTouchContext } from '../../../contexts/TouchContext';
import { useChallengeStore } from '../../../store/challengeStore';
import { useUiStore } from '../../../store/uiStore';
import TrafficLegend from './TrafficLegend';
import './Palette.css';

export const PALETTE_DRAG_TYPE = 'application/sd-flow-component';

export default function Palette() {
    const { t, i18n } = useTranslation();
    const isTouch = useTouchContext();
    const collapsed = useUiStore((state) => state.paletteCollapsed);
    const width = useUiStore((state) => state.panels.palette);
    const togglePalette = useUiStore((state) => state.togglePalette);
    const requestAdd = useUiStore((state) => state.requestAdd);
    const openBlockHelp = useUiStore((state) => state.openBlockHelp);
    const mode = useUiStore((state) => state.mode);
    const activeChallenge = useChallengeStore((state) => state.active);

    const [query, setQuery] = useState('');
    const [legendOpen, setLegendOpen] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(registry.getGroupIds().map((id) => [id, true])),
    );
    const legendRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!legendOpen) return;
        const handler = (event: MouseEvent) => {
            if (legendRef.current && !legendRef.current.contains(event.target as HTMLElement)) {
                setLegendOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [legendOpen]);

    const blockName = useCallback((id: string) => t(id, { ns: 'blocks', defaultValue: id }), [t]);

    const restriction = useMemo(() => {
        if (mode !== 'challenges' || activeChallenge === null) return null;

        const { allowedGroups, forbiddenTypes } = activeChallenge.constraints;
        if (!allowedGroups && !forbiddenTypes) return null;

        return {
            groups: allowedGroups ? new Set(allowedGroups) : null,
            types: new Set(forbiddenTypes ?? []),
        };
    }, [activeChallenge, mode]);

    const isLocked = useCallback(
        (component: ComponentDefinition) => {
            if (!restriction) return false;
            if (restriction.types.has(component.id)) return true;
            return restriction.groups !== null && !restriction.groups.has(component.group);
        },
        [restriction],
    );

    const groups = useMemo(
        () =>
            registry
                .getGroups()
                .map((group) => ({
                    id: group.id,
                    components: group.components
                        .filter((component) => component.shape !== 'link')
                        .sort((a, b) => blockName(a.id).localeCompare(blockName(b.id), i18n.language)),
                }))
                .filter((group) => group.components.length > 0),
        [blockName, i18n.language],
    );

    const needle = query.trim().toLowerCase();
    const visibleGroups = needle
        ? groups
              .map((group) => ({
                  ...group,
                  components: group.components.filter(
                      (component) =>
                          blockName(component.id).toLowerCase().includes(needle) ||
                          component.id.includes(needle),
                  ),
              }))
              .filter((group) => group.components.length > 0)
        : groups;

    const totalBlocks = groups.reduce((sum, group) => sum + group.components.length, 0);
    const groupIds = groups.map((group) => group.id);
    const allCollapsed = groupIds.every((id) => collapsedGroups[id]);
    const allExpanded = groupIds.every((id) => !collapsedGroups[id]);

    const toggleGroup = (id: string) =>
        setCollapsedGroups((previous) => ({ ...previous, [id]: !previous[id] }));

    const onDragStart = (event: React.DragEvent<HTMLDivElement>, type: string) => {
        event.dataTransfer.setData(PALETTE_DRAG_TYPE, type);
        event.dataTransfer.effectAllowed = 'move';
        event.currentTarget.classList.add('dragging');
    };

    const onDragEnd = (event: React.DragEvent<HTMLDivElement>) => {
        event.currentTarget.classList.remove('dragging');
    };

    const renderItem = (component: ComponentDefinition) => {
        const name = blockName(component.id);
        const locked = isLocked(component);
        const draggable = !isTouch && !locked;

        return (
            <div
                key={component.id}
                className={`pal-block pal-shape-${component.shape} ${locked ? 'pal-block-locked' : ''}`}
                draggable={draggable}
                onDragStart={draggable ? (event) => onDragStart(event, component.id) : undefined}
                onDragEnd={draggable ? onDragEnd : undefined}
                onClick={isTouch && !locked ? () => requestAdd(component.id) : undefined}
                title={locked ? `${name} — ${t('palette.blockLocked')}` : name}
                role="button"
                tabIndex={0}
                aria-disabled={locked}
                aria-label={locked ? `${name}: ${t('palette.blockLocked')}` : `${t('palette.addBlock')}: ${name}`}
            >
                <div className="pal-block-icon">
                    <Icon name={component.icon} size="medium" />
                </div>
                <span className="pal-block-name">{name}</span>
                {locked && <Icon name="lock" size="small" className="pal-block-lock" />}
                <button
                    className="pal-block-help"
                    onClick={(event) => {
                        event.stopPropagation();
                        openBlockHelp(component.id);
                    }}
                    title={`${t('palette.blockHelp')}: ${name}`}
                    aria-label={`${t('palette.blockHelp')}: ${name}`}
                    draggable={false}
                >
                    <Icon name="help_outline" size="small" />
                </button>
            </div>
        );
    };

    return (
        <div className={`pal ${collapsed ? 'pal-collapsed' : ''}`} style={collapsed ? undefined : { width }}>
            {!collapsed && <ResizeHandle panel="palette" side="right" label={t('resize.palette')} />}

            <div className="pal-header">
                {!collapsed && (
                    <div className="pal-header-info">
                        <span className="pal-header-title">{t('palette.title')}</span>
                        <span className="pal-header-count">{totalBlocks}</span>
                    </div>
                )}
                <button
                    className="pal-collapse-btn"
                    onClick={togglePalette}
                    title={collapsed ? t('palette.expandPanel') : t('palette.collapsePanel')}
                    aria-label={collapsed ? t('palette.expandPanel') : t('palette.collapsePanel')}
                >
                    <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} size="small" />
                </button>
            </div>

            {!collapsed && (
                <div className="pal-search">
                    <Icon name="search" size="small" className="pal-search-icon" />
                    <input
                        type="text"
                        className="pal-search-input"
                        placeholder={t('palette.search')}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        aria-label={t('palette.search')}
                    />
                    {query && (
                        <button
                            className="pal-search-clear"
                            onClick={() => setQuery('')}
                            title={t('palette.clearSearch')}
                            aria-label={t('palette.clearSearch')}
                        >
                            <Icon name="close" size="small" />
                        </button>
                    )}
                </div>
            )}

            {!collapsed && visibleGroups.length > 1 && (
                <div className="pal-group-actions">
                    <button
                        className="pal-group-action-btn"
                        onClick={() => setCollapsedGroups({})}
                        disabled={allExpanded}
                        title={t('palette.expandAllGroups')}
                    >
                        <Icon name="unfold_more" size="small" />
                        <span>{t('palette.expand')}</span>
                    </button>
                    <button
                        className="pal-group-action-btn"
                        onClick={() => setCollapsedGroups(Object.fromEntries(groupIds.map((id) => [id, true])))}
                        disabled={allCollapsed}
                        title={t('palette.collapseAllGroups')}
                    >
                        <Icon name="unfold_less" size="small" />
                        <span>{t('palette.collapse')}</span>
                    </button>
                </div>
            )}

            {!collapsed ? (
                <div className="pal-content">
                    {visibleGroups.length === 0 && <div className="pal-empty">{t('palette.nothingFound')}</div>}
                    {visibleGroups.map((group) => (
                        <div key={group.id} className="pal-group">
                            <div
                                className="pal-group-header"
                                onClick={() => toggleGroup(group.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        toggleGroup(group.id);
                                    }
                                }}
                                aria-expanded={!collapsedGroups[group.id]}
                            >
                                <span className="pal-group-name">
                                    {t(group.id, { ns: 'groups', defaultValue: group.id })}
                                </span>
                                <span className="pal-group-badge">{group.components.length}</span>
                                <Icon
                                    name={collapsedGroups[group.id] ? 'expand_more' : 'expand_less'}
                                    size="small"
                                    className="pal-group-chevron"
                                />
                            </div>
                            {(!collapsedGroups[group.id] || needle.length > 0) && (
                                <div className="pal-group-blocks">{group.components.map(renderItem)}</div>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="pal-content pal-content-icons">
                    {groups
                        .flatMap((group) => group.components)
                        .map((component) => {
                            const locked = isLocked(component);
                            const draggable = !isTouch && !locked;

                            return (
                                <div
                                    key={component.id}
                                    className={`pal-block-mini ${locked ? 'pal-block-locked' : ''}`}
                                    draggable={draggable}
                                    onDragStart={draggable ? (event) => onDragStart(event, component.id) : undefined}
                                    onDragEnd={draggable ? onDragEnd : undefined}
                                    onClick={isTouch && !locked ? () => requestAdd(component.id) : undefined}
                                    title={
                                        locked
                                            ? `${blockName(component.id)} — ${t('palette.blockLocked')}`
                                            : blockName(component.id)
                                    }
                                    role="button"
                                    tabIndex={0}
                                    aria-disabled={locked}
                                >
                                    <Icon name={component.icon} size="medium" />
                                </div>
                            );
                        })}
                </div>
            )}

            <div className="pal-legend-wrapper" ref={legendRef}>
                <button
                    className={`pal-legend-btn ${legendOpen ? 'active' : ''}`}
                    onClick={() => setLegendOpen((open) => !open)}
                    title={t('palette.legendTitle')}
                >
                    <Icon name="legend_toggle" size="small" />
                    {!collapsed && <span>{t('palette.legend')}</span>}
                </button>
                {legendOpen && <TrafficLegend />}
            </div>
        </div>
    );
}
