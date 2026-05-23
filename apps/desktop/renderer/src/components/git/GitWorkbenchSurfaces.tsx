import { Button, Checkbox, Textarea, cn } from '@offisim/ui-core';
import { type VariantProps, cva } from 'class-variance-authority';
import type { ComponentProps, HTMLAttributes } from 'react';

const gitFileRowVariants = cva('git-file-row', {
  variants: {
    state: {
      selected: 'git-file-row-selected',
      idle: 'git-file-row-idle',
    },
  },
  defaultVariants: { state: 'idle' },
});

const gitStatLineVariants = cva('git-stat-line', {
  variants: {
    tone: {
      added: 'git-stat-line-added',
      deleted: 'git-stat-line-deleted',
    },
  },
  defaultVariants: { tone: 'added' },
});

export function GitWorkbenchShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="git-workbench-shell"
      className={cn('git-workbench-shell', className)}
      {...props}
    />
  );
}

export function GitWorkbenchHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="git-workbench-header"
      className={cn('git-workbench-header', className)}
      {...props}
    />
  );
}

export function GitWorkbenchHeaderRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="git-workbench-header-row"
      className={cn('git-workbench-header-row', className)}
      {...props}
    />
  );
}

export function GitWorkbenchKicker({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="git-workbench-kicker"
      className={cn('git-workbench-kicker', className)}
      {...props}
    />
  );
}

export function GitBranchLine({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-branch-line" className={cn('git-branch-line', className)} {...props} />
  );
}

export function GitIconSlot({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { state?: 'loading' }) {
  return (
    <span
      data-slot="git-icon-slot"
      data-state={state}
      className={cn('git-icon-slot', className)}
      {...props}
    />
  );
}

export function GitBranchName({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="git-branch-name" className={cn('git-branch-name', className)} {...props} />
  );
}

export function GitRefreshButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button
      data-slot="git-refresh-button"
      variant="secondary"
      size="sm"
      className={cn('git-refresh-button', className)}
      {...props}
    />
  );
}

export function GitMetricGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-metric-grid" className={cn('git-metric-grid', className)} {...props} />
  );
}

export function GitMetricCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-metric-card" className={cn('git-metric-card', className)} {...props} />
  );
}

export function GitMetricLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-metric-label" className={cn('git-metric-label', className)} {...props} />
  );
}

export function GitMetricValue({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-metric-value" className={cn('git-metric-value', className)} {...props} />
  );
}

export function GitNotice({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="git-notice" className={cn('git-notice', className)} {...props} />;
}

export function GitNoticeStrong({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="git-notice-strong" className={cn('git-notice-strong', className)} {...props} />
  );
}

export function GitErrorBanner({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      data-slot="git-error-banner"
      className={cn('git-error-banner', className)}
      {...props}
    />
  );
}

export function GitWorkbenchBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="git-workbench-body"
      className={cn('git-workbench-body', className)}
      {...props}
    />
  );
}

export function GitSection({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section data-slot="git-section" className={cn('git-section', className)} {...props} />;
}

export function GitSectionHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="git-section-header"
      className={cn('git-section-header', className)}
      {...props}
    />
  );
}

export function GitInlineMeta({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-inline-meta" className={cn('git-inline-meta', className)} {...props} />
  );
}

export function GitMutedLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="git-muted-label" className={cn('git-muted-label', className)} {...props} />
  );
}

export function GitScrollArea({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="git-scroll-area"
      className={cn('git-scroll-area custom-scrollbar', className)}
      {...props}
    />
  );
}

export function GitEmptyPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-empty-panel" className={cn('git-empty-panel', className)} {...props} />
  );
}

export function GitDiffSection({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-slot="git-diff-section"
      className={cn('git-diff-section', className)}
      {...props}
    />
  );
}

export function GitDiffPath({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span data-slot="git-diff-path" className={cn('git-diff-path', className)} {...props} />;
}

export function GitDiffPane({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="git-diff-pane"
      className={cn('git-diff-pane custom-scrollbar', className)}
      {...props}
    />
  );
}

export function GitDiffLoading({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-diff-loading" className={cn('git-diff-loading', className)} {...props} />
  );
}

export function GitDiffPre({ className, ...props }: HTMLAttributes<HTMLPreElement>) {
  return <pre data-slot="git-diff-pre" className={cn('git-diff-pre', className)} {...props} />;
}

export function GitDiffEmpty({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="git-diff-empty" className={cn('git-diff-empty', className)} {...props} />;
}

export function GitActionStack({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      data-slot="git-action-stack"
      className={cn('git-action-stack', className)}
      {...props}
    />
  );
}

export function GitActionPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-action-panel" className={cn('git-action-panel', className)} {...props} />
  );
}

export function GitActionTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="git-action-title" className={cn('git-action-title', className)} {...props} />
  );
}

export function GitCommitTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-slot="git-commit-textarea"
      className={cn('git-commit-textarea', className)}
      {...props}
    />
  );
}

export function GitPrimaryButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <Button
      data-slot="git-primary-button"
      variant="default"
      size="default"
      className={cn('git-primary-button', className)}
      {...props}
    />
  );
}

export function GitSecondaryButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button
      data-slot="git-secondary-button"
      variant="outline"
      className={cn('git-secondary-button', className)}
      {...props}
    />
  );
}

export function GitPanelText({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="git-panel-text" className={cn('git-panel-text', className)} {...props} />;
}

export function GitUnavailableShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="git-unavailable-shell"
      className={cn('git-unavailable-shell', className)}
      {...props}
    />
  );
}

export function GitUnavailableTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      data-slot="git-unavailable-title"
      className={cn('git-unavailable-title', className)}
      {...props}
    />
  );
}

export function GitUnavailableText({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="git-unavailable-text"
      className={cn('git-unavailable-text', className)}
      {...props}
    />
  );
}

export function GitFileRowShell({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof gitFileRowVariants>) {
  return (
    <div
      data-slot="git-file-row"
      className={cn(gitFileRowVariants({ state }), className)}
      {...props}
    />
  );
}

export function GitCheckbox({ className, ...props }: ComponentProps<typeof Checkbox>) {
  return <Checkbox data-slot="git-checkbox" className={className} {...props} />;
}

export function GitFileSelectButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button
      data-slot="git-file-select-button"
      variant="ghost"
      className={cn('git-file-select-button', className)}
      {...props}
    />
  );
}

export function GitFileTextStack({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="git-file-text-stack"
      className={cn('git-file-text-stack', className)}
      {...props}
    />
  );
}

export function GitFileNameLine({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="git-file-name-line"
      className={cn('git-file-name-line', className)}
      {...props}
    />
  );
}

export function GitFilePath({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span data-slot="git-file-path" className={cn('git-file-path', className)} {...props} />;
}

export function GitFileStatusBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="git-file-status-badge"
      className={cn('git-file-status-badge', className)}
      {...props}
    />
  );
}

export function GitStatStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="git-stat-stack" className={cn('git-stat-stack', className)} {...props} />;
}

export function GitStatLine({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof gitStatLineVariants>) {
  return (
    <span
      data-slot="git-stat-line"
      className={cn(gitStatLineVariants({ tone }), className)}
      {...props}
    />
  );
}
