import { reposOrNull } from '@/data/adapters.js';
import {
  type CreateMissionInput,
  type MissionServiceRepos,
  createMissionService,
  generateId,
} from '@offisim/core/browser';
import type {
  MissionAttemptRow,
  MissionCriterionRow,
  MissionEvaluationRow,
  MissionRow,
  RuntimeRepositories,
} from '@offisim/core/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * TanStack Query hooks over the Verified Missions repos (PRD §24, slice
 * UX-001/UX-002). Mirrors the queries.ts convention: `reposOrNull()` is the one
 * door to the SQLite-backed repos, browser preview returns empty (there is no
 * mission fixture seam — missions are a real-backend-only surface), and every
 * mutation goes through {@link createMissionService} (the §18 single writer of
 * `mission.status`) — the renderer never writes `mission.status` directly.
 */

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * Mission statuses where the run loop is live, so the detail surface should poll
 * for the attempt / evaluation / status rows the loop writes as it progresses.
 * A terminal/idle status stops the polling (refetchInterval → false).
 */
const ACTIVE_MISSION_STATUSES = new Set(['running', 'verifying', 'repairing']);
const ACTIVE_REFETCH_MS = 2_000;

export const missionKeys = {
  /** All missions for a company (the list view). */
  list: (companyId: string | null) => ['missions', companyId] as const,
  /** A single mission row. */
  detail: (missionId: string | null) => ['mission', missionId] as const,
  criteria: (missionId: string | null) => ['mission-criteria', missionId] as const,
  attempts: (missionId: string | null) => ['mission-attempts', missionId] as const,
  evaluations: (missionId: string | null) => ['mission-evaluations', missionId] as const,
};

/** The mission-repo subset every mission mutation needs from {@link RuntimeRepositories}. */
function missionServiceRepos(repos: RuntimeRepositories): MissionServiceRepos | null {
  const { missions, missionCriteria, missionAttempts, missionEvaluations, missionEvents } = repos;
  if (!missions || !missionCriteria || !missionAttempts || !missionEvaluations || !missionEvents) {
    return null;
  }
  return { missions, missionCriteria, missionAttempts, missionEvaluations, missionEvents };
}

