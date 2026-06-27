/**
 * Idempotent run.started persistence (Epic A — durable resume).
 *
 * A resume re-runs `execute_impl` with the SAME root run id, so the host replays
 * `run.started` for a run whose `agent_runs` row already exists. A naive
 * `repo.create` would either PK-conflict (drizzle / tauri backends throw) or
 * clobber the row back to its create-time state (the memory backend overwrites),
 * losing the status (`interrupted → running`) and partial usage the resume lane
 * already wrote. Insert-if-absent keeps the existing row untouched on replay.
 */

import type { AgentRunRepository, NewAgentRun } from '@offisim/core/browser';

/**
 * Persist a run.started only if no row exists for it yet. Returns `true` when a
 * new row was created, `false` when the run already existed (a resume replay —
 * the existing row is left exactly as-is).
 */
export async function persistRunStartIfAbsent(
  repo: AgentRunRepository,
  run: NewAgentRun,
): Promise<boolean> {
  if (await repo.findById(run.run_id)) return false;
  await repo.create(run);
  return true;
}
