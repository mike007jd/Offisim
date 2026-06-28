import { buildLoopService } from '@/data/loops.js';
import { persistChatMessage } from '@/data/chat-message-events.js';
import type { ChatMessage } from '@/data/types.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { getRepos } from '@/runtime/repos.js';
import { createMissionService, generateId } from '@offisim/core/browser';
import type { ComposerLoopReference } from '../composer/composer-loop-reference-store.js';
import {
  type LoopMissionCreator,
  type MaterializeLoopSendDeps,
  materializeLoopSend,
} from './loop-office-invocation.js';

/**
 * Renderer wiring for a Loop-backed Office Send (PR-10). Builds the live
 * {@link MaterializeLoopSendDeps} (real SQLite repos + real LoopService + a mission
 * creator that REUSES the Office thread) and returns the `start(messageId)`
 * callback the ConversationRunController invokes for a Loop turn:
 *
 *   start(messageId) → materializeLoopSend (invocation → mission → link, with
 *   no-orphan compensation) → missionRunManager.start (the live Mission run on the
 *   SAME Office thread, whose status surfaces in Office/Activity).
 *
 * The materializer throws on a blocked revision; the controller catches that and
 * fails the turn BEFORE persisting the user message, so a deleted/not-ready Loop
 * never sends a half message.
 */
export async function buildLoopSendExecution(input: {
  reference: ComposerLoopReference;
  companyId: string;
  projectId: string | null;
  threadId: string;
}): Promise<{ start: (messageId: string) => Promise<void> }> {
  const repos = await getRepos();
  const loopService = buildLoopService(repos);

  if (!repos.loopInvocations) {
    throw new Error('Loop invocation storage is unavailable in this runtime.');
  }
  const loopInvocations = repos.loopInvocations;

  // The mission creator mirrors the manual create path (createMission + markReady)
  // but threads the Office thread in, so the Mission has NO dedicated chat thread.
  const missionService = createMissionService(
    {
      missions: requireRepo(repos, 'missions'),
      missionCriteria: requireRepo(repos, 'missionCriteria'),
      missionAttempts: requireRepo(repos, 'missionAttempts'),
      missionEvaluations: requireRepo(repos, 'missionEvaluations'),
      missionEvents: requireRepo(repos, 'missionEvents'),
    },
    { now: () => new Date().toISOString(), newId: () => generateId('mission') },
  );
  const missionCreator: LoopMissionCreator = {
    async createReadyMission(createInput) {
      const mission = await missionService.createMission(createInput);
      await missionService.markReady(mission.mission_id);
      return { missionId: mission.mission_id };
    },
  };

  const deps: MaterializeLoopSendDeps = {
    loopService,
    loopInvocations,
    missionCreator,
    // Compensation = hard delete of the just-inserted orphan invocation.
    compensateInvocation: (invocationId) => loopInvocations.deleteById(invocationId),
    newId: () => generateId('loopinv'),
    now: () => new Date().toISOString(),
  };

  return {
    start: async (messageId: string) => {
      const result = await materializeLoopSend(deps, {
        reference: { loopId: input.reference.loopId, revisionId: input.reference.revisionId },
        companyId: input.companyId,
        projectId: input.projectId,
        threadId: input.threadId,
        messageId,
      });
      // Kick off the live Mission run on the SAME Office thread. The run is fired
      // AFTER the durable transaction commits, so a run-start hiccup never orphans
      // the records (the mission is created+ready and can be re-run). A double-start
      // throws inside the manager; swallow it so a stray retry never breaks send.
      try {
        await missionRunManager.start(result.missionId, input.companyId);
      } catch (error) {
        console.warn('[loop-send] mission run failed to start (records persisted)', {
          missionId: result.missionId,
          error,
        });
      }
    },
  };
}

export async function startLoopAsParallelProjectRun(input: {
  loopId: string;
  revisionId: string;
  title: string;
  companyId: string;
  projectId: string;
}): Promise<{ missionId: string; threadId: string }> {
  const repos = await getRepos();
  if (!repos.loopInvocations) {
    throw new Error('Loop invocation storage is unavailable in this runtime.');
  }

  const threadId = generateId('thread');
  const messageId = generateId('msg');
  const title = input.title.trim() || 'Loop run';
  const prompt = `Start Loop: ${title}`;

  await repos.chatThreads.create({
    thread_id: threadId,
    project_id: input.projectId,
    employee_id: null,
    title,
  });

  const message: ChatMessage = {
    id: messageId,
    threadId,
    author: 'boss',
    employeeId: null,
    body: prompt,
    at: Date.now(),
    status: 'complete',
  };
  await persistChatMessage({
    message,
    companyId: input.companyId,
    projectId: input.projectId,
  });

  const loopService = buildLoopService(repos);
  const missionService = createMissionService(
    {
      missions: requireRepo(repos, 'missions'),
      missionCriteria: requireRepo(repos, 'missionCriteria'),
      missionAttempts: requireRepo(repos, 'missionAttempts'),
      missionEvaluations: requireRepo(repos, 'missionEvaluations'),
      missionEvents: requireRepo(repos, 'missionEvents'),
    },
    { now: () => new Date().toISOString(), newId: () => generateId('mission') },
  );
  const missionCreator: LoopMissionCreator = {
    async createReadyMission(createInput) {
      const mission = await missionService.createMission(createInput);
      await missionService.markReady(mission.mission_id);
      return { missionId: mission.mission_id };
    },
  };

  const loopInvocations = repos.loopInvocations;
  const result = await materializeLoopSend(
    {
      loopService,
      loopInvocations,
      missionCreator,
      compensateInvocation: (invocationId) => loopInvocations.deleteById(invocationId),
      newId: () => generateId('loopinv'),
      now: () => new Date().toISOString(),
    },
    {
      reference: { loopId: input.loopId, revisionId: input.revisionId },
      companyId: input.companyId,
      projectId: input.projectId,
      threadId,
      messageId,
    },
  );

  await missionRunManager.start(result.missionId, input.companyId);
  return { missionId: result.missionId, threadId };
}

function requireRepo<K extends keyof Awaited<ReturnType<typeof getRepos>>>(
  repos: Awaited<ReturnType<typeof getRepos>>,
  key: K,
): NonNullable<Awaited<ReturnType<typeof getRepos>>[K]> {
  const repo = repos[key];
  if (!repo) throw new Error(`Repository "${String(key)}" is unavailable in this runtime.`);
  return repo as NonNullable<Awaited<ReturnType<typeof getRepos>>[K]>;
}
