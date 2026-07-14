import type {
  ActiveInteractionRepository,
  AgentRunRepository,
  AgentRunRow,
  MissionAttemptRepository,
  MissionAttemptRow,
  MissionCriterionRepository,
  MissionEvaluationRepository,
  MissionEventRepository,
  MissionEventRow,
  MissionRepository,
  MissionRow,
  RuntimeSessionLinkRepository,
} from '@offisim/core/browser';
import {
  createMissionService,
  isCompatible,
  reconcileInterruptedMissions,
} from '@offisim/core/browser';

const RECOVERABLE_MISSION_STATUSES = ['running', 'verifying', 'repairing'] as const;
const RELOAD_DISCOVERY_STATUSES = [...RECOVERABLE_MISSION_STATUSES, 'interrupted'] as const;
const UNKNOWN_RELOAD_COMPATIBILITY = 'renderer-reload:compatibility-unavailable';
const RELOAD_RECOVERY_MARKER = 'mission.renderer_reload_recovery';
const RELOAD_RECOVERY_EVENT_WINDOW = 32;
// Rust can spend two seconds draining workspace calls and then another two on
// graceful sidecar process-group shutdown. Ten seconds leaves clear headroom for
// both bounded phases plus stream terminalization and IPC scheduling.
const DEFAULT_SETTLE_PROBES = 100;
const DEFAULT_SETTLE_DELAY_MS = 100;

interface MissionReloadStreamSnapshot {
  running: boolean;
  terminal?: {
    status: string;
    message?: string;
  };
}

interface MissionReloadHostControl {
  snapshot(requestId: string): Promise<MissionReloadStreamSnapshot | null>;
  abort(requestId: string): Promise<void>;
}

interface MissionReloadRepositories {
  agentRuns: AgentRunRepository;
  missions: MissionRepository;
  missionCriteria: MissionCriterionRepository;
  missionAttempts: MissionAttemptRepository;
  missionEvaluations: MissionEvaluationRepository;
  runtimeSessionLinks: RuntimeSessionLinkRepository;
  missionEvents: MissionEventRepository;
  activeInteractions?: ActiveInteractionRepository;
}

export interface MissionReloadRecoveryResult {
  missionIds: string[];
  terminalizedRootRunIds: string[];
}

/**
 * A renderer may own Missions in several companies at once. Run every company
 * convergence even when one fails, then reject as one startup gate so no
 * Conversation scope is exposed while another company's native host is still
 * writing files or consuming subscription/API usage.
 */
export async function bootstrapMissionReloadCompanies(
  companyIds: readonly string[],
  bootstrapCompany: (companyId: string) => Promise<MissionReloadRecoveryResult>,
): Promise<MissionReloadRecoveryResult[]> {
  const uniqueCompanyIds = [...new Set(companyIds.filter((companyId) => companyId.length > 0))];
  const settled = await Promise.allSettled(
    uniqueCompanyIds.map((companyId) => bootstrapCompany(companyId)),
  );
  const failedCompanyIds = settled.flatMap((result, index) =>
    result.status === 'rejected' ? [uniqueCompanyIds[index]] : [],
  );
  if (failedCompanyIds.length > 0) {
    throw new AggregateError(
      settled.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
      `Mission reload recovery failed for companies: ${failedCompanyIds.join(', ')}.`,
    );
  }
  return settled.map((result) => {
    if (result.status === 'fulfilled') return result.value;
    throw new Error('Mission reload company aggregation reached an impossible rejected state.');
  });
}

export interface ConvergeMissionReloadInput {
  companyId: string;
  repos: MissionReloadRepositories;
  host: MissionReloadHostControl;
  now: () => string;
  newId: () => string;
  currentCompatibilityHash?: string;
  settleDelay?: (delayMs: number) => Promise<void>;
  maxSettleProbes?: number;
}

interface MissionRootCandidate {
  missionId: string;
  threadId: string;
  projectId: string | null;
  attempt: MissionAttemptRow;
  root: AgentRunRow;
  requestId: string | null;
}

interface ParsedRootContext {
  requestId: string | null;
  hasConversationProjection: boolean;
}

interface ReloadRecoveryMarkerData {
  fromStatus: string;
}

