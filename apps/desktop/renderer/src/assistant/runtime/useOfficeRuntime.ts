import { autoTitleThreadFromFirstMessage } from '@/data/auto-title.js';
import { persistChatMessage } from '@/data/chat-message-events.js';
import type { ChatAttachment, ChatMessage, ChatToolCall, Employee } from '@/data/types.js';
import { resolveThreadModel } from '@/runtime/pi-thread-model-store.js';
import {
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { extractMentionedEmployeeIds, toMentionRoster } from '../composer/composer-triggers.js';
import { assembleAssistantContent } from '../parts/assistant-message-parts.js';
import { useRunStore } from '../run-store.js';
import {
  appendText,
  buildRunError,
  displayAttachmentsFromStaged,
  materializeChatTurn,
  newDraftId,
  subscribePermissionRequests,
  subscribeReplyStream,
  subscribeRunActivity,
  subscribeToolCalls,
  upsertChatToolCall,
} from './desktop-chat-runtime.js';

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
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
    createdAt: new Date(message.at),
    metadata: { custom: message as unknown as Record<string, unknown> },
  };
}

/**
 * The Office conversation runtime. assistant-ui owns the thread/composer state
 * over Offisim's external message store. Desktop sends go through the Pi Agent
 * host; credentials, model registry, session state, and tool loop stay inside Pi.
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
  const [drafts, setDrafts] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortedRef = useRef(false);
  const messages = useMemo(() => [...seedMessages, ...drafts], [seedMessages, drafts]);

  // Only honor the shared store's running flag when it is bound to *this*
  // thread. The store is process-global (it also drives the diegetic stage and
  // pipeline pill), so reading its `isRunning` unscoped would let a run on
  // another thread leak into this runtime's composer state. `isSending` below
  // is this runtime's own in-flight signal; the store read covers the case of
  // opening a thread that was already persisted mid-run.
  const storeRunningHere = useRunStore((s) => s.threadId === threadId && s.isRunning);
  const startRun = useRunStore((s) => s.start);
  const finishRun = useRunStore((s) => s.finish);
  const stop = useRunStore((s) => s.stop);
  const setStopHandler = useRunStore((s) => s.setStopHandler);
  const setRunError = useRunStore((s) => s.setError);
  const staged = useRunStore((s) => s.staged);
  const clearStaged = useRunStore((s) => s.clearStaged);
  const noteToolCalled = useRunStore((s) => s.noteToolCalled);
  const noteToolResult = useRunStore((s) => s.noteToolResult);
  const queryClient = useQueryClient();
  const persistRuntimeMessage = useCallback(
    (message: ChatMessage) =>
      persistMessage
        ? persistMessage(message)
        : persistChatMessage({ message, companyId, projectId }),
    [companyId, persistMessage, projectId],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = appendText(message);
      if (!text) return;
      // A leading/inline `@teammate` routes this turn to that employee, overriding
      // the thread's default assignee. The `@Name` text stays in the prompt so the
      // intent survives even if the host treats routing as a soft hint.
      const roster = toMentionRoster(employeesById.values());
      const turnEmployeeId = extractMentionedEmployeeIds(text, roster)[0] ?? assigneeId ?? null;
      const stagedForTurn = staged.filter((a) => a.status === 'attached');
      const attachments: ChatAttachment[] = displayAttachmentsFromStaged(stagedForTurn);
      const userMessageId = newDraftId('boss');
      setDrafts((prev) => [
        ...prev,
        {
          id: userMessageId,
          threadId,
          author: 'boss',
          employeeId: null,
          body: text,
          at: Date.now(),
          attachments: attachments.length ? attachments : undefined,
        },
      ]);
      clearStaged();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      abortedRef.current = false;
      setIsSending(true);
      startRun(undefined, turnEmployeeId);
      try {
        const materialized = await materializeChatTurn({
          text,
          companyId,
          threadId,
          staged: stagedForTurn,
        });
        const userMessage: ChatMessage = {
          id: userMessageId,
          threadId,
          author: 'boss',
          employeeId: null,
          body: text,
          at: Date.now(),
          attachments: materialized.attachments.length ? materialized.attachments : undefined,
        };
        setDrafts((prev) =>
          prev.map((draft) => (draft.id === userMessageId ? userMessage : draft)),
        );
        // Deferred conversation creation: a draft thread has no DB row yet.
        // Materialize it (titled from this first message) BEFORE persisting the
        // message, so the row exists for the message's thread reference and the
        // conversation lands in the sidebar already titled — never as an empty
        // "New conversation". Must await: the persist below depends on the row.
        if (materializeThread) {
          await materializeThread(text);
        }
        await persistRuntimeMessage(userMessage);
        // For an existing thread still on the default title (e.g. a legacy
        // empty row), derive one from this first message. A freshly materialized
        // draft is already titled, so skip the redundant read. Fire-and-forget:
        // never gate the reply on it; it self-skips an already-titled thread.
        if (!materializeThread) {
          void autoTitleThreadFromFirstMessage({
            threadId,
            projectId,
            firstUserText: text,
            queryClient,
          }).catch((err: unknown) => {
            console.warn('[useOfficeRuntime] auto-title failed', { threadId, err });
          });
        }
        // The chat always runs through Pi Agent. Offisim owns the UI/thread
        // store; Pi owns model auth, model selection, session state, tools,
        // retries, and compaction.
        if (!companyId) {
          throw new Error('Cannot send this message: no active company is bound to this chat.');
        }
        const { getDesktopAgentRuntime } = await import('@/runtime/desktop-agent-runtime.js');
        const { runtimeEventBus } = await import('@/runtime/repos.js');
        const runtime = await getDesktopAgentRuntime(companyId);

        // Stream Pi Agent text into a single assistant draft. The authoritative
        // final response still overwrites that draft afterward, so there is
        // never a duplicate final message.
        const streamDraftId = newDraftId('assistant');
        const appendChunk = (chunk: string) =>
          setDrafts((prev) => {
            const existing = prev.find((draft) => draft.id === streamDraftId);
            if (!existing) {
              return [
                ...prev,
                {
                  id: streamDraftId,
                  threadId,
                  author: 'employee',
                  employeeId: turnEmployeeId,
                  body: chunk,
                  at: Date.now(),
                },
              ];
            }
            return prev.map((draft) =>
              draft.id === streamDraftId ? { ...draft, body: draft.body + chunk } : draft,
            );
          });
        const appendReasoningChunk = (chunk: string) => {
          if (!chunk) return;
          setDrafts((prev) => {
            const existing = prev.find((draft) => draft.id === streamDraftId);
            if (!existing) {
              return [
                ...prev,
                {
                  id: streamDraftId,
                  threadId,
                  author: 'employee',
                  employeeId: turnEmployeeId,
                  body: '',
                  reasoning: chunk,
                  at: Date.now(),
                },
              ];
            }
            return prev.map((draft) =>
              draft.id === streamDraftId
                ? { ...draft, reasoning: `${draft.reasoning ?? ''}${chunk}` }
                : draft,
            );
          });
        };
        // Accumulate tool steps into the same draft so they render inline as
        // native assistant-ui `tool-call` parts (a working agent visibly runs
        // its tools inside the reply, not only in the composer strip).
        const toolCalls: ChatToolCall[] = [];
        const upsertToolCall = (call: ChatToolCall) => {
          const snapshot = upsertChatToolCall(toolCalls, call);
          setDrafts((prev) => {
            const existing = prev.find((draft) => draft.id === streamDraftId);
            if (!existing) {
              return [
                ...prev,
                {
                  id: streamDraftId,
                  threadId,
                  author: 'employee',
                  employeeId: turnEmployeeId,
                  body: '',
                  toolCalls: snapshot,
                  at: Date.now(),
                },
              ];
            }
            return prev.map((draft) =>
              draft.id === streamDraftId ? { ...draft, toolCalls: snapshot } : draft,
            );
          });
        };
        let reasoningText = '';
        const unsubscribe = subscribeReplyStream(
          runtimeEventBus,
          threadId,
          appendChunk,
          (chunk) => {
            reasoningText += chunk;
            appendReasoningChunk(chunk);
          },
        );
        // Surface tool calls live (builtin + MCP) so a long run shows the agent
        // working instead of a blank streaming bubble.
        const unsubscribeActivity = subscribeRunActivity(runtimeEventBus, {
          threadId,
          onCalled: noteToolCalled,
          onResult: noteToolResult,
        });
        const unsubscribeToolCalls = subscribeToolCalls(runtimeEventBus, threadId, upsertToolCall);
        // Surface a paused destructive tool (Ask mode) into the run store so the
        // PermissionApprovalBar can render Approve/Reject for this thread's run.
        const unsubscribePermission = subscribePermissionRequests(runtimeEventBus, {
          threadId,
          onRequest: ({ requestId, toolCallId, toolName, command, reason }) => {
            useRunStore
              .getState()
              .setPendingApproval({ requestId, toolCallId, toolName, command, reason });
          },
        });
        let response: Awaited<ReturnType<typeof runtime.execute>>;
        try {
          response = await runtime.execute({
            text: materialized.promptText,
            threadId,
            employeeId: turnEmployeeId,
            projectId,
            model: resolveThreadModel(threadId),
          });
        } finally {
          // InMemoryEventBus has no auto-cleanup — always release these handlers.
          unsubscribe();
          unsubscribeActivity();
          unsubscribeToolCalls();
          unsubscribePermission();
        }
        // A late-resolving Stop: keep whatever already streamed into the draft
        // (do not overwrite with the authoritative response, do not persist).
        if (abortedRef.current) return;
        const reasoning = (response.reasoning || reasoningText).trim();
        const assistantMessage: ChatMessage = {
          id: streamDraftId,
          threadId,
          author: 'employee',
          employeeId: turnEmployeeId,
          body: response.text,
          ...(reasoning ? { reasoning } : {}),
          ...(toolCalls.length ? { toolCalls: [...toolCalls] } : {}),
          at: Date.now(),
        };
        // Replace the streamed draft with the authoritative final reply (or
        // create it when the reply did not stream, e.g. a short-circuited node).
        setDrafts((prev) =>
          prev.some((draft) => draft.id === streamDraftId)
            ? prev.map((draft) => (draft.id === streamDraftId ? assistantMessage : draft))
            : [...prev, assistantMessage],
        );
        await persistRuntimeMessage(assistantMessage);
      } catch (error) {
        // A deliberate Stop aborts the in-flight request, which rejects here.
        // That is a cancel, not a failure — skip the error toast/bubble.
        if (!abortedRef.current) {
          const messageText = safeErrorMessage(error);
          toast.error('Pi Agent run failed', { description: messageText });
          // Route the real failure into shared run state so the in-thread
          // ChatErrorBanner becomes reachable (not just the toast/bubble).
          // The `retry` closure rides on the error so the banner can offer
          // Retry: this onNew instance captured the failed turn's text and
          // staged attachments, so the whole turn is re-sent as a new attempt.
          setRunError({
            ...buildRunError(messageText),
            retry: () => {
              useRunStore.getState().dismissError();
              void onNew(message);
            },
          });
          const systemMessage: ChatMessage = {
            id: newDraftId('pi-agent-error'),
            threadId,
            author: 'system',
            employeeId: null,
            body: `Run failed before completion: ${messageText}\n\nOpen Activity Log for the tool command and raw error details.`,
            at: Date.now(),
          };
          setDrafts((prev) => [...prev, systemMessage]);
          try {
            await persistRuntimeMessage(systemMessage);
          } catch (persistError) {
            console.warn('[useOfficeRuntime] failed to persist run failure message', {
              threadId,
              persistError,
            });
          }
        }
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setIsSending(false);
        // An aborted run is stopped (not "done"); only a settled request completes.
        if (abortedRef.current) {
          stop();
        } else {
          finishRun();
        }
      }
    },
    [
      threadId,
      assigneeId,
      companyId,
      projectId,
      staged,
      clearStaged,
      startRun,
      finishRun,
      stop,
      setRunError,
      persistRuntimeMessage,
      noteToolCalled,
      noteToolResult,
      queryClient,
      materializeThread,
      employeesById,
    ],
  );

  // Shared by the diegetic Stop, the composer Stop, and unmount cleanup so a
  // thread switch never leaves the Pi host running after the UI has moved on.
  const abortInFlight = useCallback(async () => {
    abortedRef.current = true;
    abortControllerRef.current?.abort();
    if (companyId) {
      void import('@/runtime/desktop-agent-runtime.js')
        .then(({ getDesktopAgentRuntime }) => getDesktopAgentRuntime(companyId))
        .then((runtime) => runtime.abort(threadId))
        .catch((err: unknown) => {
          console.warn('[useOfficeRuntime] agent runtime abort failed', { threadId, err });
        });
    }
    stop();
  }, [stop, companyId, threadId]);

  // Register the real Pi abort as the store's stop handler while mounted,
  // so the out-of-tree diegetic Stop pill cancels exactly like the composer Stop.
  useEffect(() => {
    setStopHandler(abortInFlight);
    return () => setStopHandler(null);
  }, [abortInFlight, setStopHandler]);

  // The retry closure re-dispatches into this runtime's send pipeline, so it
  // must not outlive the mount (a sibling thread would re-send into the wrong
  // thread). Strip it from the surfaced error on unmount; the banner itself
  // stays, just dismiss-only — same as a seeded historical error.
  useEffect(
    () => () => {
      const store = useRunStore.getState();
      if (store.error?.retry) store.setError({ ...store.error, retry: undefined });
    },
    [],
  );

  useEffect(() => {
    return () => {
      abortInFlight();
    };
  }, [abortInFlight]);

  return useExternalStoreRuntime({
    messages,
    onNew,
    convertMessage,
    isRunning: storeRunningHere || isSending,
    onCancel: abortInFlight,
  });
}
