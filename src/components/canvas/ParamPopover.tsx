import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icons/Icon';
import ParamInput from '../common/ParamInput/ParamInput';
import registry from '../../engine/ComponentRegistry';
import useParamHelp from '../../hooks/useParamHelp';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { groupParams } from '../../utils/paramSections';
import './ParamPopover.css';

const MAX_FIELDS = 6;

interface ParamPopoverProps {
    nodeId: string;
    componentType: string;
}

export default function ParamPopover({ nodeId, componentType }: ParamPopoverProps) {
    const { t } = useTranslation(['common', 'params', 'blocks']);
    const cardRef = useRef<HTMLDivElement>(null);

    const params = useGraphStore(
        (state) => state.nodes.find((node) => node.id === nodeId)?.data.params ?? null,
    );
    const updateNodeParam = useGraphStore((state) => state.updateNodeParam);
    const closeParamPopover = useUiStore((state) => state.closeParamPopover);
    const openInspector = useUiStore((state) => state.openInspector);
    const paramHelp = useParamHelp();

    const definition = registry.get(componentType);

    const entries = useMemo(() => {
        if (!definition || !params) return [];

        return groupParams(params, definition.paramSchema)
            .flatMap((section) => section.entries)
            .slice(0, MAX_FIELDS);
    }, [definition, params]);

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
        <div ref={cardRef} className="sd-popover nodrag nopan nowheel">
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

                return (
                    <div key={key} className="sd-popover-row">
                        <label className="sd-popover-label" htmlFor={`sd-popover-${key}`} title={help.hint}>
                            {help.name}
                        </label>
                        <span className="sd-popover-field">
                            <ParamInput
                                id={`sd-popover-${key}`}
                                field={field}
                                value={value}
                                label={help.name}
                                withSlider
                                onChange={(next) => updateNodeParam(nodeId, key, next)}
                            />
                            <span className="sd-popover-unit">{help.unit}</span>
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
