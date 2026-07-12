import type { LoopDefinition } from '@offisim/shared-types';

export type LoopScheduleDecision = 'wait' | 'run' | 'skip';

/** Pure foreground policy. Reset `eligibleSinceMs` on mount/foreground so
 * already-due slots are advanced, never backfilled. */
export function decideLoopSchedule(input: {
  loop: LoopDefinition;
  nowMs: number;
  eligibleSinceMs: number;
  visible: boolean;
  hasProject: boolean;
}): LoopScheduleDecision {
  const { loop, nowMs, eligibleSinceMs, visible, hasProject } = input;
  if (!loop.scheduleIntervalMinutes || !loop.nextRunAt) return 'wait';
  const dueMs = Date.parse(loop.nextRunAt);
  if (!Number.isFinite(dueMs) || dueMs > nowMs) return 'wait';
  if (
    !visible ||
    !hasProject ||
    dueMs < eligibleSinceMs ||
    loop.status !== 'ready' ||
    !loop.currentRevisionId
  ) {
    return 'skip';
  }
  return 'run';
}
