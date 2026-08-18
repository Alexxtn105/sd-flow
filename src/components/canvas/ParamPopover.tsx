import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import ParamInput from '../common/ParamInput/ParamInput';
import ParamReset from '../common/ParamInput/ParamReset';
import ResizeHandle from '../common/ResizeHandle/ResizeHandle';
import registry from '../../engine/ComponentRegistry';
import { pricingFor } from '../../engine/sim/constants';
import { costDrivers } from '../../engine/sim/costDrivers';
import type { CostArticle } from '../../engine/sim/costDrivers';
import useParamHelp from '../../hooks/useParamHelp';
import useReference from '../../hooks/useReference';
import { useGraphStore } from '../../store/graphStore';
import { useSchemeStore } from '../../store/schemeStore';
import { useUiStore } from '../../store/uiStore';
import { groupParams } from '../../utils/paramSections';
import { FREE_PLACEMENT, placePopover } from '../../utils/popoverPlacement';
import './ParamPopover.css';

const MAX_FIELDS = 6;
const ANCHOR_GAP = 10;

interface ParamPopoverProps {
    nodeId: string;
    componentType: string;
}

export default function ParamPopover({ nodeId, componentType }: ParamPopoverProps) {
    const { t } = useTranslation(['common', 'params', 'blocks', 'hints']);
    const cardRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState(FREE_PLACEMENT);

    const params = useGraphStore(
        (state) => state.nodes.find((node) => node.id === nodeId)?.data.params ?? null,
    );
    const updateNodeParam = useGraphStore((state) => state.updateNodeParam);
    const closeParamPopover = useUiStore((state) => state.closeParamPopover);
    const openInspector = useUiStore((state) => state.openInspector);
    const width = useUiStore((state) => state.panels.popover);
    const pricingProfile = useSchemeStore((state) => state.settings.pricingProfile);
    const zoom = useStore((state) => state.transform[2]);

    useReference(['hints']);
    const paramHelp = useParamHelp();

    const definition = registry.get(componentType);

    const entries = useMemo(() => {
        if (!definition || !params) return [];

        return groupParams(params, definition.paramSchema)
            .flatMap((section) => section.entries)
            .slice(0, MAX_FIELDS);
    }, [definition, params]);

    const costArticles = useMemo(() => {
        if (!definition || !params) return new Map<string, CostArticle[]>();

        const drivers = costDrivers(definition, params, pricingFor(pricingProfile));

        return new Map(drivers.map((driver) => [driver.param, driver.articles]));
    }, [definition, params, pricingProfile]);

    useLayoutEffect(() => {
        const anchor = cardRef.current?.parentElement;
        const pane = cardRef.current?.closest('.react-flow');
        if (!anchor || !pane) return;

        const node = anchor.getBoundingClientRect();
        const canvas = pane.getBoundingClientRect();

        setPlacement(
            placePopover({
                nodeLeft: node.left,
                nodeRight: node.right,
                canvasLeft: canvas.left,
                canvasRight: canvas.right,
                gap: ANCHOR_GAP * zoom,
                wanted: useUiStore.getState().panels.popover,
            }),
        );
    }, [nodeId, zoom]);

    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (!cardRef.current?.contains(event.target as Node)) closeParamPopover();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeParamPopover();
        };

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [closeParamPopover]);

    if (!definition || !params) return null;

    const hidden = Object.keys(params).length - entries.length;

    return (
        <div
            ref={cardRef}
            className={`sd-popover sd-popover-${placement.flipped ? 'left' : 'right'} nodrag nopan nowheel`}
            style={{
                width: Math.min(width, placement.room),
                transform: `scale(${zoom > 0 ? 1 / zoom : 1})`,
            }}
            onDoubleClick={(event) => event.stopPropagation()}
        >
            <ResizeHandle
                panel="popover"
                side={placement.flipped ? 'left' : 'right'}
                label={t('resize.popover')}
            />

            <div className="sd-popover-head">
                <span className="sd-popover-title">
                    {t(definition.id, { ns: 'blocks', defaultValue: definition.id })}
                </span>
                <button
                    type="button"
                    className="sd-popover-close"
                    onClick={closeParamPopover}
                    aria-label={t('dialog.close')}
                >
                    <Icon name="close" size="small" />
                </button>
            </div>

            {entries.map(({ key, value, field }) => {
                const help = paramHelp(key, field);
                const articles = costArticles.get(key);

                return (
                    <div key={key} className="sd-popover-row">
                        <label
                            className="sd-popover-label"
                            htmlFor={`sd-popover-${key}`}
                            title={[`${help.name} · ${key}`, help.hint].filter(Boolean).join('\n')}
                        >
                            {help.name}
                        </label>
                        {articles && (
                            <span
                                className="sd-popover-cost"
                                title={t('inspector.costDriver', {
                                    articles: articles
                                        .map((article) => t(`cost.article.${article}`))
                                        .join(', '),
                                })}
                            >
                                $
                            </span>
                        )}
                        <span className="sd-popover-field">
                            <ParamInput
                                id={`sd-popover-${key}`}
                                field={field}
                                value={value}
                                label={help.name}
                                defaultValue={definition.defaultParams[key]}
                                withSlider
                                onChange={(next) => updateNodeParam(nodeId, key, next)}
                            />
                            <span className="sd-popover-unit">{help.unit}</span>
                            <ParamReset
                                value={value}
                                defaultValue={definition.defaultParams[key]}
                                onReset={(next) => updateNodeParam(nodeId, key, next)}
                            />
                        </span>
                    </div>
                );
            })}

            <button
                type="button"
                className="sd-popover-more"
                onClick={() => {
                    openInspector();
                    closeParamPopover();
                }}
            >
                {hidden > 0 ? t('canvas.popoverMore', { count: hidden }) : t('canvas.popoverAll')}
            </button>
        </div>
    );
}
