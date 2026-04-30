import { ChevronDown } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { FONT, SP, STUDIO_COLORS, STUDIO_TRANSITION } from './studio-style-helpers.js';

interface CategoryHeaderProps {
  collapsed: boolean;
  onClick: () => void;
  /** Trailing icon glyph rendered before the label (e.g., a category icon or emoji string). */
  icon?: ReactNode;
  label: string;
  /** Item count rendered right-aligned. */
  count: number;
  /** When true, renders the REQUIRED chip after the label. */
  required?: boolean;
  ariaLabel?: string;
}

const HEADER_BUTTON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SP.sm,
  width: '100%',
  padding: `${SP.sm}px ${SP.md}px`,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: FONT.base,
  fontWeight: FONT.bold,
  color: STUDIO_COLORS.textSecondary,
  fontFamily: FONT.family,
};

const REQUIRED_CHIP_STYLE: CSSProperties = {
  fontSize: FONT.xs,
  fontWeight: FONT.semibold,
  color: STUDIO_COLORS.warning,
  background: STUDIO_COLORS.warningMuted,
  borderRadius: 10,
  padding: `1px ${SP.xs}px`,
  letterSpacing: 0,
};

const COUNT_STYLE: CSSProperties = {
  marginLeft: 'auto',
  fontSize: FONT.xs,
  color: STUDIO_COLORS.textTertiary,
  fontWeight: FONT.medium,
};

export function StudioPaletteCategoryHeader({
  collapsed,
  onClick,
  icon,
  label,
  count,
  required,
  ariaLabel,
}: CategoryHeaderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? `${collapsed ? 'Expand' : 'Collapse'} ${label} (${count} items)`}
      style={HEADER_BUTTON_STYLE}
    >
      <ChevronDown
        size={12}
        style={{
          color: STUDIO_COLORS.textTertiary,
          transition: STUDIO_TRANSITION.transformFast,
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          flexShrink: 0,
        }}
      />
      {icon}
      <span>{label}</span>
      {required && <span style={REQUIRED_CHIP_STYLE}>REQUIRED</span>}
      <span style={COUNT_STYLE}>{count}</span>
    </button>
  );
}
