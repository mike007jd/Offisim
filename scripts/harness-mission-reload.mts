import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();

/**
 * Renderer-reload Mission convergence oracle.
 *
 * Exercises the production bootstrap seam over the real MissionService,
 * reconcileInterruptedMissions, and in-memory agent/mission repositories. The
 * native host boundary is injected so reload races are deterministic.
 */

import assert from 'node:assert/strict';
import {
  guardCurrentSurfaceScopeChange,
  registerSurfaceLeaveGuard,
  useUiState,
} from '../apps/desktop/renderer/src/app/ui-state.ts';
import {
  beginCompanyScopeActivation,
  bootstrapCompanyScopeRuns,
  commitCompanyScopeActivation,
  invalidateCompanyScopeActivation,
} from '../apps/desktop/renderer/src/runtime/activate-company-scope.ts';
import {
  bootstrapMissionReloadCompanies,
  convergeMissionReload,
} from '../apps/desktop/renderer/src/runtime/mission/mission-reload-recovery.ts';
import { reconcileInterruptedRuns } from '../apps/desktop/renderer/src/runtime/recovery/reconcile-interrupted-runs.ts';
import {
  type CreateMissionInput,
  type MissionService,
  type MissionServiceDeps,
  createMissionService,
} from '../packages/core/src/runtime/mission/mission-service.ts';
import { MemoryAgentRunRepository } from '../packages/core/src/runtime/repos/agent-runs/memory.ts';
import {
  type MissionMemoryRepos,
  createMissionMemoryRepos,
} from '../packages/core/src/runtime/repos/mission/memory.ts';
import type {
  AgentRunStatusUpdateOptions,
  NewAgentRun,
  NewRuntimeSessionLink,
} from '../packages/core/src/runtime/repositories.ts';
const TOTAL = 19;
const COMPANY_ID = 'company-reload';
const PROJECT_ID = 'project-reload';
const THREAD_ID = 'thread-reload';
const FINISHED_AT = '2026-07-14T05:00:00.000Z';
const check = h.checkAsync;

function deterministicDeps(): MissionServiceDeps {
  let id = 0;
  return {
    now: () => FINISHED_AT,
    newId: () => `reload-id-${++id}`,
  };
}

interface Fixture {
  service: MissionService;
  mission: MissionMemoryRepos;
  agentRuns: MemoryAgentRunRepository;
  deps: MissionServiceDeps;
}

function fixture(agentRuns: MemoryAgentRunRepository = new MemoryAgentRunRepository()): Fixture {
  const mission = createMissionMemoryRepos();
  const deps = deterministicDeps();
  const service = createMissionService(
    {
      missions: mission.missions,
      missionCriteria: mission.missionCriteria,
      missionAttempts: mission.missionAttempts,
      missionEvaluations: mission.missionEvaluations,
      missionEvents: mission.missionEvents,
    },
    deps,
  );
  return { service, mission, agentRuns, deps };
}

async function createRunningMission(
  f: Fixture,
  input: Partial<CreateMissionInput> = {},
): Promise<{ missionId: string; attemptId: string }> {
  const mission = await f.service.createMission({
    companyId: COMPANY_ID,
    projectId: PROJECT_ID,
    threadId: THREAD_ID,
    title: 'Reload-safe Mission',
    goal: 'Converge after renderer reload',
    runtimeId: 'pi',
    runtimePolicyJson: '{}',
    budgetJson: '{}',
    criteria: [{ description: 'gate', evaluatorId: 'file_exists', required: true }],
    ...input,
  });
  await f.service.markReady(mission.mission_id);
  const running = await f.service.startAttempt(mission.mission_id, 'initial');
  const attemptId = running.current_attempt_id;
  assert.ok(attemptId, 'running Mission must bind its active attempt');
  await f.mission.missionAttempts.setRootRunId(attemptId, attemptId);
  return { missionId: mission.mission_id, attemptId };
}

