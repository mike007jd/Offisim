import type { ReactNode } from 'react';
import { cn } from '../lib/utils.js';

export interface SegmentedControlItem<V extends string> {
  value: V;
  label: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  /**
   * Fires on every segment click, including when the clicked item is already selected.
   * Use for explicit-retry signals (e.g., 3D ghost-state recovery) where the toggle must
   * register intent even when the value does not change.
   */
  onSelectClick?: (value: V) => void;
  items: SegmentedControlItem<V>[];
  size?: 'sm' | 'md';
  layout?: 'default' | 'scroll';
  ariaLabel?: string;
  className?: string;
}

/**
 * Two-or-more state toggle used for 2D/3D, view modes, and density switches.
 * Uses role=radiogroup/radio for a11y.
 */
export function SegmentedControl<V extends string>({
  value,
  onChange,
  onSelectClick,
  items,
  size = 'md',
  layout = 'default',
  ariaLabel,
  className,
}: SegmentedControlProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center rounded-lg border border-border-default bg-surface-muted p-0.5',
        layout === 'scroll' && 'max-w-full overflow-x-auto',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            // biome-ignore lint/a11y/useSemanticElements: button styling and keyboard behavior are handled by the parent radiogroup pattern
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={item.ariaLabel}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onSelectClick?.(item.value);
              if (!selected) onChange(item.value);
            }}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50',
              layout === 'scroll' && 'shrink-0 whitespace-nowrap',
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
              selected
                ? 'bg-accent-muted text-accent-text'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
