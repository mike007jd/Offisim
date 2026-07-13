import { autoTitleThreadFromFirstMessage } from '@/data/auto-title.js';
import type { ChatMessage, Employee, StagedAttachment } from '@/data/types.js';
import { resolveThreadModel } from '@/runtime/pi-thread-model-store.js';
import {
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
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
import { extractMentionedEmployeeIds, toMentionRoster } from '../composer/composer-triggers.js';
import { assembleAssistantContent } from '../parts/assistant-message-parts.js';
import { conversationRunController } from './conversation-run-controller.js';
import { isConversationRunActive, useConversationRun } from './conversation-run-react.js';
import { appendText } from './desktop-chat-runtime.js';
import { buildLoopSendExecution } from './loop-send-execution.js';

const EMPTY_STAGED_ATTACHMENTS: StagedAttachment[] = [];

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}

function mergeMessages(seedMessages: readonly ChatMessage[], liveMessages: readonly ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  for (const message of seedMessages) byId.set(message.id, message);
  for (const message of liveMessages) byId.set(message.id, message);
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
  const attachmentScope = useMemo<ComposerAttachmentScope>(
    () => ({ companyId, projectId, threadId }),
    [companyId, projectId, threadId],
  );
  const attachmentScopeKey = composerAttachmentScopeKey(attachmentScope);
  const staged = useComposerAttachmentStore(
    (state) => state.stagedByScope[attachmentScopeKey] ?? EMPTY_STAGED_ATTACHMENTS,
  );
  const consumeStaged = useComposerAttachmentStore((state) => state.consumeStaged);
  const messages = useMemo(
    () => mergeMessages(seedMessages, run.liveMessages),
    [seedMessages, run.liveMessages],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const loopReference = resolveLoopReference(threadId);
      // Strip any loop token already present in the composed text (the custom Send
      // affordance seeds the token to satisfy assistant-ui's non-empty gate), so the
      // body is never doubled — the token is re-appended once below.
      const typedText = stripLoopTokens(appendText(message)).trim();
      // PR-10: a Loop chip alone is a valid send (the Loop IS the instruction), so a
      // turn is allowed when there is typed text OR a Loop reference on this thread.
      if (!typedText && !loopReference) return;
      if (!companyId) {
        toast.error('Cannot send this message: no active company is bound to this chat.');
        return;
      }

      // The persisted/displayed body carries the [[loop:<id>]] token after the typed
      // text so the transcript renders the chip and the Enhance protected-span
      // pipeline (PR-06) already guards it. The title still derives from typed text.
      const token = loopReference ? loopReferenceToken(loopReference) : '';
      const text = loopReference ? (typedText ? `${typedText} ${token}` : token) : typedText;
      const titleSeed = typedText || (loopReference ? loopReference.titleSnapshot : text);

      const stagedForTurn = staged.filter((attachment) => attachment.status === 'attached');
      const stagedIdsForTurn = staged.map((attachment) => attachment.id);
      try {
        const roster = toMentionRoster(employeesById.values());
        const turnEmployeeId = extractMentionedEmployeeIds(text, roster)[0] ?? assigneeId ?? null;

        // Build the Loop-backed execution BEFORE submitting so a build failure (no
        // desktop repos) is surfaced and the turn never half-sends. The controller
        // calls `start(messageId)` which materializes invocation + Mission and runs
        // it on THIS Office thread.
        const loopExecution = loopReference
          ? await buildLoopSendExecution({
              reference: loopReference,
              companyId,
              projectId,
              threadId,
            })
          : undefined;

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
        await conversationRunController.submit({
          companyId,
          projectId,
          threadId,
          employeeId: turnEmployeeId,
          text,
          stagedAttachments: stagedForTurn,
          model: resolveThreadModel(threadId),
          source: 'office',
          persistMessage,
          onMessagePersisted: () => consumeStaged(attachmentScope, stagedIdsForTurn),
          ...(loopExecution ? { loopExecution } : {}),
        });
        // Clear the chip only after a successful submit — a failed build/submit keeps
        // the chip so the user can retry without re-inserting the Loop.
        if (loopReference) useComposerLoopReferenceStore.getState().clearReference(threadId);
      } catch (error) {
        toast.error(loopReference ? 'Could not send this Loop run' : 'Agent runtime run failed', {
          description: safeErrorMessage(error),
        });
      }
    },
    [
      assigneeId,
      attachmentScope,
      companyId,
      consumeStaged,
      employeesById,
      materializeThread,
      persistMessage,
      projectId,
      queryClient,
      staged,
      threadId,
    ],
  );

  const onCancel = useCallback(async () => {
    conversationRunController.stop(threadId);
  }, [threadId]);

  return useExternalStoreRuntime({
    messages,
    onNew,
    convertMessage,
    isRunning: isConversationRunActive(run.phase),
    onCancel,
  });
}
