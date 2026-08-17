import type { ReactNode } from 'react';
import SD_ICONS from './SdIcons';
import UI_ICONS from './UiIcons';

export default function iconGlyph(name: string): ReactNode | undefined {
    return SD_ICONS[name] ?? UI_ICONS[name];
}
