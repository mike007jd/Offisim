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
      className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left text-caption font-bold text-text-secondary"
    >
      <ChevronDown
        className={cn(
          'size-3 shrink-0 text-text-muted transition-transform',
          collapsed && '-rotate-90',
        )}
        aria-hidden="true"
      />
      {icon}
      <span>{label}</span>
      {required && (
        <Badge size="xs" variant="warning">
          REQUIRED
        </Badge>
      )}
      <span className="ml-auto text-caption font-medium text-text-muted">{count}</span>
    </Button>
  );
}
