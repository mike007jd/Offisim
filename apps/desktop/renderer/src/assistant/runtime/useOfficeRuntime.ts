import { autoTitleThreadFromFirstMessage } from '@/data/auto-title.js';
import type { ChatMessage, Employee } from '@/data/types.js';
import { resolveThreadModel } from '@/runtime/pi-thread-model-store.js';
import {
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useComposerAttachmentStore } from '../composer/composer-attachment-store.js';
import { extractMentionedEmployeeIds, toMentionRoster } from '../composer/composer-triggers.js';
import { assembleAssistantContent } from '../parts/assistant-message-parts.js';
import { conversationRunController } from './conversation-run-controller.js';
import { isConversationRunActive, useConversationRun } from './conversation-run-react.js';
import { appendText } from './desktop-chat-runtime.js';

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
  const staged = useComposerAttachmentStore((s) => s.staged);
  const clearStaged = useComposerAttachmentStore((s) => s.clearStaged);
  const messages = useMemo(
    () => mergeMessages(seedMessages, run.liveMessages),
    [seedMessages, run.liveMessages],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = appendText(message);
      if (!text) return;
      if (!companyId) {
        toast.error('Cannot send this message: no active company is bound to this chat.');
        return;
      }

      const stagedForTurn = staged.filter((attachment) => attachment.status === 'attached');
      clearStaged();
      try {
        const roster = toMentionRoster(employeesById.values());
        const turnEmployeeId = extractMentionedEmployeeIds(text, roster)[0] ?? assigneeId ?? null;
        if (materializeThread) {
          await materializeThread(text);
        } else {
          void autoTitleThreadFromFirstMessage({
            threadId,
            projectId,
            firstUserText: text,
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
        });
      } catch (error) {
        toast.error('Pi Agent run failed', { description: safeErrorMessage(error) });
      }
    },
    [
      assigneeId,
      clearStaged,
      companyId,
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
