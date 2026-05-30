import { cn } from '@/lib/utils.js';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import type { CSSProperties } from 'react';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  as?: 'button' | 'span';
  accent?: boolean;
  dotColor?: string;
  className?: string;
  children: ReactNode;
}

export function Chip({
  as = 'span',
  accent = false,
  dotColor,
  className,
  children,
  ...props
}: ChipProps) {
  const classes = cn(
    'off-chip',
    accent && 'is-accent',
    as === 'button' && 'off-focusable',
    className,
  );
  const dot = dotColor ? (
    <span
      className="off-chip-dot"
      style={{ '--off-chip-dot': dotColor } as CSSProperties}
    />
  ) : null;

  if (as === 'button') {
    return (
      <button type="button" className={classes} {...props}>
        {dot}
        {children}
      </button>
    );
  }
  return (
    <span className={classes} {...(props as HTMLAttributes<HTMLSpanElement>)}>
      {dot}
      {children}
    </span>
  );
}
