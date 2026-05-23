import type { CSSProperties } from 'react';
import { cn } from '../lib/utils.js';

export interface SkeletonProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  className?: string;
  'aria-label'?: string;
}

export function Skeleton({
  width,
  height,
  className,
  'aria-label': ariaLabel = 'Loading',
}: SkeletonProps) {
  return (
    <div
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      className={cn(
        'relative overflow-hidden rounded-md bg-surface-muted/70',
        'motion-safe:before:absolute motion-safe:before:inset-0 motion-safe:before:-translate-x-full motion-safe:before:animate-[skeleton-shimmer_1500ms_ease-in-out_infinite] motion-safe:before:bg-gradient-to-r motion-safe:before:from-transparent motion-safe:before:via-white/8 motion-safe:before:to-transparent',
        className,
      )}
      style={{ width, height }} // ui-hardcode-allowed: caller-provided skeleton dimensions are runtime layout placeholders.
    />
  );
}

export interface WorkspaceListSkeletonProps {
  rows?: number;
  className?: string;
}

export function WorkspaceListSkeleton({ rows = 6, className }: WorkspaceListSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-3 p-3', className)} data-skeleton="workspace-list">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: stable decorative shimmer rows
          key={index}
          className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-elevated/50 p-3"
        >
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-2.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface WorkspaceDetailSkeletonProps {
  className?: string;
}

export function WorkspaceDetailSkeleton({ className }: WorkspaceDetailSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-6 p-6', className)} data-skeleton="workspace-detail">
      <div className="flex items-center gap-4">
        <Skeleton className="h-20 w-20 rounded-2xl" />
        <div className="min-w-0 flex-1 flex flex-col gap-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      {Array.from({ length: 2 }).map((_, blockIndex) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: stable decorative shimmer blocks
          key={blockIndex}
          className="flex flex-col gap-2"
        >
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
      <Skeleton className="h-9 w-32 rounded-lg" />
    </div>
  );
}

export interface WorkspacePageSkeletonProps {
  className?: string;
  'data-testid'?: string;
}

export function WorkspacePageSkeleton({
  className,
  'data-testid': dataTestId,
}: WorkspacePageSkeletonProps) {
  return (
    <div
      className={cn('flex h-full min-h-0 w-full flex-col gap-4 p-4', className)}
      data-skeleton="workspace-page"
      data-testid={dataTestId}
    >
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-3">
        <WorkspaceListSkeleton className="min-h-0 overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated/40" />
        <WorkspaceDetailSkeleton className="min-h-0 rounded-xl border border-border-subtle bg-surface-elevated/40 md:col-span-2" />
      </div>
    </div>
  );
}