function reloadRecoveryMarkerId(missionId: string, attemptId: string | null): string {
  return `mission-reload:${missionId}:${attemptId ?? 'no-attempt'}`;
}

function parseReloadRecoveryMarker(event: MissionEventRow): ReloadRecoveryMarkerData | null {
  if (event.type !== RELOAD_RECOVERY_MARKER) return null;
  try {
    const value = JSON.parse(event.data_json) as Record<string, unknown>;
    return typeof value.fromStatus === 'string' ? { fromStatus: value.fromStatus } : null;
  } catch {
    return null;
  }
}

async function insertReloadRecoveryMarker(
  mission: MissionRow,
  repo: MissionEventRepository,
  createdAt: string,
): Promise<void> {
  await repo.insert({
    mission_event_id: reloadRecoveryMarkerId(mission.mission_id, mission.current_attempt_id),
    mission_id: mission.mission_id,
    attempt_id: mission.current_attempt_id,
    type: RELOAD_RECOVERY_MARKER,
    data_json: JSON.stringify({ fromStatus: mission.status }),
    created_at: createdAt,
  });
}

async function ensureReloadTransitionEvent({
  mission,
  marker,
  events,
  type,
  from,
  to,
  repo,
  createdAt,
}: {
  mission: MissionRow;
  marker: MissionEventRow;
  events: MissionEventRow[];
  type: string;
  from: string;
  to: string;
  repo: MissionEventRepository;
  createdAt: string;
}): Promise<void> {
  if (
    events.some((event) => event.attempt_id === mission.current_attempt_id && event.type === type)
  ) {
    return;
  }
  await repo.insert({
    mission_event_id: `${marker.mission_event_id}:${type}`,
    mission_id: mission.mission_id,
    attempt_id: mission.current_attempt_id,
    type,
    data_json: JSON.stringify({ from, to, reconstructedAfterRendererReload: true }),
    created_at: createdAt,
  });
}

/** Finish durable writes that core reconciliation may have partially committed
 * after moving the Mission to ready_to_resume. The marker is written before the
 * state transition, making this idempotent across process death and DB retries. */
async function finalizeMarkedReadyMissions({
  companyId,
  repos,
  currentCompatibilityHash,
  now,
  inspectedMissionIds,
}: {
  companyId: string;
  repos: MissionReloadRepositories;
  currentCompatibilityHash: string;
  now: () => string;
  inspectedMissionIds: Set<string>;
}): Promise<string[]> {
  const finalized: string[] = [];
  const readyMissions = await repos.missions.listByStatus(companyId, ['ready_to_resume']);
  for (const mission of readyMissions) {
    if (inspectedMissionIds.has(mission.mission_id)) continue;
    const events = await repos.missionEvents.listByMission(mission.mission_id, {
      limit: RELOAD_RECOVERY_EVENT_WINDOW,
    });
    const marker = [...events]
      .reverse()
      .find(
        (event) =>
          event.type === RELOAD_RECOVERY_MARKER &&
          event.attempt_id === mission.current_attempt_id &&
          parseReloadRecoveryMarker(event) !== null,
      );
    if (!marker) {
      inspectedMissionIds.add(mission.mission_id);
      continue;
    }
    const markerData = parseReloadRecoveryMarker(marker);
    if (!markerData) {
      inspectedMissionIds.add(mission.mission_id);
      continue;
    }

    if (mission.current_attempt_id) {
      const attempt = await repos.missionAttempts.findById(mission.current_attempt_id);
      if (attempt && attempt.status !== 'interrupted') {
        await repos.missionAttempts.updateStatus(attempt.attempt_id, 'interrupted', {
          finishedAt: now(),
        });
      }
    }

    const eventTime = now();
    if (markerData.fromStatus === 'repairing') {
      await ensureReloadTransitionEvent({
        mission,
        marker,
        events,
        type: 'mission.resumed',
        from: 'repairing',
        to: 'running',
        repo: repos.missionEvents,
        createdAt: eventTime,
      });
    }
    if (markerData.fromStatus !== 'interrupted') {
      await ensureReloadTransitionEvent({
        mission,
        marker,
        events,
        type: 'mission.interrupted',
        from: markerData.fromStatus === 'repairing' ? 'running' : markerData.fromStatus,
        to: 'interrupted',
        repo: repos.missionEvents,
        createdAt: eventTime,
      });
    }
    await ensureReloadTransitionEvent({
      mission,
      marker,
      events,
      type: 'mission.ready_to_resume',
      from: 'interrupted',
      to: 'ready_to_resume',
      repo: repos.missionEvents,
      createdAt: eventTime,
    });

    const latestLink = await repos.runtimeSessionLinks.findLatestByMission(mission.mission_id);
    if (latestLink) {
      const desiredStatus = isCompatible(latestLink.compatibility_hash, currentCompatibilityHash)
        ? 'interrupted'
        : 'incompatible';
      if (latestLink.status !== desiredStatus) {
        await repos.runtimeSessionLinks.update(latestLink.runtime_session_link_id, {
          status: desiredStatus,
        });
        const updated = await repos.runtimeSessionLinks.findById(
          latestLink.runtime_session_link_id,
        );
        if (updated?.status !== desiredStatus) {
          throw new Error(
            `Mission ${mission.mission_id} runtime session link did not persist reload recovery status.`,
          );
        }
      }
    }
    inspectedMissionIds.add(mission.mission_id);
    finalized.push(mission.mission_id);
  }
  return finalized;
}

