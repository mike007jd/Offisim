import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function StateActions({
  primary,
  secondary,
  tertiary,
}: {
  primary?: EmptyStateAction;
  secondary?: EmptyStateAction;
  tertiary?: EmptyStateAction;
}) {
  if (!primary && !secondary && !tertiary) return null;
  return (
    <div className="off-state-actions">
      {primary ? (
        <Button variant="subtle" size="sm" onClick={primary.onClick} disabled={primary.disabled}>
          {primary.label}
        </Button>
      ) : null}
      {secondary ? (
        <Button
          variant="outline"
          size="sm"
          onClick={secondary.onClick}
          disabled={secondary.disabled}
        >
          {secondary.label}
        </Button>
      ) : null}
      {tertiary ? (
        <Button variant="ghost" size="sm" onClick={tertiary.onClick} disabled={tertiary.disabled}>
          {tertiary.label}
        </Button>
      ) : null}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** Optional supporting line; single-sentence empty states may omit it. */
  description?: string;
  /** Primary call to action, rendered as the emphasized button. */
  action?: EmptyStateAction;
  /** Optional lower-emphasis alternative shown beside the primary action. */
  secondaryAction?: EmptyStateAction;
  /** Optional quiet escape hatch when a state has two recovery paths plus settings. */
  tertiaryAction?: EmptyStateAction;
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
  tertiaryAction,
  detail,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('off-state', className)}>
      <span className="off-state-glyph">
        <Icon icon={icon} size="md" />
      </span>
      <p className="off-state-title">{title}</p>
      {description ? <p className="off-state-desc">{description}</p> : null}
      <StateActions primary={action} secondary={secondaryAction} tertiary={tertiaryAction} />
      {detail ? <p className="off-state-detail">{detail}</p> : null}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  detail: string;
  onRetry?: () => void;
  retrying?: boolean;
  secondaryAction?: EmptyStateAction;
  tertiaryAction?: EmptyStateAction;
  className?: string;
}

export function ErrorState({
  title,
  detail,
  onRetry,
  retrying = false,
  secondaryAction,
  tertiaryAction,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('off-state is-error', className)}>
      <span className="off-state-glyph is-error">
        <Icon icon={AlertTriangle} size="md" />
      </span>
      <p className="off-state-title">{title}</p>
      <p className="off-state-desc">{detail}</p>
      <StateActions
        primary={
          onRetry
            ? { label: retrying ? 'Retrying…' : 'Retry', onClick: onRetry, disabled: retrying }
            : undefined
        }
        secondary={secondaryAction}
        tertiary={tertiaryAction}
      />
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
