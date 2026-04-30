import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { isValidElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/utils.js';
import { Button } from './button.js';

export interface ErrorStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}

export interface ErrorStateProps {
  title: ReactNode;
  message?: ReactNode;
  /** User-level explanation. Avoid raw transport errors as the only content. */
  reason?: ReactNode;
  /** Optional technical detail for debugging, shown as a details block. */
  technicalDetail?: ReactNode;
  icon?: LucideIcon | ComponentType<{ className?: string }> | ReactNode;
  primaryAction?: ErrorStateAction;
  retry?: ErrorStateAction;
  secondaryAction?: ErrorStateAction;
  variant?: 'default' | 'inline' | 'banner' | 'page';
  className?: string;
}

function ErrorActionButton({
  action,
  emphasis,
}: {
  action: ErrorStateAction;
  emphasis: 'primary' | 'secondary';
}) {
  const variant = emphasis === 'primary' ? 'default' : 'outline';
  if (action.href) {
    return (
      <Button asChild variant={variant}>
        <a href={action.href}>{action.label}</a>
      </Button>
    );
  }
  return (
    <Button variant={variant} onClick={action.onClick} disabled={action.disabled}>
      {action.label}
    </Button>
  );
}

function renderErrorIcon(icon: ErrorStateProps['icon']) {
  if (isValidElement(icon)) return icon;
  const Icon = (icon ?? AlertTriangle) as ComponentType<{ className?: string }>;
  return <Icon className="h-5 w-5" />;
}

export function ErrorState({
  title,
  message,
  reason,
  technicalDetail,
  icon,
  primaryAction,
  retry,
  secondaryAction,
  variant = 'default',
  className,
}: ErrorStateProps) {
  const inline = variant === 'inline' || variant === 'banner';
  const action = primaryAction ?? retry;
  const body = message ?? reason;
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center text-slate-300',
        inline
          ? 'gap-2 rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-4'
          : 'gap-4 px-6 py-10',
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/10 text-amber-300">
        {renderErrorIcon(icon)}
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <div
          className={cn(
            'font-semibold leading-tight text-slate-100',
            inline ? 'text-sm' : 'text-base',
          )}
        >
          {title}
        </div>
        {body && (
          <div
            className={cn(
              'text-slate-400',
              inline ? 'text-xs leading-relaxed' : 'text-sm leading-relaxed',
            )}
          >
            {body}
          </div>
        )}
      </div>
      {technicalDetail && (
        <details className="w-full max-w-md rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-left">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
            Show technical detail
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-slate-400">
            {technicalDetail}
          </div>
        </details>
      )}
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {action && <ErrorActionButton action={action} emphasis="primary" />}
          {secondaryAction && <ErrorActionButton action={secondaryAction} emphasis="secondary" />}
        </div>
      )}
    </div>
  );
}
