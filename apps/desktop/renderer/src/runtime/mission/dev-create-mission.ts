import type { MissionCriterionInput, RuntimeRepositories } from '@offisim/core/browser';
import { createMissionService } from '@offisim/core/browser';

/**
 * Dev-only mission seeder (MS-005, PRD §21.1) — NOT a UI.
 *
 * Until the M3 Composer can author a Verified Mission, this helper creates a
 * mission (+ criteria) and marks it `ready` so the harness and a manual `.app`
 * devtools call can exercise the live mission loop end-to-end. It is intentionally
 * thin: it forwards to {@link createMissionService}'s `createMission` + `markReady`
 * with sensible defaults, so the only thing a caller must supply is the company /
 * thread scope, the goal, and the criteria.
 *
 * Exported for the deterministic harness AND a dev path (devtools / a future dev
 * menu). Do NOT build product UI on top of this — the M3 Composer is the real
 * authoring surface.
 */

export interface DevMissionInput {
  companyId: string;
  threadId: string;
  /** Optional project scope — sets `mission.project_id` so the EvaluationContext
   *  binds to that project's workspace_root. */
  projectId?: string;
  title?: string;
  goal: string;
  criteria: MissionCriterionInput[];
  /** Optional budget JSON (opaque to the seeder; the loop's caps come from the
   *  controller's MissionLoopBudget, not this field). Defaults to '{}'. */
  budgetJson?: string;
}

export interface DevMissionResult {
  missionId: string;
}

/** Create + ready a mission with the given criteria. Returns its id. */
export async function createDevMission(
  repos: RuntimeRepositories,
  input: DevMissionInput,
): Promise<DevMissionResult> {
  const missionService = createMissionService(
    {
      missions: requireRepo(repos, 'missions'),
      missionCriteria: requireRepo(repos, 'missionCriteria'),
      missionAttempts: requireRepo(repos, 'missionAttempts'),
      missionEvaluations: requireRepo(repos, 'missionEvaluations'),
      missionEvents: requireRepo(repos, 'missionEvents'),
    },
    { now: () => new Date().toISOString(), newId: () => crypto.randomUUID() },
  );

  const mission = await missionService.createMission({
    companyId: input.companyId,
    threadId: input.threadId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    title: input.title ?? 'Dev Mission',
    goal: input.goal,
    runtimeId: 'pi',
    runtimePolicyJson: '{}',
    budgetJson: input.budgetJson ?? '{}',
    criteria: input.criteria,
  });
  await missionService.markReady(mission.mission_id);
  return { missionId: mission.mission_id };
}

function requireRepo<K extends keyof RuntimeRepositories>(
  repos: RuntimeRepositories,
  key: K,
): NonNullable<RuntimeRepositories[K]> {
  const repo = repos[key];
  if (!repo) {
    throw new Error(`createDevMission requires repos.${String(key)}, which is unavailable.`);
  }
  return repo as NonNullable<RuntimeRepositories[K]>;
}
