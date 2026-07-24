import { autoTitleThreadFromFirstMessage } from '@/data/auto-title.js';
import { persistChatMessage } from '@/data/chat-message-events.js';
import { queryKeys } from '@/data/query-keys.js';
import type { ChatMessage, Employee, StagedAttachment } from '@/data/types.js';
import type { AgentQueueBehavior } from '@/runtime/desktop-agent-runtime.js';
import { resolveThreadModel } from '@/runtime/pi-thread-model-store.js';
import {
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type ComposerAttachmentScope,
  composerAttachmentScopeKey,
  useComposerAttachmentStore,
} from '../composer/composer-attachment-store.js';
import {
  loopReferenceToken,
  resolveLoopReference,
  stripLoopTokens,
  useComposerLoopReferenceStore,
} from '../composer/composer-loop-reference-store.js';
import {
  resolveSkillReferences,
  skillReferenceToken,
  stripSkillTokens,
  useComposerSkillReferenceStore,
} from '../composer/composer-skill-reference-store.js';
import { extractMentionedEmployeeIds, toMentionRoster } from '../composer/composer-triggers.js';
import { assembleAssistantContent } from '../parts/assistant-message-parts.js';
import { conversationRunController } from './conversation-run-controller.js';
import { isConversationRunActive, useConversationRun } from './conversation-run-react.js';
import { ATTACHMENT_ONLY_PROMPT, appendText } from './desktop-chat-runtime.js';
import { buildLoopSendExecution } from './loop-send-execution.js';

const EMPTY_STAGED_ATTACHMENTS: StagedAttachment[] = [];

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}

function mergeMessages(
  seedMessages: readonly ChatMessage[],
  liveMessages: readonly ChatMessage[],
  displayBodyByMessageId: Readonly<Record<string, string>>,
  preferLiveMessages: boolean,
) {
  const byId = new Map<string, ChatMessage>();
  for (const message of seedMessages) byId.set(message.id, message);
  for (const message of liveMessages) {
    if (!preferLiveMessages && byId.has(message.id)) continue;
    const displayBody = displayBodyByMessageId[message.id];
    byId.set(message.id, displayBody ? { ...message, body: displayBody } : message);
  }
  return Array.from(byId.values()).sort((a, b) => messageAt(a) - messageAt(b));
}

function messageAt(message: ChatMessage): number {
  return typeof message.at === 'number' && Number.isFinite(message.at) ? message.at : Date.now();
}

/** Map an Offisim chat message into the assistant-ui thread model. The original
 *  message is carried in metadata.custom so the V3 rail keeps full fidelity;
 *  content parts (reasoning → tools → answer) come from the shared
 *  `assembleAssistantContent` so both chat surfaces stay on one part contract. */
function convertMessage(message: ChatMessage): ThreadMessageLike {
  return {
    role: message.author === 'boss' ? 'user' : 'assistant',
    content: assembleAssistantContent(message),
    id: message.id,
    createdAt: new Date(messageAt(message)),
    metadata: { custom: message as unknown as Record<string, unknown> },
  };
}

/**
 * The Office conversation runtime. assistant-ui owns the composer surface while
 * ConversationRunController owns Pi execution, streaming checkpoints,
 * approval state, retry, and stop semantics for every chat surface.
 */
