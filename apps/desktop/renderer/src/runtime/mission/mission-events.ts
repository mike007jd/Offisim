/**
 * Mission-bridge renderer event vocabulary (MS-005). Standalone (no Tauri / no
 * runtime imports) so both the producer (`desktop-agent-runtime.ts`) and the
 * consumer (`mission-run-controller.ts`) — and a Node harness — can import the
 * event name + payload shape without pulling the Tauri API into module scope.
 *
 * The `submit_for_evaluation` mission-bridge tool emits this when the agent
 * signals a criterion is ready. It is a SIGNAL only — the deterministic evaluator
 * over the real workspace is the truth (PRD §5). The MissionRunController
 * correlates it to the current attempt by `runId` (the attempt's run id).
 */

export const MISSION_EVALUATION_SUBMITTED_EVENT = 'mission.evaluation.submitted';

export interface MissionEvaluationSubmittedPayload {
  /** The attempt's run id (== rootRunId) — correlates the signal to the attempt. */
  runId: string;
  rootRunId: string;
  criterionId: string;
  /** The agent's advisory note. NOT the verdict (§5). */
  summary: string;
  evidenceRefs: string[];
}

/**
 * Mission status-transition signal (M2/M3 live wiring). The renderer-side
 * MissionRunManager emits this when it starts a run (`running`) and when the run
 * loop reaches a terminal status — the ONE bus channel by which the Office
 * Theater (office-dramaturgy.ts) animates mission lifecycle beats. It carries
 * only the canonical mission identity + the new status string; the office maps
 * the status to a staged beat (and ignores statuses with no theatrical meaning).
 *
 * The canonical mission status truth stays in the DB (written by the §18
 * MissionService); this event is a presentation signal, never a state handle.
 */
export const MISSION_STATUS_CHANGED_EVENT = 'mission.status.changed';

export interface MissionStatusChangedPayload {
  /** The canonical mission id (not the attempt run id). */
  missionId: string;
  /** The new mission status string (e.g. running / verifying / completed). */
  status: string;
  /** The current attempt's run id when one exists (for per-attempt beat keying). */
  rootRunId?: string;
}
