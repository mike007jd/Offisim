import { loadPersistedChatMessages, persistChatMessage } from '@/data/chat-message-events.js';
import {
  deleteConversationDeep,
  deleteMaterializedLoopSend,
  deleteMissionDeep,
} from '@/data/local-data-deletion.js';
import { buildLoopService } from '@/data/loops.js';
import type { ChatMessage } from '@/data/types.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { getRepos } from '@/runtime/repos.js';
import { createMissionService, generateId } from '@offisim/core/browser';
import type { ComposerLoopReference } from '../composer/composer-loop-reference-store.js';
import {
  AggregateLoopSendError,
  type LoopMissionCreator,
  type MaterializeLoopSendDeps,
  buildLoopPacketForSend,
  materializeLoopSend,
  runCompensatedLoopThread,
} from './loop-office-invocation.js';

function readyMissionCreator(
  missionService: ReturnType<typeof createMissionService>,
): LoopMissionCreator {
  return {
    async createReadyMission(createInput) {
      const mission = await missionService.createMission(createInput);
      try {
        await missionService.markReady(mission.mission_id);
      } catch (error) {
        try {
          await deleteMissionDeep(mission.mission_id);
        } catch (compensationError) {
          throw new AggregateLoopSendError(error, [
            { target: 'mission', error: compensationError },
          ]);
        }
        throw error;
      }
      return { missionId: mission.mission_id };
    },
  };
}

/**
 * Renderer wiring for a Loop-backed Office Send (PR-10). Builds the live
 * {@link MaterializeLoopSendDeps} (real SQLite repos + real LoopService + a mission
 * creator that REUSES the Office thread) and returns the two-phase hand-off the
 * ConversationRunController invokes for a Loop turn:
 *
 *   materialize(messageId) → durable invocation + ready Mission → caller persists
 *   the user message → prepared.start() launches the live Mission.
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
}): Promise<
  NonNullable<import('./conversation-run-controller.js').SubmitConversationRun['loopExecution']>
> {
  const repos = await getRepos();
  const loopService = buildLoopService(repos);

  const loopInvocations = repos.loopInvocations;

  // The mission creator mirrors the manual create path (createMission + markReady)
  // but threads the Office thread in, so the Mission has NO dedicated chat thread.
  const missionService = createMissionService(
    {
      missions: repos.missions,
      missionCriteria: repos.missionCriteria,
      missionAttempts: repos.missionAttempts,
      missionEvaluations: repos.missionEvaluations,
      missionEvents: repos.missionEvents,
    },
    { now: () => new Date().toISOString(), newId: () => generateId('mission') },
  );
  const missionCreator = readyMissionCreator(missionService);

  const deps: MaterializeLoopSendDeps = {
    loopService,
    loopInvocations,
    missionCreator,
    // Compensation = hard delete of the just-inserted orphan invocation.
    compensateInvocation: (invocationId) => loopInvocations.deleteById(invocationId),
    compensateMission: deleteMissionDeep,
    newId: () => generateId('loopinv'),
    now: () => new Date().toISOString(),
  };

  return {
    materialize: async (messageId: string) => {
      const result = await materializeLoopSend(deps, {
        reference: { loopId: input.reference.loopId, revisionId: input.reference.revisionId },
        companyId: input.companyId,
        projectId: input.projectId,
        threadId: input.threadId,
        messageId,
      });
      return {
        start: () => missionRunManager.start(result.missionId, input.companyId),
        compensate: () => deleteMaterializedLoopSend(result.invocationId, result.missionId),
      };
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
  const loopService = buildLoopService(repos);
  const missionService = createMissionService(
    {
      missions: repos.missions,
      missionCriteria: repos.missionCriteria,
      missionAttempts: repos.missionAttempts,
      missionEvaluations: repos.missionEvaluations,
      missionEvents: repos.missionEvents,
    },
    { now: () => new Date().toISOString(), newId: () => generateId('mission') },
  );
  const missionCreator = readyMissionCreator(missionService);
  const loopInvocations = repos.loopInvocations;
  const reference = { loopId: input.loopId, revisionId: input.revisionId };
  const threadId = generateId('thread');
  const messageId = generateId('msg');
  const title = input.title.trim() || 'Loop run';
  const message: ChatMessage = {
    id: messageId,
    threadId,
    author: 'boss',
    employeeId: null,
    body: `Start Loop: ${title}`,
    at: Date.now(),
    status: 'complete',
  };

  return runCompensatedLoopThread({
    // Fresh, read-only gate before chatThreads.create. materializeLoopSend repeats
    // the gate at the durable link boundary so a concurrent revision change also
    // blocks rather than executing a stale packet.
    preflight: async () => {
      await buildLoopPacketForSend({ loopService }, reference);
    },
    createThread: async () => {
      await repos.chatThreads.create({
        thread_id: threadId,
        project_id: input.projectId,
        employee_id: null,
        title,
      });
    },
    persistMessage: async () => {
      await persistChatMessage({
        message,
        companyId: input.companyId,
        projectId: input.projectId,
      });
      const persisted = await loadPersistedChatMessages(threadId);
      if (!persisted.some((candidate) => candidate.id === messageId)) {
        throw new Error('Loop run message did not persist.');
      }
    },
    materializeAndStart: async () => {
      const result = await materializeLoopSend(
        {
          loopService,
          loopInvocations,
          missionCreator,
          compensateInvocation: (invocationId) => loopInvocations.deleteById(invocationId),
          compensateMission: deleteMissionDeep,
          newId: () => generateId('loopinv'),
          now: () => new Date().toISOString(),
        },
        {
          reference,
          companyId: input.companyId,
          projectId: input.projectId,
          threadId,
          messageId,
        },
      );
      await missionRunManager.start(result.missionId, input.companyId);
      return { missionId: result.missionId, threadId };
    },
    compensateThread: () => deleteConversationDeep(threadId, input.companyId, input.projectId),
  });
}
