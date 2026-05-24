import { Button, Progress, cn } from '@offisim/ui-core';
import { type VariantProps, cva } from 'class-variance-authority';
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';

const stageStatusDotVariants = cva('stage-status-dot', {
  variants: {
    state: {
      idle: 'stage-status-dot-idle',
      running: 'stage-status-dot-running',
      completed: 'stage-status-dot-completed',
      failed: 'stage-status-dot-failed',
      pending: 'stage-status-dot-pending',
      active: 'stage-status-dot-active',
    },
  },
  defaultVariants: { state: 'idle' },
});

export function StageStatusDot({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof stageStatusDotVariants>) {
  return (
    <span
      aria-hidden="true"
      data-slot="stage-status-dot"
      data-state={state ?? 'idle'}
      className={cn(stageStatusDotVariants({ state }), className)}
      {...props}
    />
  );
}

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
      info: 'stage-team-status-dot-info',
      success: 'stage-team-status-dot-success',
      accent: 'stage-team-status-dot-accent',
      error: 'stage-team-status-dot-error',
      warning: 'stage-team-status-dot-warning',
    },
  },
  defaultVariants: { state: 'idle' },
});

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

export function StageTeamTools({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="stage-team-tools" className={cn('stage-team-tools', className)} {...props} />
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

export function StageTeamToolButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button
      data-slot="stage-team-tool-button"
      variant="ghost"
      size="iconSm"
      className={cn('stage-team-tool-button', className)}
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
    <Progress
      data-slot="stage-pipe-progress"
      value={ratio}
      max={1}
      size="sm"
      className={cn('stage-pipe-progress', className)}
    />
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
