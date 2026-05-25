import { cn } from '@/lib/utils.js';

type StatusTone = 'accent' | 'ok' | 'warn' | 'danger' | 'violet' | 'muted';

interface StatusPillProps {
  children: string;
  tone?: StatusTone;
  running?: boolean;
}

export function StatusPill({ children, tone = 'muted', running = false }: StatusPillProps) {
  return (
    <span className={cn('off-status-pill', `off-status-pill-${tone}`, running && 'is-running')}>
      <span className="off-status-dot" />
      {children}
    </span>
  );
}
