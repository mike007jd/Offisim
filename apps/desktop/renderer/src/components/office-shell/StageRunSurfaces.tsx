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

export function StageRunHeaderGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-run-header-group"
      className={cn('stage-run-header-group', className)}
      {...props}
    />
  );
}

export function StageRunKicker({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="stage-run-kicker" className={cn('stage-run-kicker', className)} {...props} />
  );
}

export function StageRunMeta({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span data-slot="stage-run-meta" className={cn('stage-run-meta', className)} {...props} />;
}

export function StageRunCloseButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button
      data-slot="stage-run-close-button"
      variant="ghost"
      size="icon"
      className={cn('stage-run-close-button', className)}
      {...props}
    />
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

const axisButtonVariants = cva('stage-axis-button', {
  variants: {
    state: {
      active: 'stage-axis-button-active',
      idle: 'stage-axis-button-idle',
      muted: 'stage-axis-button-muted',
    },
  },
  defaultVariants: { state: 'idle' },
});

const teamEmployeeButtonVariants = cva('stage-team-employee-button', {
  variants: {
    state: {
      selected: 'stage-team-employee-button-selected',
      idle: 'stage-team-employee-button-idle',
    },
  },
  defaultVariants: { state: 'idle' },
});

const teamStatusDotVariants = cva('stage-team-status-dot', {
  variants: {
    state: {
      idle: 'stage-team-status-dot-idle',
      assigned: 'stage-team-status-dot-info',
      thinking: 'stage-team-status-dot-info',
      executing: 'stage-team-status-dot-success',
      meeting: 'stage-team-status-dot-accent',
      blocked: 'stage-team-status-dot-error',
      failed: 'stage-team-status-dot-error',
      waiting: 'stage-team-status-dot-warning',
    },
  },
  defaultVariants: { state: 'idle' },
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

export function StageRunStepStatusDot({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof runStatusDotVariants>) {
  return (
    <span
      aria-hidden="true"
      data-slot="stage-run-step-status-dot"
      data-state={state ?? 'idle'}
      className={cn(runStatusDotVariants({ state }), 'stage-run-step-status-dot', className)}
      {...props}
    />
  );
}

export function StageRunSectionHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-run-section-header"
      className={cn('stage-run-section-header', className)}
      {...props}
    />
  );
}

export function StageRunSectionTitle({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="stage-run-section-title"
      className={cn('stage-run-section-title', className)}
      {...props}
    />
  );
}

export function StageRunCountBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="stage-run-count-badge"
      className={cn('stage-run-count-badge', className)}
      {...props}
    />
  );
}

export function StageRunEmpty({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="stage-run-empty" className={cn('stage-run-empty', className)} {...props} />;
}

export function StageRunStepList({ className, ...props }: HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      data-slot="stage-run-step-list"
      className={cn('stage-run-step-list', className)}
      {...props}
    />
  );
}

export function StageRunStepBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-run-step-body"
      className={cn('stage-run-step-body', className)}
      {...props}
    />
  );
}

export function StageRunStepTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="stage-run-step-title"
      className={cn('stage-run-step-title', className)}
      {...props}
    />
  );
}

export function StageRunStepMeta({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="stage-run-step-meta"
      className={cn('stage-run-step-meta', className)}
      {...props}
    />
  );
}

export function StageAxisBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="stage-axis-bar" className={cn('stage-axis-bar', className)} {...props} />;
}

export function StageAxisButton({
  className,
  state,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'> & VariantProps<typeof axisButtonVariants>) {
  return (
    <Button
      data-slot="stage-axis-button"
      variant="ghost"
      className={cn(axisButtonVariants({ state }), className)}
      {...props}
    />
  );
}

export function StageAxisDivider({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      data-slot="stage-axis-divider"
      className={cn('stage-axis-divider', className)}
      {...props}
    />
  );
}

export function StageAxisLiveIndicator({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      data-slot="stage-axis-live-indicator"
      className={cn('stage-axis-live-indicator', className)}
      {...props}
    />
  );
}

export function StageTeamLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="stage-team-label" className={cn('stage-team-label', className)} {...props} />
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

export function StageTeamDockShell({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section data-slot="stage-team-dock" className={cn('stage-team-dock', className)} {...props} />
  );
}

export function StageTeamSummary({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-team-summary"
      className={cn('stage-team-summary', className)}
      {...props}
    />
  );
}

export function StageTeamCountBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="stage-team-count-badge"
      className={cn('stage-team-count-badge', className)}
      {...props}
    />
  );
}

export function StageTeamRoster({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="stage-team-roster"
      className={cn('stage-team-roster custom-scrollbar', className)}
      {...props}
    />
  );
}

export function StageTeamEmployeeButton({
  className,
  state,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'> &
  VariantProps<typeof teamEmployeeButtonVariants>) {
  return (
    <Button
      data-slot="stage-team-employee-button"
      variant="ghost"
      className={cn(teamEmployeeButtonVariants({ state }), className)}
      {...props}
    />
  );
}

export function StageTeamAvatarSlot({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="stage-team-avatar" className={cn('stage-team-avatar', className)} {...props} />
  );
}

export function StageTeamEmployeeName({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="stage-team-employee-name"
      className={cn('stage-team-employee-name', className)}
      {...props}
    />
  );
}

export function StageTeamStatusDot({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof teamStatusDotVariants>) {
  return (
    <span
      aria-hidden="true"
      data-slot="stage-team-status-dot"
      data-state={state ?? 'idle'}
      className={cn(teamStatusDotVariants({ state }), className)}
      {...props}
    />
  );
}

export function StageTeamAddLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="stage-team-add-label"
      className={cn('stage-team-add-label', className)}
      {...props}
    />
  );
}

export function StageTeamAddButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button
      data-slot="stage-team-add-button"
      variant="ghost"
      className={cn('stage-team-add-button', className)}
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

export function StagePipeCodeGroup({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span
      {...props}
      data-slot="stage-pipe-code-group"
      className={cn('stage-pipe-inline-group stage-pipe-code-group', className)}
    >
      {children}
    </span>
  );
}

export function StagePipeStepLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      data-slot="stage-pipe-step-label"
      className={cn('stage-pipe-step-label', className)}
    />
  );
}

export function StagePipeAssignee({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      data-slot="stage-pipe-assignee"
      className={cn('stage-pipe-assignee', className)}
    />
  );
}

export function StagePipeStoppedLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      data-slot="stage-pipe-stopped-label"
      className={cn('stage-pipe-stopped-label', className)}
    />
  );
}

interface StagePipeIconProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'default' | 'solid';
}

export function StagePipeIcon({ tone = 'default', className, ...props }: StagePipeIconProps) {
  return (
    <span
      {...props}
      data-slot="stage-pipe-icon"
      data-tone={tone}
      className={cn('stage-pipe-icon', className)}
    />
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
