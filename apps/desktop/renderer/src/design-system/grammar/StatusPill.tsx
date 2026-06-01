import { cn } from '@/lib/utils.js';

// 'violet' is kept as an accepted prop value so existing call sites don't break,
// but it renders as 'accent' — the palette is collapsed to 4 semantic tones plus
// the neutral 'muted'.
type StatusTone = 'accent' | 'ok' | 'warn' | 'danger' | 'violet' | 'muted';

interface StatusPillProps {
  children: string;
  tone?: StatusTone;
  running?: boolean;
}

export function StatusPill({ children, tone = 'muted', running = false }: StatusPillProps) {
  const resolved = tone === 'violet' ? 'accent' : tone;
  return (
    <span className={cn('off-status-pill', `off-status-pill-${resolved}`, running && 'is-running')}>
      <span className="off-status-dot" />
      {children}
    </span>
  );
}
