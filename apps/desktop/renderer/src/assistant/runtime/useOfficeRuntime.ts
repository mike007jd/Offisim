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
  sendDesktopProviderMessage,
} from './desktop-chat-runtime.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 512;

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
}: {
  threadId: string;
  seedMessages: ChatMessage[];
  /** Employee that holds this run (direct thread's employee), shown on the pill. */
  assigneeId?: string | null;
  companyId: string | null;
  projectId: string | null;
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
      startRun('Provider response', assigneeId ?? null);
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
        await persistChatMessage({ message: userMessage, companyId, projectId });
        const response = await sendDesktopProviderMessage({
          text: materialized.promptText,
          requestId,
          maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          threadId,
          companyId,
          projectId,
          signal: abortController.signal,
        });
        // A Stop can resolve the in-flight request late (the Rust abort and the
        // awaited response race). Without this guard a cancelled run would still
        // commit its response as a normal assistant message. The `finally` block
        // below still runs and routes cleanup through the aborted branch.
        if (abortedRef.current) return;
        const assistantMessage: ChatMessage = {
          id: newDraftId('assistant'),
          threadId,
          author: 'employee',
          employeeId: null,
          body: response,
          at: Date.now(),
        };
        setDrafts((prev) => [...prev, assistantMessage]);
        await persistChatMessage({ message: assistantMessage, companyId, projectId });
      } catch (error) {
        // A deliberate Stop aborts the in-flight request, which rejects here.
        // That is a cancel, not a failure — skip the error toast/bubble.
        if (!abortedRef.current) {
          const messageText = safeErrorMessage(error);
          toast.error('Provider send failed', { description: messageText });
          // Route the real failure into shared run state so the in-thread
          // ChatErrorBanner becomes reachable (not just the toast/bubble).
          setRunError(buildRunError(messageText));
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
    ],
  );

  const onCancel = useCallback(async () => {
    abortedRef.current = true;
    abortControllerRef.current?.abort();
    const requestId = requestIdRef.current;
    if (requestId) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('llm_fetch_abort', { requestId }).catch(() => undefined);
    }
    stop();
  }, [stop]);

  // Expose the real provider abort to the out-of-tree stage pill: register
  // onCancel as the store's stop handler while this runtime is mounted, so the
  // diegetic Stop control performs the same AbortController + llm_fetch_abort
  // cancel as the composer's own Stop. Cleared on unmount.
  useEffect(() => {
    setStopHandler(onCancel);
    return () => setStopHandler(null);
  }, [onCancel, setStopHandler]);

  // F/I4: ChatRail mounts OfficeThread with `key={selectedThreadId}`, so
  // switching threads (or list <-> thread) unmounts this runtime. Without
  // an explicit cleanup, an in-flight `llm_fetch` would resolve onto an
  // unmounted component and call setDrafts, and the Rust side request never
  // hears about the cancellation. Cleanup mirrors `onCancel` without the
  // user-facing toast suppression — we don't surface a cancel notification
  // when the unmount itself initiated it.
  useEffect(() => {
    return () => {
      abortedRef.current = true;
      abortControllerRef.current?.abort();
      const requestId = requestIdRef.current;
      if (requestId) {
        void import('@tauri-apps/api/core').then(({ invoke }) =>
          invoke('llm_fetch_abort', { requestId }).catch((err: unknown) => {
            // Surface the failure: silent catch hid orphan llm_fetch
            // requests when the dynamic import resolved onto a dead
            // component. Console output is enough — no UI toast on unmount.
            console.warn('[useOfficeRuntime] llm_fetch_abort failed during cleanup', {
              requestId,
              err,
            });
          }),
        );
      }
      stop();
    };
  }, [stop]);

  return useExternalStoreRuntime({
    messages,
    onNew,
    convertMessage,
    isRunning: storeRunningHere || isSending,
    onCancel,
  });
}
