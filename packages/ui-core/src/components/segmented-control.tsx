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
  items: SegmentedControlItem<V>[];
  size?: 'sm' | 'md';
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
  items,
  size = 'md',
  ariaLabel,
  className,
}: SegmentedControlProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5',
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
              if (!item.disabled && !selected) onChange(item.value);
            }}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:opacity-50',
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
              selected
                ? 'bg-cyan-500/20 text-cyan-100'
                : 'text-slate-300 hover:bg-white/5 hover:text-slate-100',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