function parseRootContext(raw: string | null): ParsedRootContext {
  if (!raw) return { requestId: null, hasConversationProjection: false };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== 'object') {
      return { requestId: null, hasConversationProjection: false };
    }
    const requestId =
      typeof value.requestId === 'string' && value.requestId.trim() ? value.requestId.trim() : null;
    return {
      requestId,
      hasConversationProjection:
        value.conversationProjection !== null && value.conversationProjection !== undefined,
    };
  } catch {
    return { requestId: null, hasConversationProjection: false };
  }
}

async function activeMissionAttempt(
  missionId: string,
  currentAttemptId: string | null,
  repo: MissionAttemptRepository,
): Promise<MissionAttemptRow | null> {
  if (!currentAttemptId) return null;
  const attempt = await repo.findById(currentAttemptId);
  if (attempt && attempt.mission_id !== missionId) {
    throw new Error(`Mission ${missionId} points at an attempt owned by another Mission.`);
  }
  return attempt;
}

function assertMissionRootScope(
  candidate: Omit<MissionRootCandidate, 'requestId'>,
): ParsedRootContext {
  const { missionId, threadId, projectId, attempt, root } = candidate;
  if (
    attempt.mission_id !== missionId ||
    root.run_id !== root.root_run_id ||
    root.run_id !== attempt.root_run_id ||
    root.parent_run_id !== null ||
    root.thread_id !== threadId ||
    (projectId !== null && root.project_id !== projectId)
  ) {
    throw new Error(`Mission ${missionId} has an invalid active agent root scope.`);
  }
  const context = parseRootContext(root.runtime_context_json);
  if (context.hasConversationProjection) {
    throw new Error(`Mission ${missionId} agent root is incorrectly owned by Conversation UI.`);
  }
  if (root.status === 'running' && !context.requestId) {
    throw new Error(`Mission ${missionId} agent root has no native host request identity.`);
  }
  return context;
}

async function waitForHostToSettle(
  requestId: string,
  host: MissionReloadHostControl,
  settleDelay: (delayMs: number) => Promise<void>,
  maxSettleProbes: number,
): Promise<MissionReloadStreamSnapshot | null> {
  let snapshot = await host.snapshot(requestId);
  if (!snapshot?.running) return snapshot;

  await host.abort(requestId);
  for (let probe = 0; probe < maxSettleProbes; probe += 1) {
    await settleDelay(DEFAULT_SETTLE_DELAY_MS);
    snapshot = await host.snapshot(requestId);
    if (!snapshot?.running) return snapshot;
  }
  throw new Error(`Mission native host ${requestId} did not stop after renderer reload.`);
}

function terminalStatus(
  snapshot: MissionReloadStreamSnapshot | null,
): 'completed' | 'failed' | 'cancelled' {
  switch (snapshot?.terminal?.status) {
    case 'completed':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'cancelled';
  }
}

