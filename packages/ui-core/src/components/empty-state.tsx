import { isValidElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/utils.js';
import { Button } from './button.js';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  tone?: 'primary' | 'secondary';
  disabled?: boolean;
  disabledReason?: string;
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }> | ReactNode;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  secondaryActions?: EmptyStateAction[];
  /** Compact renders a slim inline block; default fills the container. */
  variant?: 'default' | 'compact';
  className?: string;
  footer?: ReactNode;
}

function renderIcon(icon: EmptyStateProps['icon']): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  const Icon = icon as ComponentType<{ className?: string }>;
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border-default bg-surface-muted text-text-secondary">
      <Icon className="h-5 w-5" />
    </div>
  );
}

function ActionButton({
  action,
  emphasis,
}: { action: EmptyStateAction; emphasis: 'primary' | 'secondary' }) {
  const variant = emphasis === 'primary' ? 'default' : 'outline';
  if (action.href) {
    return (
      <Button asChild variant={variant} title={action.disabledReason}>
        <a href={action.href}>{action.label}</a>
      </Button>
    );
  }
  return (
    <Button
      variant={variant}
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.disabledReason}
    >
      {action.label}
    </Button>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  primaryAction,
  secondaryAction,
  secondaryActions,
  variant = 'default',
  className,
  footer,
}: EmptyStateProps) {
  const isCompact = variant === 'compact';
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center text-text-secondary',
        isCompact
          ? 'gap-2 rounded-xl border border-border-default bg-surface-muted px-4 py-6'
          : 'gap-4 px-6 py-10',
        className,
      )}
    >
      {renderIcon(icon)}
      <div className="flex max-w-md flex-col gap-1">
        <div
          className={cn(
            'font-semibold leading-tight text-text-primary',
            isCompact ? 'text-sm' : 'text-base',
          )}
        >
          {title}
        </div>
        {description && (
          <div
            className={cn(
              'text-text-secondary',
              isCompact ? 'text-xs leading-relaxed' : 'text-sm leading-relaxed',
            )}
          >
            {description}
          </div>
        )}
      </div>
      {(primaryAction || secondaryAction || (secondaryActions && secondaryActions.length > 0)) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {primaryAction && <ActionButton action={primaryAction} emphasis="primary" />}
          {secondaryAction && <ActionButton action={secondaryAction} emphasis="secondary" />}
          {secondaryActions?.map((action) => (
            <ActionButton key={action.label} action={action} emphasis="secondary" />
          ))}
        </div>
      )}
      {footer && <div className="pt-1 text-xs text-text-muted">{footer}</div>}
    </div>
  );
}