export function useOfficeRuntime({
  threadId,
  seedMessages,
  assigneeId,
  companyId,
  projectId,
  persistMessage,
  materializeThread,
  employeesById,
}: {
  threadId: string;
  seedMessages: ChatMessage[];
  /** Employee that holds this run (direct thread's employee), shown on the pill. */
  assigneeId?: string | null;
  companyId: string | null;
  projectId: string | null;
  persistMessage?: (message: ChatMessage) => Promise<void>;
  /**
   * Present only for an unsaved draft thread: called with the first message text
   * to create the `chat_threads` row (titled) before that message is persisted.
   */
  materializeThread?: (firstUserText: string) => Promise<void>;
  /** Roster for resolving `@`-mentions to a per-turn routing target. */
  employeesById: Map<string, Employee>;
}) {
  const queryClient = useQueryClient();
  const run = useConversationRun(threadId);
  useEffect(() => {
    if (!run.attemptId || isConversationRunActive(run.phase)) return;
    // The controller keeps only the current Turn in `liveMessages`. Refresh the
    // durable projection as soon as that Turn reaches a terminal phase so the
    // next submit cannot make the previous prompt/answer disappear from view.
    void queryClient.invalidateQueries({ queryKey: queryKeys.messages(threadId) });
  }, [queryClient, run.attemptId, run.phase, threadId]);
  useEffect(() => {
    if (!companyId || !threadId) return;
    void conversationRunController.hydrateFreshSessionAction(companyId, threadId).catch((error) => {
      console.warn('[useOfficeRuntime] Fresh-session hydration failed', {
        companyId,
        threadId,
        error,
      });
    });
  }, [companyId, threadId]);
  const attachmentScope = useMemo<ComposerAttachmentScope>(
    () => ({ companyId, projectId, threadId }),
    [companyId, projectId, threadId],
  );
  const attachmentScopeKey = composerAttachmentScopeKey(attachmentScope);
  const staged = useComposerAttachmentStore(
    (state) => state.stagedByScope[attachmentScopeKey] ?? EMPTY_STAGED_ATTACHMENTS,
  );
  const consumeStaged = useComposerAttachmentStore((state) => state.consumeStaged);
  const pendingDisplayBodies = useRef<
    Array<{ id: string; engineText: string; persistedText: string; messageId?: string }>
  >([]);
  const displayBodies = useRef(new Map<string, string>());
  const [displayBodyByMessageId, setDisplayBodyByMessageId] = useState<Record<string, string>>({});
  const persistWithDisplayBody = useCallback(
    async (message: ChatMessage, displayBody?: string) => {
      const projected = displayBody ? { ...message, body: displayBody } : message;
      if (persistMessage) {
        await persistMessage(projected);
      } else {
        await persistChatMessage({ message: projected, companyId, projectId });
      }
      if (displayBody) {
        displayBodies.current.set(message.id, displayBody);
        setDisplayBodyByMessageId((current) =>
          current[message.id] === displayBody ? current : { ...current, [message.id]: displayBody },
        );
      }
    },
    [companyId, persistMessage, projectId],
  );
  const persistQueuedMessage = useCallback(
    async (message: ChatMessage) => {
      let displayBody = displayBodies.current.get(message.id);
      let pendingDisplay = pendingDisplayBodies.current.find(
        (candidate) => candidate.messageId === message.id,
      );
      if (message.author === 'boss' && !displayBody) {
        pendingDisplay ??= pendingDisplayBodies.current.find(
          (candidate) => !candidate.messageId && candidate.engineText === message.body,
        );
        if (pendingDisplay) {
          pendingDisplay.messageId = message.id;
          displayBody = pendingDisplay.persistedText;
        }
      }
      await persistWithDisplayBody(message, displayBody);
    },
    [persistWithDisplayBody],
  );
  const messages = useMemo(
    () =>
      mergeMessages(
        seedMessages,
        run.liveMessages,
        displayBodyByMessageId,
        isConversationRunActive(run.phase),
      ),
    [displayBodyByMessageId, run.liveMessages, run.phase, seedMessages],
  );
  const sendTurn = useCallback(
    async (rawText: string, behavior?: AgentQueueBehavior): Promise<boolean> => {
      const loopReference = resolveLoopReference(threadId);
      const skillReferences = resolveSkillReferences(threadId);
      // Custom reference-only Send seeds protected tokens to clear assistant-ui's
      // non-empty gate. Rebuild both persisted and engine projections from the
      // structured stores so pasted/seeded tokens can never duplicate.
      const typedText = stripSkillTokens(stripLoopTokens(rawText)).trim();
      const stagedForTurn = staged.filter((attachment) => attachment.status === 'attached');
      if (
        !typedText &&
        !loopReference &&
        skillReferences.length === 0 &&
        stagedForTurn.length === 0
      ) {
        return false;
      }
      if (!companyId) {
        toast.error('Cannot send this message: no active company is bound to this chat.');
        return false;
      }
      if (behavior && loopReference) {
        toast.error('A Loop starts a separate run', {
          description: 'Stop or finish the active run before starting the Loop.',
        });
        return false;
      }

      const tokens = [
        ...(loopReference ? [loopReferenceToken(loopReference)] : []),
        ...skillReferences.map(skillReferenceToken),
      ];
      const baseText = typedText || (stagedForTurn.length > 0 ? ATTACHMENT_ONLY_PROMPT : '');
      const persistedText = [baseText, ...tokens].filter(Boolean).join(' ');
      // This PR preserves the existing plain `/skill <name>` engine behavior. Skill
      // contents are not injected here; the next PR owns that engine seam.
      const skillDirectiveText = skillReferences
        .map((reference) => `/skill ${reference.name}`)
        .join(' ');
      const engineText = [baseText, skillDirectiveText].filter(Boolean).join(' ');
      // Loop execution keeps its existing token-bearing controller input; ordinary
      // Skill turns send token-free legacy text while persistence keeps the chips.
      const controllerText = loopReference ? persistedText : engineText;
      const titleSeed =
        typedText ||
        (loopReference ? loopReference.titleSnapshot : skillDirectiveText || controllerText);

      const stagedIdsForTurn = staged.map((attachment) => attachment.id);
      const pendingDisplay =
        behavior && persistedText !== controllerText
          ? { id: crypto.randomUUID(), engineText: controllerText, persistedText }
          : null;
      if (pendingDisplay) pendingDisplayBodies.current.push(pendingDisplay);
      try {
        const roster = toMentionRoster(employeesById.values());
        const turnEmployeeId =
          extractMentionedEmployeeIds(controllerText, roster)[0] ?? assigneeId ?? null;

        // Build the Loop-backed execution BEFORE submitting so a build failure (no
        // desktop repos) is surfaced and the turn never half-sends. The controller
        // calls `start(messageId)` which materializes invocation + Mission and runs
        // it on THIS Office thread.
        const loopExecution =
          loopReference && !behavior
            ? await buildLoopSendExecution({
                reference: loopReference,
                companyId,
                projectId,
                threadId,
              })
            : undefined;

        if (!behavior) {
          if (materializeThread) {
            await materializeThread(titleSeed);
          } else {
            void autoTitleThreadFromFirstMessage({
              threadId,
              projectId,
              firstUserText: titleSeed,
              queryClient,
            }).catch((err: unknown) => {
              console.warn('[useOfficeRuntime] auto-title failed', { threadId, err });
            });
          }
        }
        let directUserMessageId: string | null = null;
        const persistRunMessage = behavior
          ? persistQueuedMessage
          : async (message: ChatMessage) => {
              if (
                message.author === 'boss' &&
                !message.queueBehavior &&
                (!directUserMessageId || directUserMessageId === message.id)
              ) {
                directUserMessageId = message.id;
                await persistWithDisplayBody(
                  message,
                  persistedText !== controllerText ? persistedText : undefined,
                );
                return;
              }
              await persistQueuedMessage(message);
            };
        const submitInput = {
          companyId,
          projectId,
          threadId,
          employeeId: turnEmployeeId,
          text: controllerText,
          stagedAttachments: stagedForTurn,
          model: resolveThreadModel(threadId),
          source: 'office' as const,
          persistMessage: persistRunMessage,
          onMessagePersisted: () => consumeStaged(attachmentScope, stagedIdsForTurn),
          onThreadTitleUpdated: () => {
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: queryKeys.threads(projectId) }),
              queryClient.invalidateQueries({ queryKey: queryKeys.unfinishedThreads() }),
            ]);
          },
          ...(loopExecution ? { loopExecution } : {}),
        };
        if (behavior) await conversationRunController.enqueue(submitInput, behavior);
        else await conversationRunController.submit(submitInput);
        // Clear the chip only after a successful submit — a failed build/submit keeps
        // the chip so the user can retry without re-inserting the Loop.
        if (loopReference) useComposerLoopReferenceStore.getState().clearReference(threadId);
        if (skillReferences.length) {
          useComposerSkillReferenceStore.getState().clearReferences(threadId);
        }
        return true;
      } catch (error) {
        if (pendingDisplay) {
          pendingDisplayBodies.current = pendingDisplayBodies.current.filter(
            (candidate) => candidate.id !== pendingDisplay.id,
          );
        }
        toast.error(
          loopReference
            ? 'Could not send this Loop run'
            : behavior
              ? 'Could not queue this instruction'
              : 'Agent runtime run failed',
          { description: safeErrorMessage(error) },
        );
        return false;
      }
    },
    [
      assigneeId,
      attachmentScope,
      companyId,
      consumeStaged,
      employeesById,
      materializeThread,
      persistQueuedMessage,
      persistWithDisplayBody,
      projectId,
      queryClient,
      staged,
      threadId,
    ],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      await sendTurn(appendText(message));
    },
    [sendTurn],
  );

  const sendWhileRunning = useCallback(
    (text: string, behavior: AgentQueueBehavior) => sendTurn(text, behavior),
    [sendTurn],
  );

  const onCancel = useCallback(async () => {
    conversationRunController.stop(threadId);
  }, [threadId]);

  const runtime = useExternalStoreRuntime({
    messages,
    onNew,
    convertMessage,
    isRunning: isConversationRunActive(run.phase),
    onCancel,
  });
  return { runtime, sendWhileRunning, messages };
}