async function terminalizeAgentSubtree(
  candidate: MissionRootCandidate,
  snapshot: MissionReloadStreamSnapshot | null,
  repo: AgentRunRepository,
  finishedAt: string,
): Promise<void> {
  const currentRoot = await repo.findById(candidate.root.run_id);
  if (!currentRoot) {
    throw new Error(
      `Mission agent root ${candidate.root.run_id} disappeared during reload recovery.`,
    );
  }
  const subtree = await repo.findByRoot(candidate.root.run_id);
  if (subtree.some((row) => row.company_id !== currentRoot.company_id)) {
    throw new Error(`Mission agent root ${candidate.root.run_id} has a cross-company subtree.`);
  }
  // Children commit first and the running root is the retry marker. A partial
  // repository failure therefore cannot make a later bootstrap mistake the
  // subtree for fully terminalized work.
  for (const row of subtree) {
    if (row.run_id === candidate.root.run_id || row.status !== 'running') continue;
    const childUpdated = await repo.updateStatusForCompany(
      currentRoot.company_id,
      row.run_id,
      'cancelled',
      { finishedAt },
    );
    if (!childUpdated) {
      throw new Error(`Mission child agent ${row.run_id} disappeared during reload recovery.`);
    }
  }
  const remainingRunningChildren = (await repo.findByRoot(candidate.root.run_id)).filter(
    (row) => row.run_id !== candidate.root.run_id && row.status === 'running',
  );
  if (remainingRunningChildren.length > 0) {
    throw new Error(
      `Mission agent root ${candidate.root.run_id} still has running child agents after reload recovery.`,
    );
  }
  if (currentRoot.status === 'running') {
    const status = terminalStatus(snapshot);
    const updated = await repo.updateStatusForCompany(
      currentRoot.company_id,
      currentRoot.run_id,
      status,
      {
        finishedAt,
        ...(snapshot?.terminal?.message
          ? { resultSummaryJson: JSON.stringify({ summary: snapshot.terminal.message }) }
          : {}),
        ...(status === 'failed' ? { failureKind: 'runtime' } : {}),
      },
    );
    if (!updated) {
      throw new Error(
        `Mission agent root ${candidate.root.run_id} disappeared during reload recovery.`,
      );
    }
  }
}

/**
 * A renderer reload cannot continue the deterministic Mission loop from its lost
 * JavaScript promise. This startup gate therefore stops every provably Mission-
 * owned native root, terminalizes its agent subtree, then parks the Mission via
 * the existing MissionService reconciliation path. It never projects a Mission
 * root into Conversation UI and never auto-resumes work.
 */
