import { persistChatMessage } from '@/data/chat-message-events.js';
import type { ChatAttachment, ChatMessage } from '@/data/types.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import {
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRunStore } from '../run-store.js';
import {
  appendText,
  buildRunError,
  displayAttachmentsFromStaged,
  materializeChatTurn,
  newDraftId,
  subscribeReplyStream,
  subscribeRunActivity,
} from './desktop-chat-runtime.js';

/** Map an Offisim chat message into the assistant-ui thread model. The original
 *  message is carried in metadata.custom so the V3 rail keeps full fidelity. */
function convertMessage(message: ChatMessage): ThreadMessageLike {
  return {
    role: message.author === 'boss' ? 'user' : 'assistant',
    content: [{ type: 'text', text: message.body }],
    id: message.id,
    createdAt: new Date(message.at),
    metadata: { custom: message as unknown as Record<string, unknown> },
  };
}

/**
 * The Office conversation runtime. assistant-ui owns the thread/composer state
 * over Offisim's external message store. Desktop sends go through the Tauri
 * provider bridge so credentials stay outside the webview.
 */
export function useOfficeRuntime({
  threadId,
  seedMessages,
  assigneeId,
  companyId,
  projectId,
  persistMessage,
}: {
  threadId: string;
  seedMessages: ChatMessage[];
  /** Employee that holds this run (direct thread's employee), shown on the pill. */
  assigneeId?: string | null;
  companyId: string | null;
  projectId: string | null;
  persistMessage?: (message: ChatMessage) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const requestIdRef = useRef<string | null>(null);
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
      const requestId = newDraftId('provider');
      const abortController = new AbortController();
      requestIdRef.current = requestId;
      abortControllerRef.current = abortController;
      abortedRef.current = false;
      setIsSending(true);
      startRun(undefined, assigneeId ?? null);
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
        await persistRuntimeMessage(userMessage);
        // The chat always runs through the real LangGraph agent runtime; the
        // single-shot direct-provider path was retired with the flag in slice 3.
        // A chat without an active company cannot assemble a runtime — fail
        // honestly rather than silently degrade onto a removed path.
        if (!companyId) {
          throw new Error('Cannot send this message: no active company is bound to this chat.');
        }
        const { getDesktopAgentRuntime } = await import('@/runtime/desktop-agent-runtime.js');
        const { runtimeEventBus } = await import('@/runtime/repos.js');
        const runtime = await getDesktopAgentRuntime(companyId);

        // Stream the employee's reply into a single assistant draft so the bubble
        // fills chunk-by-chunk instead of popping in whole. The graph emits
        // `llm.stream.chunk` on the shared runtimeEventBus; we append the
        // `content` channel for this thread's reply nodes. The draft is created
        // lazily on the first chunk (so a provider error before any token leaves
        // no empty bubble — just the error), and the authoritative `response`
        // from execute() overwrites it afterward — never a second message.
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
                  employeeId: assigneeId ?? null,
                  body: chunk,
                  at: Date.now(),
                },
              ];
            }
            return prev.map((draft) =>
              draft.id === streamDraftId ? { ...draft, body: draft.body + chunk } : draft,
            );
          });
        const unsubscribe = subscribeReplyStream(runtimeEventBus, threadId, appendChunk);
        // Surface tool calls live (builtin + MCP) so a long run shows the agent
        // working instead of a blank streaming bubble.
        const unsubscribeActivity = subscribeRunActivity(runtimeEventBus, {
          onCalled: noteToolCalled,
          onResult: noteToolResult,
        });
        let response: string;
        try {
          response = await runtime.execute({
            text: materialized.promptText,
            threadId,
            employeeId: assigneeId ?? null,
            projectId,
          });
        } finally {
          // InMemoryEventBus has no auto-cleanup — always release these handlers.
          unsubscribe();
          unsubscribeActivity();
        }
        // A late-resolving Stop: keep whatever already streamed into the draft
        // (do not overwrite with the authoritative response, do not persist).
        if (abortedRef.current) return;
        const assistantMessage: ChatMessage = {
          id: streamDraftId,
          threadId,
          author: 'employee',
          employeeId: assigneeId ?? null,
          body: response,
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
          toast.error('Provider send failed', { description: messageText });
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
          setDrafts((prev) => [
            ...prev,
            {
              id: newDraftId('provider-error'),
              threadId,
              author: 'system',
              employeeId: null,
              body: `Provider bridge failed: ${messageText}`,
              at: Date.now(),
            },
          ]);
        }
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        if (requestIdRef.current === requestId) {
          requestIdRef.current = null;
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
    ],
  );

  // Shared by the diegetic Stop, the composer Stop, and the unmount cleanup so
  // a thread switch (ChatRail mounts OfficeThread keyed on selectedThreadId, so
  // switching unmounts this runtime) never orphans a live `llm_fetch`: marks the
  // run aborted, aborts the controller, tells the Rust side to drop the request,
  // and stops the store. Fire-and-forget — the abort failure is logged, never
  // surfaced as a cancel toast.
  const abortInFlight = useCallback(async () => {
    abortedRef.current = true;
    abortControllerRef.current?.abort();
    // Cancel the in-flight graph execution for this thread. The orchestration
    // abort signals the running graph stream; the underlying `llm_fetch` is then
    // cancelled through the run's AbortSignal. (Harmless no-op when no run is in
    // flight for this thread.)
    if (companyId) {
      void import('@/runtime/desktop-agent-runtime.js')
        .then(({ getDesktopAgentRuntime }) => getDesktopAgentRuntime(companyId))
        .then((runtime) => runtime.abort(threadId))
        .catch((err: unknown) => {
          console.warn('[useOfficeRuntime] agent runtime abort failed', { threadId, err });
        });
    }
    const requestId = requestIdRef.current;
    if (requestId) {
      void import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('llm_fetch_abort', { requestId }).catch((err: unknown) => {
          console.warn('[useOfficeRuntime] llm_fetch_abort failed', { requestId, err });
        }),
      );
    }
    stop();
  }, [stop, companyId, threadId]);

  // Register the real provider abort as the store's stop handler while mounted,
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