function rootRun(
  runId: string,
  requestId: string,
  overrides: Partial<NewAgentRun> = {},
): NewAgentRun {
  return {
    run_id: runId,
    thread_id: THREAD_ID,
    company_id: COMPANY_ID,
    project_id: PROJECT_ID,
    parent_run_id: null,
    root_run_id: runId,
    employee_id: null,
    relation: null,
    objective: 'Mission attempt',
    access: 'write',
    status: 'running',
    runtime_context_json: JSON.stringify({
      requestId,
      workspaceRequirement: 'required',
      conversationProjection: null,
    }),
    ...overrides,
  };
}

function childRun(runId: string, rootRunId: string): NewAgentRun {
  return {
    run_id: runId,
    thread_id: THREAD_ID,
    company_id: COMPANY_ID,
    project_id: PROJECT_ID,
    parent_run_id: rootRunId,
    root_run_id: rootRunId,
    employee_id: 'employee-child',
    relation: 'delegate',
    objective: 'Mission child',
    access: 'write',
    status: 'running',
  };
}

class FakeMissionHost {
  readonly abortCalls: string[] = [];
  readonly snapshotCalls = new Map<string, number>();
  readonly snapshots = new Map<
    string,
    { running: boolean; terminal?: { status: string; message?: string } } | null
  >();
  settleOnAbort = true;
  settleAfterSnapshotCount: number | null = null;

  async snapshot(requestId: string) {
    const count = (this.snapshotCalls.get(requestId) ?? 0) + 1;
    this.snapshotCalls.set(requestId, count);
    if (
      this.abortCalls.includes(requestId) &&
      this.settleAfterSnapshotCount !== null &&
      count >= this.settleAfterSnapshotCount
    ) {
      this.snapshots.set(requestId, {
        running: false,
        terminal: { status: 'aborted', message: 'renderer reload' },
      });
    }
    return this.snapshots.get(requestId) ?? null;
  }

  async abort(requestId: string): Promise<void> {
    this.abortCalls.push(requestId);
    if (this.settleOnAbort && this.settleAfterSnapshotCount === null) {
      this.snapshots.set(requestId, {
        running: false,
        terminal: { status: 'aborted', message: 'renderer reload' },
      });
    }
  }
}

class FailOnceChildAgentRunRepository extends MemoryAgentRunRepository {
  private failed = false;

  override async updateStatusForCompany(
    companyId: string,
    runId: string,
    status: string,
    opts?: AgentRunStatusUpdateOptions,
  ): Promise<boolean> {
    if (!this.failed && runId === 'partial-child' && status === 'cancelled') {
      this.failed = true;
      throw new Error('scripted child write failure');
    }
    return super.updateStatusForCompany(companyId, runId, status, opts);
  }
}

async function converge(
  f: Fixture,
  host: FakeMissionHost,
  maxSettleProbes = 2,
  settleDelays?: number[],
  currentCompatibilityHash?: string,
) {
  return convergeMissionReload({
    companyId: COMPANY_ID,
    repos: {
      agentRuns: f.agentRuns,
      missions: f.mission.missions,
      missionCriteria: f.mission.missionCriteria,
      missionAttempts: f.mission.missionAttempts,
      missionEvaluations: f.mission.missionEvaluations,
      runtimeSessionLinks: f.mission.runtimeSessionLinks,
      missionEvents: f.mission.missionEvents,
    },
    host,
    now: f.deps.now,
    newId: f.deps.newId,
    settleDelay: async (delayMs) => {
      settleDelays?.push(delayMs);
    },
    maxSettleProbes,
    currentCompatibilityHash,
  });
}

