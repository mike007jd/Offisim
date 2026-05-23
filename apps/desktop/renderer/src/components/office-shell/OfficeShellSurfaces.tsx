import { Button, cn } from '@offisim/ui-core';
import { type VariantProps, cva } from 'class-variance-authority';
import type { ComponentProps, HTMLAttributes } from 'react';

const railTabButtonVariants = cva('office-rail-tab-button', {
  variants: {
    state: {
      active: 'office-rail-tab-button-active',
      idle: 'office-rail-tab-button-idle',
    },
  },
  defaultVariants: { state: 'idle' },
});

const railTabBadgeVariants = cva('office-rail-tab-badge', {
  variants: {
    state: {
      active: 'office-rail-tab-badge-active',
      idle: 'office-rail-tab-badge-idle',
    },
  },
  defaultVariants: { state: 'idle' },
});

const costDotVariants = cva('scene-cost-dot', {
  variants: {
    state: {
      live: 'scene-cost-dot-live',
      idle: 'scene-cost-dot-idle',
    },
  },
  defaultVariants: { state: 'idle' },
});

const costPillVariants = cva('scene-cost-pill', {
  variants: {
    state: {
      live: 'scene-cost-pill-live',
      idle: 'scene-cost-pill-idle',
    },
  },
  defaultVariants: { state: 'idle' },
});

export function OfficeRailShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="office-rail-shell" className={cn('office-rail-shell', className)} {...props} />
  );
}

export function OfficeRailTabs({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="office-rail-tabs" className={cn('office-rail-tabs', className)} {...props} />
  );
}

export function OfficeRailContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="office-rail-content"
      className={cn('office-rail-content', className)}
      {...props}
    />
  );
}

export function OfficeRailPane({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="office-rail-pane" className={cn('office-rail-pane', className)} {...props} />
  );
}

export function OfficeRailWorkspaceHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="office-rail-workspace-header"
      className={cn('office-rail-workspace-header', className)}
      {...props}
    />
  );
}

export function OfficeRailWorkspacePath({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="office-rail-workspace-path"
      className={cn('office-rail-workspace-path', className)}
      {...props}
    />
  );
}

export function OfficeRailIconSlot({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="office-rail-icon-slot"
      className={cn('office-rail-icon-slot', className)}
      {...props}
    />
  );
}

export function OfficeRailBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="office-rail-body" className={cn('office-rail-body', className)} {...props} />
  );
}

export function OfficeRailScroller({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="office-rail-scroller"
      className={cn('office-rail-scroller custom-scrollbar', className)}
      {...props}
    />
  );
}

export function OfficeRailSopList({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      data-slot="office-rail-sop-list"
      className={cn('office-rail-sop-list', className)}
      {...props}
    />
  );
}

export function OfficeRailTabButton({
  className,
  state,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'> & VariantProps<typeof railTabButtonVariants>) {
  return (
    <Button
      data-slot="office-rail-tab-button"
      variant="ghost"
      className={cn(railTabButtonVariants({ state }), className)}
      {...props}
    />
  );
}

export function OfficeRailTabBadge({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof railTabBadgeVariants>) {
  return (
    <span
      data-slot="office-rail-tab-badge"
      className={cn(railTabBadgeVariants({ state }), className)}
      {...props}
    />
  );
}

export function OfficeRailSopButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button
      data-slot="office-rail-sop-button"
      variant="ghost"
      className={cn('office-rail-sop-button', className)}
      {...props}
    />
  );
}

export function OfficeRailSopTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="office-rail-sop-title"
      className={cn('office-rail-sop-title', className)}
      {...props}
    />
  );
}

export function OfficeRailSopDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="office-rail-sop-description"
      className={cn('office-rail-sop-description', className)}
      {...props}
    />
  );
}

export function OfficeRailSopMeta({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="office-rail-sop-meta"
      className={cn('office-rail-sop-meta', className)}
      {...props}
    />
  );
}

export function OfficeRailEmpty({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="office-rail-empty" className={cn('office-rail-empty', className)} {...props}>
      <p className="office-rail-empty-message">{children}</p>
    </div>
  );
}

export function SceneCostCluster({
  className,
  live,
  ...props
}: HTMLAttributes<HTMLDivElement> & { live?: boolean }) {
  return (
    <div
      data-slot="scene-cost-cluster"
      data-live={live ? 'true' : 'false'}
      className={cn('scene-cost-cluster', live && 'scene-cost-live', className)}
      {...props}
    />
  );
}

export function SceneCostPill({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof costPillVariants>) {
  return (
    <span
      data-slot="scene-cost-pill"
      className={cn(costPillVariants({ state }), className)}
      {...props}
    />
  );
}

export function SceneCostMetricGroup({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="scene-cost-metric-group"
      className={cn('scene-cost-metric-group', className)}
      {...props}
    />
  );
}

export function SceneCostDot({
  className,
  state,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof costDotVariants>) {
  return (
    <span
      aria-hidden="true"
      data-slot="scene-cost-dot"
      className={cn(costDotVariants({ state }), className)}
      {...props}
    />
  );
}

export function SceneCostValue({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <b data-slot="scene-cost-value" className={cn('scene-cost-value', className)} {...props} />
  );
}

export function SceneCostDivider({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      data-slot="scene-cost-divider"
      className={cn('scene-cost-divider', className)}
      {...props}
    />
  );
}

export function SceneCostIconSlot({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="scene-cost-icon-slot"
      className={cn('scene-cost-icon-slot', className)}
      {...props}
    />
  );
}