function buildMissionService(repos: RuntimeRepositories) {
  const subset = missionServiceRepos(repos);
  if (!subset) {
    throw new Error('Mission repositories are unavailable in this runtime.');
  }
  return createMissionService(subset, {
    now: () => new Date().toISOString(),
    newId: () => generateId('mission'),
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useMissions(companyId: string | null) {
  return useQuery<MissionRow[]>({
    queryKey: missionKeys.list(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const repos = await reposOrNull();
      if (!repos?.missions) return [];
      return repos.missions.listByCompany(companyId, { limit: 100 });
    },
    enabled: companyId !== null,
  });
}

export function useMission(missionId: string | null, active = false) {
  return useQuery<MissionRow | null>({
    queryKey: missionKeys.detail(missionId),
    queryFn: async () => {
      if (!missionId) return null;
      const repos = await reposOrNull();
      if (!repos?.missions) return null;
      return repos.missions.findById(missionId);
    },
    enabled: missionId !== null,
    // Poll while the loop is live so the status badge tracks running → verifying
    // → completed without a manual refresh. `active` (the in-memory run flag)
    // engages polling the instant Start is clicked — before the first `running`
    // row lands — and the cached status keeps it polling until a terminal status.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return active || (status && ACTIVE_MISSION_STATUSES.has(status)) ? ACTIVE_REFETCH_MS : false;
    },
  });
}

export function useMissionCriteria(missionId: string | null, active = false) {
  return useQuery<MissionCriterionRow[]>({
    queryKey: missionKeys.criteria(missionId),
    queryFn: async () => {
      if (!missionId) return [];
      const repos = await reposOrNull();
      if (!repos?.missionCriteria) return [];
      return repos.missionCriteria.listByMission(missionId);
    },
    enabled: missionId !== null,
    refetchInterval: active ? ACTIVE_REFETCH_MS : false,
  });
}

export function useMissionAttempts(missionId: string | null, active = false) {
  return useQuery<MissionAttemptRow[]>({
    queryKey: missionKeys.attempts(missionId),
    queryFn: async () => {
      if (!missionId) return [];
      const repos = await reposOrNull();
      if (!repos?.missionAttempts) return [];
      return repos.missionAttempts.listByMission(missionId);
    },
    enabled: missionId !== null,
    refetchInterval: active ? ACTIVE_REFETCH_MS : false,
  });
}

export function useMissionEvaluations(missionId: string | null, active = false) {
  return useQuery<MissionEvaluationRow[]>({
    queryKey: missionKeys.evaluations(missionId),
    queryFn: async () => {
      if (!missionId) return [];
      const repos = await reposOrNull();
      if (!repos?.missionEvaluations) return [];
      return repos.missionEvaluations.listByMission(missionId);
    },
    enabled: missionId !== null,
    refetchInterval: active ? ACTIVE_REFETCH_MS : false,
  });
}

// ---------------------------------------------------------------------------
// Create (UX-001 Composer)
// ---------------------------------------------------------------------------

export interface CreateMissionResult {
  missionId: string;
  threadId: string;
}

/**
 * The real Composer create path: mint a `chat_threads` row for the mission (so
 * the mission has a real thread the run controller can later continue), insert
 * the mission + criteria via MissionService.createMission, then `markReady`
 * (draft → ready) so it is immediately runnable. Returns the new mission id +
 * thread id. Does NOT start the live agent loop (that is the M-pass runner).
 */
export function useCreateMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<CreateMissionInput, 'threadId' | 'projectId'> & { projectId: string | null },
    ): Promise<CreateMissionResult> => {
      const repos = await reposOrNull();
      if (!repos) {
        throw new Error('Creating a mission needs the desktop app.');
      }
      const service = buildMissionService(repos);

      // A mission is scoped to a thread (§16.3 — the run continues that Pi
      // session). Mint a dedicated thread for this mission against the active
      // project so the row is real before the mission references it.
      const threadId = generateId('thread');
      if (input.projectId) {
        if (!(await repos.chatThreads.findById(threadId))) {
          await repos.chatThreads.create({
            thread_id: threadId,
            project_id: input.projectId,
            employee_id: null,
            title: input.title?.trim() || 'Mission',
          });
        }
      }

      const mission = await service.createMission({
        companyId: input.companyId,
        threadId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        title: input.title,
        goal: input.goal,
        runtimeId: input.runtimeId,
        runtimePolicyJson: input.runtimePolicyJson,
        budgetJson: input.budgetJson,
        ...(input.expectedArtifactsJson
          ? { expectedArtifactsJson: input.expectedArtifactsJson }
          : {}),
        criteria: input.criteria,
      });
      await service.markReady(mission.mission_id);
      return { missionId: mission.mission_id, threadId };
    },
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: missionKeys.list(vars.companyId) });
      if (vars.projectId) {
        queryClient.invalidateQueries({ queryKey: ['threads', vars.projectId] });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Transitions (UX-006 pause / resume / cancel) — all through MissionService
// ---------------------------------------------------------------------------

export type MissionTransition = 'pause' | 'resume' | 'cancel';

/**
 * Pause / resume / cancel a mission via MissionService (the §18 transitions).
 * The service rejects an illegal transition (MissionStateError) — the UI
 * disables a control that is not legal from the current status, so this is the
 * safety net rather than the gate. On success it invalidates the mission's row
 * + its company list so the new status renders.
 */
export function useMissionTransition(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      missionId,
      action,
    }: {
      missionId: string;
      action: MissionTransition;
    }): Promise<MissionRow> => {
      const repos = await reposOrNull();
      if (!repos) {
        throw new Error('Controlling a mission needs the desktop app.');
      }
      const service = buildMissionService(repos);
      switch (action) {
        case 'pause':
          return service.pause(missionId);
        case 'resume':
          return service.resume(missionId);
        case 'cancel':
          return service.cancel(missionId);
        default: {
          const exhaustive: never = action;
          throw new Error(`Unknown mission transition: ${String(exhaustive)}`);
        }
      }
    },
    onSuccess: (mission) => {
      queryClient.invalidateQueries({ queryKey: missionKeys.detail(mission.mission_id) });
      queryClient.invalidateQueries({ queryKey: missionKeys.list(companyId) });
      queryClient.invalidateQueries({ queryKey: missionKeys.attempts(mission.mission_id) });
    },
  });
}
