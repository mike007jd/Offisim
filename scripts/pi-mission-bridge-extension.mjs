// Mission-bridge extension — registers the two Verified Missions agent tools on
// the root Pi session (PRD §16.2 / §16.3, slice MS-005).
//
// Architecture (§4 / §5 / §19.1): the deterministic MissionLoopController runs in
// the RENDERER. The agent's job is to do the work and SIGNAL when a criterion is
// ready; it does NOT decide PASS. These two tools are pure SIGNAL/READ channels:
//
//   - submit_for_evaluation: the agent says "criterion X is ready to check". The
//     host emits a neutral `evaluation_submitted` agentRun line (a payload.type
//     within the existing `agentRun` wire kind — NOT a new wire kind). The
//     renderer correlates it to the current attempt by rootRunId, then runs the
//     DETERMINISTIC evaluator over REAL workspace state. The agent's `summary`
//     here is advisory only — it can never become the PASS (§5).
//   - query_mission_state: the agent asks what the mission is. The host cannot
//     read the Offisim DB (host extensions never touch SQLite — same rule as
//     publish_artifact), so it returns the minimal mission-context summary it was
//     handed at session start (the renderer injected it via missionContextJson)
//     and emits a `mission_state_query` line so the read is auditable.
//
// Registered alongside publish-artifact in resourceLoader.extensionFactories,
// gated on a present mission context (rootRunId + threadId + missionContextJson).
// Reuses agentRunLine from pi-agent-host-wire.mjs. NO wire protocol bump.

import { Type } from 'typebox';
import { agentRunLine } from './pi-agent-host-wire.mjs';

const SubmitForEvaluationParams = Type.Object({
  criterionId: Type.String({
    description:
      'The id of the mission criterion you believe is now satisfied (see query_mission_state).',
  }),
  summary: Type.String({
    description:
      'A short note on what you did for this criterion. ADVISORY ONLY — Offisim verifies the criterion itself; your note does not decide PASS.',
  }),
  evidenceRefs: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Optional evidence pointers (e.g. a workspace path or command you ran). Opaque to the bridge.',
    }),
  ),
});

const QueryMissionStateParams = Type.Object({});

/**
 * Parse the renderer-supplied mission context packet (minimal summary, §16.3).
 * Canonical mission JSON stays in the Offisim DB; only this small summary is
 * injected. A malformed/absent packet degrades to a benign empty summary so the
 * tools never crash the run.
 * @param {string | undefined} missionContextJson
 */
function parseMissionContext(missionContextJson) {
  if (typeof missionContextJson !== 'string' || !missionContextJson.trim()) return {};
  try {
    const parsed = JSON.parse(missionContextJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Build the extension factory that registers `submit_for_evaluation` +
 * `query_mission_state`, closing over the host's raw wire emitter, this run's
 * scope fields, and the mission-context summary the renderer injected.
 * @param {{
 *   emit: (line: object) => void,
 *   threadId: string,
 *   rootRunId: string,
 *   employeeId?: string,
 *   missionContextJson?: string,
 * }} ctx
 */
export function createMissionBridgeExtensionFactory({
  emit,
  threadId,
  rootRunId,
  employeeId,
  missionContextJson,
}) {
  const missionContext = parseMissionContext(missionContextJson);
  return (pi) => {
    pi.registerTool({
      name: 'submit_for_evaluation',
      label: 'Submit For Evaluation',
      description:
        'Signal that a mission acceptance criterion is ready to be verified. Offisim then runs the deterministic check for that criterion against the real workspace. Your summary is advisory only — it does not decide PASS/FAIL.',
      parameters: SubmitForEvaluationParams,

      async execute(_toolCallId, params, _signal) {
        const criterionId = typeof params.criterionId === 'string' ? params.criterionId.trim() : '';
        const summary = typeof params.summary === 'string' ? params.summary.trim() : '';
        if (!criterionId) {
          return {
            content: [
              {
                type: 'text',
                text: 'submit_for_evaluation: a non-empty criterionId is required (see query_mission_state for the criteria).',
              },
            ],
            isError: true,
          };
        }
        const evidenceRefs = Array.isArray(params.evidenceRefs)
          ? params.evidenceRefs.filter((ref) => typeof ref === 'string')
          : [];
        emit(
          agentRunLine({
            threadId,
            rootRunId,
            runId: rootRunId,
            ...(employeeId ? { employeeId } : {}),
            runType: 'evaluation_submitted',
            payload: { criterionId, summary, evidenceRefs },
          }),
        );
        return {
          content: [
            {
              type: 'text',
              text: `Submitted criterion "${criterionId}" for evaluation. Offisim will verify it against the workspace; keep working on any remaining criteria.`,
            },
          ],
        };
      },
    });

    pi.registerTool({
      name: 'query_mission_state',
      label: 'Query Mission State',
      description:
        'Return the current mission goal and its acceptance criteria so you know what to build and which criterion ids to submit for evaluation.',
      parameters: QueryMissionStateParams,

      async execute(_toolCallId, _params, _signal) {
        emit(
          agentRunLine({
            threadId,
            rootRunId,
            runId: rootRunId,
            ...(employeeId ? { employeeId } : {}),
            runType: 'mission_state_query',
            payload: {},
          }),
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(missionContext, null, 2) }],
        };
      },
    });
  };
}
