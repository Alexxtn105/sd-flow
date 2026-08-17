import iconGlyph from './iconGlyph';
import './Icon.css';

export type IconSize = 'small' | 'medium' | 'large';

const SIZE_PX: Record<IconSize, number> = { small: 18, medium: 24, large: 32 };

export interface IconProps {
    name: string;
    size?: IconSize;
    className?: string;
    title?: string;
}

const UNDRAWN_BLOCK = (
    <>
        <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
        <path d="M8 10h8M8 14h5" />
    </>
);

export default function Icon({ name, size = 'medium', className = '', title }: IconProps) {
    const glyph = iconGlyph(name) ?? UNDRAWN_BLOCK;

    return (
        <svg
            viewBox="0 0 24 24"
            width={SIZE_PX[size]}
            height={SIZE_PX[size]}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`sd-icon icon-${size} ${className}`}
            aria-hidden="true"
        >
            {title ? <title>{title}</title> : null}
            {glyph}
        </svg>
    );
}