await check(
  'running Mission root is aborted, agent subtree terminalizes, and Mission parks ready_to_resume',
  async () => {
    const f = fixture();
    const { missionId, attemptId } = await createRunningMission(f);
    await f.agentRuns.create(rootRun(attemptId, 'request-mission'));
    await f.agentRuns.create(childRun('mission-child', attemptId));
    const host = new FakeMissionHost();
    host.snapshots.set('request-mission', { running: true });

    const result = await converge(f, host);

    assert.deepEqual(host.abortCalls, ['request-mission']);
    assert.deepEqual(result.missionIds, [missionId]);
    assert.deepEqual(result.terminalizedRootRunIds, [attemptId]);
    assert.equal((await f.agentRuns.findById(attemptId))?.status, 'cancelled');
    assert.equal((await f.agentRuns.findById('mission-child'))?.status, 'cancelled');
    assert.equal((await f.mission.missionAttempts.findById(attemptId))?.status, 'interrupted');
    assert.equal((await f.mission.missions.findById(missionId))?.status, 'ready_to_resume');

    const genericRecovery = await reconcileInterruptedRuns({
      repo: f.agentRuns,
      companyId: COMPANY_ID,
      now: f.deps.now,
    });
    assert.equal(
      genericRecovery.cards.length,
      0,
      'Mission root never becomes a chat recovery card',
    );
  },
);

await check(
  'already-terminal native Mission result is preserved without a redundant abort',
  async () => {
    const f = fixture();
    const { missionId, attemptId } = await createRunningMission(f);
    await f.agentRuns.create(rootRun(attemptId, 'request-complete'));
    const host = new FakeMissionHost();
    host.snapshots.set('request-complete', {
      running: false,
      terminal: { status: 'completed', message: 'agent turn completed before reload' },
    });

    await converge(f, host);

    assert.deepEqual(host.abortCalls, []);
    assert.equal((await f.agentRuns.findById(attemptId))?.status, 'completed');
    assert.equal((await f.mission.missions.findById(missionId))?.status, 'ready_to_resume');
  },
);

await check(
  'an unrelated projection-less Conversation root is not claimed by Mission bootstrap',
  async () => {
    const f = fixture();
    await f.agentRuns.create(rootRun('conversation-root', 'request-conversation'));
    const host = new FakeMissionHost();
    host.snapshots.set('request-conversation', { running: true });

    const result = await converge(f, host);

    assert.deepEqual(result.missionIds, []);
    assert.deepEqual(host.abortCalls, []);
    assert.equal((await f.agentRuns.findById('conversation-root'))?.status, 'running');
  },
);

await check(
  'a Mission attempt cannot claim a root carrying Conversation projection ownership',
  async () => {
    const f = fixture();
    const { missionId, attemptId } = await createRunningMission(f);
    await f.agentRuns.create(
      rootRun(attemptId, 'request-hybrid', {
        runtime_context_json: JSON.stringify({
          requestId: 'request-hybrid',
          conversationProjection: {
            userMessageId: 'user-message',
            assistantMessageId: 'assistant-message',
            source: 'office',
          },
        }),
      }),
    );
    const host = new FakeMissionHost();
    host.snapshots.set('request-hybrid', { running: true });

    await assert.rejects(() => converge(f, host), /incorrectly owned by Conversation UI/);
    assert.deepEqual(host.abortCalls, []);
    assert.equal((await f.agentRuns.findById(attemptId))?.status, 'running');
    assert.equal((await f.mission.missions.findById(missionId))?.status, 'running');
  },
);

await check('a Mission attempt cannot abort a root from another company', async () => {
  const f = fixture();
  const { missionId, attemptId } = await createRunningMission(f);
  await f.agentRuns.create(
    rootRun(attemptId, 'request-foreign', { company_id: 'company-foreign' }),
  );
  const host = new FakeMissionHost();
  host.snapshots.set('request-foreign', { running: true });

  await assert.rejects(() => converge(f, host), /crosses company scope/);
  assert.deepEqual(host.abortCalls, []);
  assert.equal((await f.agentRuns.findById(attemptId))?.status, 'running');
  assert.equal((await f.mission.missions.findById(missionId))?.status, 'running');
});

