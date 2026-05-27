import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('off-state', className)}>
      <span className="off-state-glyph">
        <Icon icon={icon} size="md" />
      </span>
      <p className="off-state-title">{title}</p>
      <p className="off-state-desc">{description}</p>
      {action ? (
        <Button variant="subtle" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
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
