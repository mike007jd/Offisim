import { Badge, Button, cn } from '@offisim/ui-core';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={ariaLabel ?? `${collapsed ? 'Expand' : 'Collapse'} ${label} (${count} items)`}
      className="h-auto w-full justify-start gap-sp-2 rounded-none px-sp-3 py-sp-2 text-left text-fs-micro font-bold text-ink-2"
    >
      <ChevronDown
        className={cn('size-3 shrink-0 text-ink-3 transition-transform', collapsed && '-rotate-90')}
        aria-hidden="true"
      />
      {icon}
      <span>{label}</span>
      {required && (
        <Badge size="xs" variant="warning">
          REQUIRED
        </Badge>
      )}
      <span className="ml-auto text-fs-micro font-medium text-ink-3">{count}</span>
    </Button>
  );
}