await check(
  'native host settling near the bounded 10s terminal deadline still converges',
  async () => {
    const f = fixture();
    const { missionId, attemptId } = await createRunningMission(f);
    await f.agentRuns.create(rootRun(attemptId, 'request-near-boundary'));
    const host = new FakeMissionHost();
    host.snapshots.set('request-near-boundary', { running: true });
    // Initial probe + 99 post-abort probes: at 100ms cadence this represents 9.9s,
    // proving the gate retains clear headroom beyond Rust's full 4s cleanup bound.
    host.settleAfterSnapshotCount = 100;
    const settleDelays: number[] = [];

    await converge(f, host, 100, settleDelays);

    assert.equal(host.snapshotCalls.get('request-near-boundary'), 100);
    assert.equal(settleDelays.length, 99);
    assert.ok(settleDelays.every((delayMs) => delayMs === 100));
    assert.equal((await f.agentRuns.findById(attemptId))?.status, 'cancelled');
    assert.equal((await f.mission.missions.findById(missionId))?.status, 'ready_to_resume');
  },
);

await check('Mission state is not reconciled until the native host proves it stopped', async () => {
  const f = fixture();
  const { missionId, attemptId } = await createRunningMission(f);
  await f.agentRuns.create(rootRun(attemptId, 'request-stuck'));
  const host = new FakeMissionHost();
  host.snapshots.set('request-stuck', { running: true });
  host.settleOnAbort = false;

  await assert.rejects(() => converge(f, host), /did not stop after renderer reload/);
  assert.deepEqual(host.abortCalls, ['request-stuck']);
  assert.equal((await f.agentRuns.findById(attemptId))?.status, 'running');
  assert.equal((await f.mission.missions.findById(missionId))?.status, 'running');
});

await check(
  'same-company Mission hosts settle concurrently before durable writes begin',
  async () => {
    const f = fixture();
    const first = await createRunningMission(f, { title: 'First concurrent reload Mission' });
    const secondThreadId = 'thread-reload-peer';
    const second = await createRunningMission(f, {
      threadId: secondThreadId,
      title: 'Second concurrent reload Mission',
    });
    await f.agentRuns.create(rootRun(first.attemptId, 'request-concurrent-first'));
    await f.agentRuns.create(
      rootRun(second.attemptId, 'request-concurrent-second', { thread_id: secondThreadId }),
    );
    const host = new FakeMissionHost();
    host.settleOnAbort = false;
    host.settleAfterSnapshotCount = 2;
    host.snapshots.set('request-concurrent-first', { running: true });
    host.snapshots.set('request-concurrent-second', { running: true });
    let settleRounds = 0;

    const result = await convergeMissionReload({
      companyId: COMPANY_ID,
      repos: {
        agentRuns: f.agentRuns,
        missions: f.mission.missions,
        missionCriteria: f.mission.missionCriteria,
        missionAttempts: f.mission.missionAttempts,
        missionEvaluations: f.mission.missionEvaluations,
        runtimeSessionLinks: f.mission.runtimeSessionLinks,
        missionEvents: f.mission.missionEvents,
      },
      host,
      now: f.deps.now,
      newId: f.deps.newId,
      settleDelay: async () => {
        settleRounds += 1;
        assert.equal(
          host.abortCalls.length,
          2,
          'both independent hosts are aborted before either settle wait advances',
        );
      },
      maxSettleProbes: 2,
    });

    assert.equal(settleRounds, 2);
    assert.deepEqual(
      new Set(host.abortCalls),
      new Set(['request-concurrent-first', 'request-concurrent-second']),
    );
    assert.deepEqual(
      new Set(result.terminalizedRootRunIds),
      new Set([first.attemptId, second.attemptId]),
    );
    assert.equal((await f.mission.missions.findById(first.missionId))?.status, 'ready_to_resume');
    assert.equal((await f.mission.missions.findById(second.missionId))?.status, 'ready_to_resume');
  },
);

