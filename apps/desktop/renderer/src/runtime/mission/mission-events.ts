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
