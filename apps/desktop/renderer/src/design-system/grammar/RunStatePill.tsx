import type { RunState } from '@/data/types.js';
import { StatusPill } from './StatusPill.js';

const RUN_TONE: Record<
  RunState,
  { tone: 'accent' | 'ok' | 'danger' | 'muted'; running: boolean; label: string } | null
> = {
  running: { tone: 'accent', running: true, label: 'Running' },
  error: { tone: 'danger', running: false, label: 'Failed' },
  done: { tone: 'ok', running: false, label: 'Done' },
  paused: { tone: 'muted', running: false, label: 'Paused' },
  idle: null,
};

/** Renders a status pill for a run state, or nothing when idle. */
export function RunStatePill({ state }: { state: RunState }) {
  const config = RUN_TONE[state];
  if (!config) return null;
  return (
    <StatusPill tone={config.tone} running={config.running}>
      {config.label}
    </StatusPill>
  );
}
