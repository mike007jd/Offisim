import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Primary call to action, rendered as the emphasized button. */
  action?: EmptyStateAction;
  /** Optional lower-emphasis alternative shown beside the primary action. */
  secondaryAction?: EmptyStateAction;
  /** Muted tertiary line for context (e.g. the bound folder path + detected state). */
  detail?: string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  detail,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('off-state', className)}>
      <span className="off-state-glyph">
        <Icon icon={icon} size="md" />
      </span>
      <p className="off-state-title">{title}</p>
      <p className="off-state-desc">{description}</p>
      {action || secondaryAction ? (
        <div className="off-state-actions">
          {action ? (
            <Button variant="subtle" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button variant="ghost" size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      {detail ? <p className="off-state-detail">{detail}</p> : null}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  detail: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title, detail, onRetry, className }: ErrorStateProps) {
  return (
    <div className={cn('off-state is-error', className)}>
      <span className="off-state-glyph is-error">
        <Icon icon={AlertTriangle} size="md" />
      </span>
      <p className="off-state-title">{title}</p>
      <p className="off-state-desc">{detail}</p>
      {onRetry ? (
        <Button variant="subtle" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Pull a human-readable message off an unknown query error, falling back for
 *  non-Error rejections. Collapses the `instanceof Error` ternary that every
 *  surface's load-failure ErrorState repeats. */
export function errorDetail(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const rowKeys = Array.from({ length: rows }, (_, index) => `loading-row-${index}`);
  return (
    <div className={cn('off-skel-list', className)} aria-hidden>
      {rowKeys.map((key) => (
        <div key={key} className="off-skel-row" />
      ))}
    </div>
  );
}
