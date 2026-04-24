import { AlertTriangle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils.js';

export interface ErrorStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}

export interface ErrorStateProps {
  title: ReactNode;
  /** User-level explanation. Avoid raw transport errors as the only content. */
  reason?: ReactNode;
  /** Optional technical detail for debugging, shown as a details block. */
  technicalDetail?: ReactNode;
  icon?: LucideIcon;
  retry?: ErrorStateAction;
  secondaryAction?: ErrorStateAction;
  variant?: 'default' | 'inline';
  className?: string;
}

export function ErrorState({
  title,
  reason,
  technicalDetail,
  icon: Icon = AlertTriangle,
  retry,
  secondaryAction,
  variant = 'default',
  className,
}: ErrorStateProps) {
  const inline = variant === 'inline';
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
        <Icon className="h-5 w-5" />
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
        {reason && (
          <div
            className={cn(
              'text-slate-400',
              inline ? 'text-xs leading-relaxed' : 'text-sm leading-relaxed',
            )}
          >
            {reason}
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
      {(retry || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {retry && (
            <button
              type="button"
              onClick={retry.onClick}
              disabled={retry.disabled}
              className="inline-flex items-center justify-center rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-3.5 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:opacity-50"
            >
              {retry.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
              className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-transparent px-3.5 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
