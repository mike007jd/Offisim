/**
 * DR-001 — Safe-boundary / checkpoint model (PRD §22.2, slice M4).
 *
 * A checkpoint (the `last_safe_boundary` recorded on a {@link RuntimeSessionLink})
 * may be taken ONLY at a point where every durability layer (§22.1) has settled.
 * {@link isSafeBoundary} is the PURE predicate that enforces this: ALL six
 * §22.2 conditions must hold or it is NOT a safe boundary. The controller calls
 * {@link recordSafeBoundary} ONLY at such a point — never mid-turn, never while a
 * tool call is in flight, never before pending interactions / artifact metadata /
 * evaluations are durably committed. That is what makes the recorded boundary a
 * point the mission can be deterministically resumed from after a crash.
 *
 * Additive at M4 — the live controller calls this at its safe points (M-pass);
 * here it is the deterministic logic + its harness only.
 */

import type { RuntimeSessionLinkRepository } from '../../repositories.js';

/**
 * The six §22.2 facts that must ALL hold for a checkpoint to be a safe boundary.
 * Each is a settled/durable signal the host gathers at the candidate point; the
 * predicate is a pure conjunction so a single false fact disqualifies the point.
 */
export interface SafeBoundaryInput {
  /** The agent turn has reached settlement (no in-progress assistant turn). */
  readonly agentTurnSettled: boolean;
  /** Every current tool call is terminal (none pending / running). */
  readonly allToolCallsTerminal: boolean;
  /** Pending interactions (agent.ui.request / approval) are durably persisted. */
  readonly pendingInteractionsPersisted: boolean;
  /** Artifact metadata is committed (the artifact rows, not just in flight). */
  readonly artifactMetadataCommitted: boolean;
  /** Evaluations for the attempt are committed to the truth store. */
  readonly evaluationsCommitted: boolean;
  /**
   * The runtime returned a resumable session / state reference for this point
   * (the opaque resume ref). Without it there is nothing to resume FROM, so the
   * point cannot be a safe boundary even if everything else has settled.
   */
  readonly resumableSessionRef: string | null;
}

/**
 * PRD §22.2: a checkpoint may be recorded only when ALL conditions hold. Pure —
 * no IO, no clock, no randomness — so the controller and the harness agree on
 * exactly which points are safe.
 */
export function isSafeBoundary(input: SafeBoundaryInput): boolean {
  return (
    input.agentTurnSettled &&
    input.allToolCallsTerminal &&
    input.pendingInteractionsPersisted &&
    input.artifactMetadataCommitted &&
    input.evaluationsCommitted &&
    input.resumableSessionRef !== null &&
    input.resumableSessionRef.length > 0
  );
}

/** The §22.2 conditions that were NOT met, for a structured "why not" reason. */
export function unmetSafeBoundaryReasons(input: SafeBoundaryInput): string[] {
  const reasons: string[] = [];
  if (!input.agentTurnSettled) reasons.push('agent turn not settled');
  if (!input.allToolCallsTerminal) reasons.push('a tool call is not terminal');
  if (!input.pendingInteractionsPersisted) reasons.push('pending interactions not persisted');
  if (!input.artifactMetadataCommitted) reasons.push('artifact metadata not committed');
  if (!input.evaluationsCommitted) reasons.push('evaluations not committed');
  if (!input.resumableSessionRef) reasons.push('no resumable session reference');
  return reasons;
}

/** Outcome of {@link recordSafeBoundary}. */
export interface RecordSafeBoundaryResult {
  recorded: boolean;
  /** When `recorded === false`, the §22.2 conditions that were not met. */
  unmet?: string[];
}

/**
 * Record `last_safe_boundary` on a mission's runtime session link and set its
 * status to the live, resumable state (`active`). Refuses to write unless
 * {@link isSafeBoundary} holds for `input` — a checkpoint at a non-safe point is
 * a correctness bug, so this is the chokepoint that guarantees only safe points
 * are ever persisted as the resume anchor.
 *
 * The boundary write goes THROUGH the runtime_session_link repo (MS-001 schema:
 * `last_safe_boundary` + `status`); no new column is needed. Deterministic — the
 * caller supplies `boundaryRef`; this function mints no ids and reads no clock.
 *
 * The controller calls this ONLY at a safe point (after a turn settles, all tool
 * calls are terminal, and interactions / artifacts / evaluations are committed).
 */
export async function recordSafeBoundary(
  missionId: string,
  runtimeSessionLinkId: string,
  boundaryRef: string,
  input: SafeBoundaryInput,
  repo: RuntimeSessionLinkRepository,
): Promise<RecordSafeBoundaryResult> {
  if (!isSafeBoundary(input)) {
    return { recorded: false, unmet: unmetSafeBoundaryReasons(input) };
  }
  const link = await repo.findById(runtimeSessionLinkId);
  if (!link) {
    return { recorded: false, unmet: [`runtime session link ${runtimeSessionLinkId} not found`] };
  }
  if (link.mission_id !== missionId) {
    return {
      recorded: false,
      unmet: [
        `runtime session link ${runtimeSessionLinkId} belongs to mission ${link.mission_id}, not ${missionId}`,
      ],
    };
  }
  await repo.update(runtimeSessionLinkId, {
    last_safe_boundary: boundaryRef,
    status: 'active',
  });
  return { recorded: true };
}