export async function convergeMissionReload(
  input: ConvergeMissionReloadInput,
): Promise<MissionReloadRecoveryResult> {
  const { companyId, repos, host, now, newId } = input;
  const currentCompatibilityHash = input.currentCompatibilityHash ?? UNKNOWN_RELOAD_COMPATIBILITY;
  const settleDelay =
    input.settleDelay ??
    ((delayMs: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs)));
  const maxSettleProbes = input.maxSettleProbes ?? DEFAULT_SETTLE_PROBES;
  if (!Number.isSafeInteger(maxSettleProbes) || maxSettleProbes < 1) {
    throw new Error('Mission reload settle probe count must be a positive integer.');
  }

  // `interrupted` is included for retry convergence: a prior DB failure may have
  // committed running→interrupted but not interrupted→ready_to_resume.
  const missions = await repos.missions.listByStatus(companyId, RELOAD_DISCOVERY_STATUSES);
  const candidates: MissionRootCandidate[] = [];
  const claimedRootIds = new Set<string>();
  for (const mission of missions) {
    const attempt = await activeMissionAttempt(
      mission.mission_id,
      mission.current_attempt_id,
      repos.missionAttempts,
    );
    if (!attempt?.root_run_id) continue;
    const root = await repos.agentRuns.findById(attempt.root_run_id);
    if (!root) continue;
    if (root.company_id !== companyId) {
      throw new Error(`Mission ${mission.mission_id} agent root crosses company scope.`);
    }
    if (claimedRootIds.has(root.run_id)) {
      throw new Error(`Agent root ${root.run_id} is claimed by multiple active Missions.`);
    }
    const owned = {
      missionId: mission.mission_id,
      threadId: mission.thread_id,
      projectId: mission.project_id,
      attempt,
      root,
    };
    const context = assertMissionRootScope(owned);
    const hasRunningChild = (await repos.agentRuns.findByRoot(root.run_id)).some(
      (row) => row.run_id !== root.run_id && row.status === 'running',
    );
    if (root.status !== 'running' && !hasRunningChild) continue;
    claimedRootIds.add(root.run_id);
    candidates.push({
      ...owned,
      requestId: root.status === 'running' ? context.requestId : null,
    });
  }

  const settledHosts = await Promise.allSettled(
    candidates.map(async (candidate) => ({
      candidate,
      snapshot: candidate.requestId
        ? await waitForHostToSettle(candidate.requestId, host, settleDelay, maxSettleProbes)
        : null,
    })),
  );
  const hostFailures = settledHosts.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (hostFailures.length === 1) throw hostFailures[0];
  if (hostFailures.length > 1) {
    throw new AggregateError(
      hostFailures,
      'Multiple Mission native hosts did not stop after renderer reload.',
    );
  }
  for (const result of settledHosts) {
    if (result.status !== 'fulfilled') {
      throw new Error('Mission host aggregation reached an impossible rejected state.');
    }
    await terminalizeAgentSubtree(
      result.value.candidate,
      result.value.snapshot,
      repos.agentRuns,
      now(),
    );
  }

  // Persist the retry marker only after all owned native roots have stopped.
  // From here onward every Mission/attempt/event/link write can be completed by
  // a later bootstrap even if this renderer or repository call fails midway.
  for (const mission of missions) {
    await insertReloadRecoveryMarker(mission, repos.missionEvents, now());
  }

  const missionService = createMissionService(
    {
      missions: repos.missions,
      missionCriteria: repos.missionCriteria,
      missionAttempts: repos.missionAttempts,
      missionEvaluations: repos.missionEvaluations,
      missionEvents: repos.missionEvents,
    },
    { now, newId },
  );
  const repairedMissionIds: string[] = [];
  const inspectedReadyMissionIds = new Set<string>();
  const finishInterruptedMissions = async (): Promise<void> => {
    const interrupted = await repos.missions.listByStatus(companyId, ['interrupted']);
    for (const mission of interrupted) {
      await missionService.toReadyToResume(mission.mission_id);
      repairedMissionIds.push(mission.mission_id);
    }
  };
  const finalizeReadyMissions = async (): Promise<void> => {
    repairedMissionIds.push(
      ...(await finalizeMarkedReadyMissions({
        companyId,
        repos,
        currentCompatibilityHash,
        now,
        inspectedMissionIds: inspectedReadyMissionIds,
      })),
    );
  };

  // Close a partially committed previous pass first. If this pass fails after
  // writing `interrupted`, make the same best-effort closure before surfacing the
  // retryable error so no successfully processed Mission remains a ghost.
  await finishInterruptedMissions();
  await finalizeReadyMissions();
  let reconciliation: Awaited<ReturnType<typeof reconcileInterruptedMissions>>;
  try {
    reconciliation = await reconcileInterruptedMissions({
      missionService,
      repos: {
        missions: repos.missions,
        missionCriteria: repos.missionCriteria,
        missionAttempts: repos.missionAttempts,
        runtimeSessionLinks: repos.runtimeSessionLinks,
        activeInteractions: repos.activeInteractions,
      },
      currentCompatibilityHash,
      now,
      companyIds: [companyId],
    });
    await finishInterruptedMissions();
    await finalizeReadyMissions();
  } catch (error) {
    try {
      await finishInterruptedMissions();
      await finalizeReadyMissions();
    } catch (closureError) {
      throw new AggregateError(
        [error, closureError],
        'Mission reload reconciliation and durable recovery closure both failed.',
      );
    }
    throw error;
  }

  return {
    missionIds: [
      ...new Set([...repairedMissionIds, ...reconciliation.cards.map((card) => card.missionId)]),
    ],
    terminalizedRootRunIds: candidates.map((candidate) => candidate.root.run_id),
  };
}