await check(
  'a partial child terminal write is retryable and cannot strand the subtree',
  async () => {
    const f = fixture(new FailOnceChildAgentRunRepository());
    const { missionId, attemptId } = await createRunningMission(f);
    await f.agentRuns.create(rootRun(attemptId, 'request-partial-child'));
    await f.agentRuns.create(childRun('partial-child', attemptId));
    const host = new FakeMissionHost();
    host.snapshots.set('request-partial-child', { running: true });

    await assert.rejects(() => converge(f, host), /scripted child write failure/);
    assert.equal((await f.agentRuns.findById(attemptId))?.status, 'running');
    assert.equal((await f.agentRuns.findById('partial-child'))?.status, 'running');
    assert.equal((await f.mission.missions.findById(missionId))?.status, 'running');

    await converge(f, host);

    assert.deepEqual(host.abortCalls, ['request-partial-child']);
    assert.equal((await f.agentRuns.findById(attemptId))?.status, 'cancelled');
    assert.equal((await f.agentRuns.findById('partial-child'))?.status, 'cancelled');
    assert.equal((await f.mission.missions.findById(missionId))?.status, 'ready_to_resume');
  },
);

await check(
  'a partially committed interrupted Mission finishes on the next bootstrap',
  async () => {
    const f = fixture();
    const { missionId, attemptId } = await createRunningMission(f);
    await f.agentRuns.create(
      rootRun(attemptId, 'request-already-terminal', {
        status: 'cancelled',
        finished_at: FINISHED_AT,
      }),
    );
    await f.mission.missionAttempts.updateStatus(attemptId, 'interrupted', {
      finishedAt: FINISHED_AT,
    });
    const insertEvent = f.mission.missionEvents.insert.bind(f.mission.missionEvents);
    let failInterruptedEvent = true;
    f.mission.missionEvents.insert = async (row) => {
      if (failInterruptedEvent && row.type === 'mission.interrupted') {
        failInterruptedEvent = false;
        throw new Error('scripted interrupted event write failure');
      }
      await insertEvent(row);
    };
    await assert.rejects(
      () => f.service.toInterrupted(missionId),
      /scripted interrupted event write failure/,
    );
    const host = new FakeMissionHost();

    const result = await converge(f, host);

    assert.deepEqual(host.abortCalls, []);
    assert.deepEqual(result.missionIds, [missionId]);
    assert.equal((await f.mission.missionAttempts.findById(attemptId))?.status, 'interrupted');
    assert.equal((await f.mission.missions.findById(missionId))?.status, 'ready_to_resume');
    const events = await f.mission.missionEvents.listByMission(missionId, {
      limit: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(
      events.filter(
        (event) => event.attempt_id === attemptId && event.type === 'mission.interrupted',
      ).length,
      0,
      'an interrupted retry marker never fabricates an interrupted→interrupted transition',
    );
    assert.equal(
      events.filter(
        (event) => event.attempt_id === attemptId && event.type === 'mission.ready_to_resume',
      ).length,
      1,
    );
  },
);

await check('a ready_to_resume event write failure is durably completed on retry', async () => {
  const f = fixture();
  const { missionId, attemptId } = await createRunningMission(f);
  await f.agentRuns.create(rootRun(attemptId, 'request-partial-ready-event'));
  const host = new FakeMissionHost();
  host.snapshots.set('request-partial-ready-event', { running: true });
  const insertEvent = f.mission.missionEvents.insert.bind(f.mission.missionEvents);
  let remainingReadyEventFailures = 2;
  f.mission.missionEvents.insert = async (row) => {
    if (row.type === 'mission.ready_to_resume' && remainingReadyEventFailures > 0) {
      remainingReadyEventFailures -= 1;
      throw new Error('scripted ready event write failure');
    }
    await insertEvent(row);
  };

  await assert.rejects(() => converge(f, host), /durable recovery closure/);
  assert.equal((await f.mission.missions.findById(missionId))?.status, 'ready_to_resume');
  let events = await f.mission.missionEvents.listByMission(missionId, {
    limit: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(events.filter((event) => event.type === 'mission.ready_to_resume').length, 0);

  const retry = await converge(f, host);

  events = await f.mission.missionEvents.listByMission(missionId, {
    limit: Number.MAX_SAFE_INTEGER,
  });
  assert.deepEqual(retry.missionIds, [missionId]);
  assert.equal(
    events.filter(
      (event) => event.attempt_id === attemptId && event.type === 'mission.ready_to_resume',
    ).length,
    1,
  );
  assert.deepEqual(host.abortCalls, ['request-partial-ready-event']);
});

await check(
  'ready Mission finalization reads one bounded recent event window per bootstrap',
  async () => {
    const f = fixture();
    const { missionId, attemptId } = await createRunningMission(f);
    await f.agentRuns.create(rootRun(attemptId, 'request-bounded-finalizer'));
    for (let index = 0; index < 80; index += 1) {
      await f.mission.missionEvents.insert({
        mission_event_id: `old-event-${index}`,
        mission_id: missionId,
        attempt_id: attemptId,
        type: 'mission.old_event',
        data_json: '{}',
        created_at: `2026-07-13T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
      });
    }
    const listEvents = f.mission.missionEvents.listByMission.bind(f.mission.missionEvents);
    const requestedLimits: Array<number | undefined> = [];
    f.mission.missionEvents.listByMission = async (requestedMissionId, opts) => {
      requestedLimits.push(opts?.limit);
      return listEvents(requestedMissionId, opts);
    };
    const host = new FakeMissionHost();
    host.snapshots.set('request-bounded-finalizer', {
      running: false,
      terminal: { status: 'completed' },
    });

    await converge(f, host);

    assert.deepEqual(requestedLimits, [32]);
    assert.equal((await f.mission.missions.findById(missionId))?.status, 'ready_to_resume');
    assert.equal((await f.mission.missionAttempts.findById(attemptId))?.status, 'interrupted');
  },
);

await check(
  'reload recovery reads the exact current attempt and one latest session link per query',
  async () => {
    const f = fixture();
    const { missionId, attemptId } = await createRunningMission(f);
    await f.agentRuns.create(rootRun(attemptId, 'request-bounded-mission-history'));
    await f.mission.runtimeSessionLinks.insert({
      runtime_session_link_id: 'bounded-history-link',
      mission_id: missionId,
      runtime_id: 'pi',
      runtime_version: 'old',
      opaque_session_ref_json: '{}',
      compatibility_hash: 'compat-current',
      workspace_lease_id: 'lease-old',
      last_safe_boundary: 'boundary-old',
      status: 'active',
    });
    await f.mission.runtimeSessionLinks.insert({
      runtime_session_link_id: 'bounded-latest-link',
      mission_id: missionId,
      runtime_id: 'pi',
      runtime_version: 'current',
      opaque_session_ref_json: '{}',
      compatibility_hash: 'compat-other',
      workspace_lease_id: 'lease-current',
      last_safe_boundary: 'boundary-current',
      status: 'active',
    });

    const findAttempt = f.mission.missionAttempts.findById.bind(f.mission.missionAttempts);
    const attemptLookups: string[] = [];
    f.mission.missionAttempts.findById = async (requestedAttemptId) => {
      attemptLookups.push(requestedAttemptId);
      return findAttempt(requestedAttemptId);
    };
    f.mission.missionAttempts.listByMission = async () => {
      throw new Error('reload recovery must not load full Mission attempt history');
    };
    const findLatestLink = f.mission.runtimeSessionLinks.findLatestByMission.bind(
      f.mission.runtimeSessionLinks,
    );
    const latestLinkLookups: string[] = [];
    f.mission.runtimeSessionLinks.findLatestByMission = async (requestedMissionId) => {
      latestLinkLookups.push(requestedMissionId);
      return findLatestLink(requestedMissionId);
    };
    const host = new FakeMissionHost();
    host.snapshots.set('request-bounded-mission-history', {
      running: false,
      terminal: { status: 'completed' },
    });

    await converge(f, host, 2, undefined, 'compat-current');

    assert.ok(attemptLookups.length > 0);
    assert.ok(attemptLookups.every((id) => id === attemptId));
    assert.ok(latestLinkLookups.length > 0);
    assert.ok(latestLinkLookups.every((id) => id === missionId));
    assert.equal(
      (await f.mission.runtimeSessionLinks.findById('bounded-history-link'))?.status,
      'active',
    );
    assert.equal(
      (await f.mission.runtimeSessionLinks.findById('bounded-latest-link'))?.status,
      'incompatible',
    );
  },
);

await check('a ready Mission with an active session link converges on retry', async () => {
  const f = fixture();
  const { missionId, attemptId } = await createRunningMission(f);
  await f.agentRuns.create(rootRun(attemptId, 'request-partial-link'));
  const link: NewRuntimeSessionLink = {
    runtime_session_link_id: 'partial-runtime-link',
    mission_id: missionId,
    runtime_id: 'pi',
    runtime_version: 'test',
    opaque_session_ref_json: '{}',
    compatibility_hash: 'compat-current',
    workspace_lease_id: 'lease-current',
    last_safe_boundary: 'boundary-current',
    status: 'active',
  };
  await f.mission.runtimeSessionLinks.insert(link);
  const updateLink = f.mission.runtimeSessionLinks.update.bind(f.mission.runtimeSessionLinks);
  let remainingLinkFailures = 2;
  f.mission.runtimeSessionLinks.update = async (linkId, patch) => {
    if (linkId === link.runtime_session_link_id && remainingLinkFailures > 0) {
      remainingLinkFailures -= 1;
      throw new Error('scripted session link write failure');
    }
    await updateLink(linkId, patch);
  };
  const host = new FakeMissionHost();
  host.snapshots.set('request-partial-link', { running: true });

  await assert.rejects(
    () => converge(f, host, 2, undefined, 'compat-current'),
    /durable recovery closure/,
  );
  assert.equal((await f.mission.missions.findById(missionId))?.status, 'ready_to_resume');
  assert.equal(
    (await f.mission.runtimeSessionLinks.findById(link.runtime_session_link_id))?.status,
    'active',
  );

  const retry = await converge(f, host, 2, undefined, 'compat-current');

  assert.deepEqual(retry.missionIds, [missionId]);
  assert.equal(
    (await f.mission.runtimeSessionLinks.findById(link.runtime_session_link_id))?.status,
    'interrupted',
  );
  assert.deepEqual(host.abortCalls, ['request-partial-link']);
});

await check(
  'all active companies settle before a multi-company startup failure surfaces',
  async () => {
    const started: string[] = [];
    const completed: string[] = [];
    let releaseCompanyB!: () => void;
    const companyBGate = new Promise<void>((resolve) => {
      releaseCompanyB = resolve;
    });
    const pending = bootstrapMissionReloadCompanies(
      ['company-A', 'company-B', 'company-A'],
      async (companyId) => {
        started.push(companyId);
        if (companyId === 'company-A') throw new Error('company A recovery failed');
        await companyBGate;
        completed.push(companyId);
        return { missionIds: [companyId], terminalizedRootRunIds: [] };
      },
    );
    let surfaced = false;
    void pending.then(
      () => {
        surfaced = true;
      },
      () => {
        surfaced = true;
      },
    );

    await Promise.resolve();
    assert.deepEqual(started, ['company-A', 'company-B']);
    assert.equal(surfaced, false, 'aggregate waits for every company, including a slow success');
    releaseCompanyB();
    await assert.rejects(pending, /companies: company-A/);
    assert.deepEqual(completed, ['company-B']);
  },
);

await check(
  'slow auto-bootstrap cannot overwrite the latest production company intent',
  async () => {
    const slowCompanyActivation = beginCompanyScopeActivation();
    let activeCompanyId = '';
    const latestCompanyActivation = beginCompanyScopeActivation();
    assert.equal(
      commitCompanyScopeActivation(
        latestCompanyActivation,
        () => true,
        () => {
          activeCompanyId = 'company-B';
        },
      ),
      true,
    );
    assert.equal(
      commitCompanyScopeActivation(
        slowCompanyActivation,
        () => true,
        () => {
          activeCompanyId = 'company-A';
        },
      ),
      false,
      'stale A commit is rejected',
    );
    assert.equal(activeCompanyId, 'company-B', 'the explicit B scope wins');

    const invalidatedActivation = beginCompanyScopeActivation();
    invalidateCompanyScopeActivation();
    activeCompanyId = '';
    assert.equal(
      commitCompanyScopeActivation(
        invalidatedActivation,
        () => activeCompanyId === '',
        () => {
          activeCompanyId = 'company-A';
        },
      ),
      false,
      'a direct scope change invalidates any older activation',
    );
    assert.equal(activeCompanyId, '');
  },
);

await check('dirty surface scope guard resolves cancellation without committing', async () => {
  const previousSurface = useUiState.getState().surface;
  useUiState.setState({ surface: 'personnel' });
  let cancel!: () => void;
  let commits = 0;
  const unregister = registerSurfaceLeaveGuard('personnel', (request) => {
    cancel = request.cancel;
    return false;
  });
  try {
    const pending = guardCurrentSurfaceScopeChange('office', () => {
      commits += 1;
    });
    cancel();
    assert.equal(await pending, false);
    assert.equal(commits, 0);
  } finally {
    unregister();
    useUiState.setState({ surface: previousSurface });
  }
});

await check('delayed dirty-surface proceed rejects a superseded company intent', async () => {
  const previousSurface = useUiState.getState().surface;
  useUiState.setState({ surface: 'personnel' });
  let proceed!: () => void;
  let commits = 0;
  let guardCalls = 0;
  const unregister = registerSurfaceLeaveGuard('personnel', (request) => {
    guardCalls += 1;
    proceed = request.proceed;
    return false;
  });
  try {
    const staleActivation = beginCompanyScopeActivation();
    const pending = guardCurrentSurfaceScopeChange('office', () => {
      commitCompanyScopeActivation(
        staleActivation,
        () => true,
        () => {
          commits += 1;
          useUiState.getState().setSurface('office');
        },
      );
    });
    beginCompanyScopeActivation();
    proceed();
    assert.equal(await pending, true, 'the user did confirm discard');
    assert.equal(commits, 0, 'the superseded company intent cannot commit');

    const currentActivation = beginCompanyScopeActivation();
    const currentPending = guardCurrentSurfaceScopeChange('office', () => {
      commitCompanyScopeActivation(
        currentActivation,
        () => true,
        () => {
          commits += 1;
          useUiState.getState().setSurface('office');
        },
      );
    });
    proceed();
    assert.equal(await currentPending, true);
    assert.equal(commits, 1);
    assert.equal(guardCalls, 2, 'the authorized transition does not re-enter the same guard');
  } finally {
    unregister();
    useUiState.setState({ surface: previousSurface });
  }
});

await check(
  'company scope waits for complete Mission then Conversation live-run recovery',
  async () => {
    const calls: string[] = [];
    let releaseMission!: () => void;
    let releaseConversation!: () => void;
    const missionGate = new Promise<void>((resolve) => {
      releaseMission = resolve;
    });
    const conversationGate = new Promise<void>((resolve) => {
      releaseConversation = resolve;
    });
    let settled = false;
    const pending = bootstrapCompanyScopeRuns(
      'company-A',
      ['company-A', 'company-B'],
      async (companyIds) => {
        calls.push(`missions:${companyIds.join(',')}`);
        await missionGate;
      },
      async (companyId) => {
        calls.push(`conversations:${companyId}`);
        await conversationGate;
        return { complete: true };
      },
    ).then(() => {
      settled = true;
    });

    await Promise.resolve();
    assert.deepEqual(calls, ['missions:company-A,company-B']);
    assert.equal(settled, false);
    releaseMission();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['missions:company-A,company-B', 'conversations:company-A']);
    assert.equal(settled, false);
    releaseConversation();
    await pending;
    assert.equal(settled, true);

    await assert.rejects(
      () =>
        bootstrapCompanyScopeRuns(
          'company-A',
          ['company-A'],
          async () => {},
          async () => ({ complete: false }),
        ),
      /still reconnecting this company's work/,
    );
  },
);

console.log(`\nMission reload harness: ${(h.checks - h.failures)}/${TOTAL} passed`);
if (h.failures > 0 || (h.checks - h.failures) !== TOTAL) process.exitCode = 1;

if (!process.exitCode) h.report();
