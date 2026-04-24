import { isValidElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/utils.js';

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
    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300">
      <Icon className="h-5 w-5" />
    </div>
  );
}

function ActionButton({
  action,
  emphasis,
}: { action: EmptyStateAction; emphasis: 'primary' | 'secondary' }) {
  const base =
    'inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:opacity-50 disabled:cursor-not-allowed';
  const tone =
    emphasis === 'primary'
      ? 'border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
      : 'border border-white/15 bg-transparent text-slate-200 hover:bg-white/8';
  const content = (
    <span className="inline-flex items-center gap-2">
      <span>{action.label}</span>
    </span>
  );
  if (action.href) {
    return (
      <a className={cn(base, tone)} href={action.href} title={action.disabledReason}>
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.disabledReason}
      className={cn(base, tone)}
    >
      {content}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  primaryAction,
  secondaryActions,
  variant = 'default',
  className,
  footer,
}: EmptyStateProps) {
  const isCompact = variant === 'compact';
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center text-slate-300',
        isCompact
          ? 'gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-6'
          : 'gap-4 px-6 py-10',
        className,
      )}
    >
      {renderIcon(icon)}
      <div className="flex max-w-md flex-col gap-1">
        <div
          className={cn(
            'font-semibold leading-tight text-slate-100',
            isCompact ? 'text-sm' : 'text-base',
          )}
        >
          {title}
        </div>
        {description && (
          <div
            className={cn(
              'text-slate-400',
              isCompact ? 'text-xs leading-relaxed' : 'text-sm leading-relaxed',
            )}
          >
            {description}
          </div>
        )}
      </div>
      {(primaryAction || (secondaryActions && secondaryActions.length > 0)) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {primaryAction && <ActionButton action={primaryAction} emphasis="primary" />}
          {secondaryActions?.map((action) => (
            <ActionButton key={action.label} action={action} emphasis="secondary" />
          ))}
        </div>
      )}
      {footer && <div className="pt-1 text-xs text-slate-500">{footer}</div>}
    </div>
  );
}
