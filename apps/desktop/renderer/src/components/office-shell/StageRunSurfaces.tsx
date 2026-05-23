import { Button, cn } from '@offisim/ui-core';
import { type VariantProps, cva } from 'class-variance-authority';
import type { CSSProperties, ComponentProps, HTMLAttributes, ReactNode } from 'react';

const runStatusDotVariants = cva('stage-run-status-dot', {
  variants: {
    state: {
      idle: 'stage-run-status-dot-idle',
      running: 'stage-run-status-dot-running',
      completed: 'stage-run-status-dot-completed',
      failed: 'stage-run-status-dot-failed',
      pending: 'stage-run-status-dot-pending',
      active: 'stage-run-status-dot-active',
    },
  },
  defaultVariants: { state: 'idle' },
});

const runStepItemVariants = cva('stage-run-step-item', {
  variants: {
    state: {
      current: 'stage-run-step-item-current',
      idle: 'stage-run-step-item-idle',
    },
  },
  defaultVariants: { state: 'idle' },
});

export function StageRunPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="stage-run-panel" className={cn('stage-run-panel', className)} {...props} />
  );
}

export function StageRunHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <header data-slot="stage-run-header" className={cn('stage-run-header', className)} {...props} />
  );
}

export function StageRunStatusDot({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof runStatusDotVariants>) {
  return (
    <span
      aria-hidden="true"
      data-slot="stage-run-status-dot"
      data-state={state ?? 'idle'}
      className={cn(runStatusDotVariants({ state }), className)}
      {...props}
    />
  );
}

export function StageRunScrollArea({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-run-scroll-area"
      className={cn('stage-run-scroll-area', className)}
      {...props}
    />
  );
}

const runSectionVariants = cva('stage-run-section', {
  variants: {
    boundary: {
      default: '',
      last: 'stage-run-section-last',
    },
  },
  defaultVariants: { boundary: 'default' },
});

const pipeActionButtonVariants = cva('stage-pipe-action-button', {
  variants: {
    tone: {
      danger: 'stage-pipe-action-button-danger',
      accent: 'stage-pipe-action-button-accent',
      neutral: 'stage-pipe-action-button-neutral',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function StageRunSection({
  className,
  boundary,
  ...props
}: HTMLAttributes<HTMLElement> & VariantProps<typeof runSectionVariants>) {
  return (
    <section
      data-slot="stage-run-section"
      data-boundary={boundary ?? 'default'}
      className={cn(runSectionVariants({ boundary }), className)}
      {...props}
    />
  );
}

export function StageRunStepItem({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLLIElement> & VariantProps<typeof runStepItemVariants>) {
  return (
    <li
      data-slot="stage-run-step-item"
      data-state={state ?? 'idle'}
      className={cn(runStepItemVariants({ state }), className)}
      {...props}
    />
  );
}

export function StagePipePill({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="stage-pipe-pill" className={cn('stage-pipe-pill', className)} {...props} />
  );
}

export function StagePipeStoppedStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-pipe-stopped-stack"
      className={cn('stage-pipe-stopped-stack', className)}
      {...props}
    />
  );
}

export function StagePipeStoppedPill({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-pipe-stopped-pill"
      className={cn('stage-pipe-stopped-pill', className)}
      {...props}
    />
  );
}

export function StagePipeProgress({
  ratio,
  className,
}: {
  ratio: number;
  className?: string;
}) {
  return (
    <span data-slot="stage-pipe-progress" className={cn('stage-pipe-progress', className)}>
      <i
        data-slot="stage-pipe-progress-value"
        className="stage-pipe-progress-value"
        // ui-hardcode-allowed: runtime progress value exposed on the progress primitive.
        style={{ '--stage-pipe-progress': `${Math.round(ratio * 100)}%` } as CSSProperties}
      />
    </span>
  );
}

export function StagePipeInlineGroup({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span
      data-slot="stage-pipe-inline-group"
      className={cn('stage-pipe-inline-group', className)}
      {...props}
    >
      {children}
    </span>
  );
}

export function StagePipeDivider({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      data-slot="stage-pipe-divider"
      className={cn('stage-pipe-divider', className)}
      {...props}
    />
  );
}

export function StagePipeBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="stage-pipe-badge" className={cn('stage-pipe-badge', className)} {...props} />
  );
}

export function StagePipeActionRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-pipe-action-row"
      className={cn('stage-pipe-action-row', className)}
      {...props}
    />
  );
}

export function StagePipeActionButton({
  className,
  tone,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'> & VariantProps<typeof pipeActionButtonVariants>) {
  const buttonVariant = tone === 'danger' ? 'ghost' : 'outline';
  return (
    <Button
      data-slot="stage-pipe-action-button"
      variant={buttonVariant}
      className={cn(pipeActionButtonVariants({ tone }), className)}
      {...props}
    />
  );
}
