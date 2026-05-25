import type { RunState } from '@/data/types.js';
import { StatusPill } from './StatusPill.js';

const RUN_TONE: Record<
  RunState,
  { tone: 'accent' | 'ok' | 'danger' | 'muted'; running: boolean } | null
> = {
  running: { tone: 'accent', running: true },
  error: { tone: 'danger', running: false },
  done: { tone: 'ok', running: false },
  paused: { tone: 'muted', running: false },
  idle: null,
};

/** Renders a status pill for a run state, or nothing when idle. */
export function RunStatePill({ state }: { state: RunState }) {
  const tone = RUN_TONE[state];
  if (!tone) return null;
  return (
    <StatusPill tone={tone.tone} running={tone.running}>
      {state}
    </StatusPill>
  );
}
