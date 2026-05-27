import type { ChatAttachment, ChatMessage } from '@/data/types.js';
import {
  findDefaultChatProviderProfile,
  loadRuntimeProviderProfiles,
  safeErrorMessage,
  sendProviderText,
} from '@/lib/provider-bridge.js';
import {
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRunStore } from '../run-store.js';

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

function appendText(message: AppendMessage): string {
  return message.content
    .map((part) => ('text' in part ? part.text : ''))
    .join('')
    .trim();
}

function newDraftId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function sendRuntimeProviderMessage(text: string, requestId: string): Promise<string> {
  const profiles = await loadRuntimeProviderProfiles();
  const profile = findDefaultChatProviderProfile(profiles);
  if (!profile) {
    throw new Error('Runtime provider profile is not configured.');
  }
  return sendProviderText({
    profile,
    text,
    requestId,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });
}

/**
 * The Office conversation runtime. assistant-ui owns the thread/composer state
 * over Offisim's external message store. Desktop sends go through the Tauri
 * provider bridge so credentials stay outside the webview.
 */
export function useOfficeRuntime({
  threadId,
  seedMessages,
}: {
  threadId: string;
  seedMessages: ChatMessage[];
}) {
  const [drafts, setDrafts] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const abortedRef = useRef(false);
  const messages = useMemo(() => [...seedMessages, ...drafts], [seedMessages, drafts]);

  const isRunning = useRunStore((s) => s.isRunning);
  const startRun = useRunStore((s) => s.start);
  const finishRun = useRunStore((s) => s.finish);
  const stop = useRunStore((s) => s.stop);
  const staged = useRunStore((s) => s.staged);
  const clearStaged = useRunStore((s) => s.clearStaged);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = appendText(message);
      if (!text) return;
      const attachments: ChatAttachment[] = staged
        .filter((a) => a.status === 'attached')
        .map((a) => ({ id: a.id, name: a.name, sizeLabel: a.sizeLabel, ext: a.ext }));
      setDrafts((prev) => [
        ...prev,
        {
          id: newDraftId('boss'),
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
      requestIdRef.current = requestId;
      abortedRef.current = false;
      setIsSending(true);
      startRun('Provider response');
      try {
        const response = await sendRuntimeProviderMessage(text, requestId);
        setDrafts((prev) => [
          ...prev,
          {
            id: newDraftId('assistant'),
            threadId,
            author: 'employee',
            employeeId: null,
            body: response,
            at: Date.now(),
          },
        ]);
      } catch (error) {
        // A deliberate Stop aborts the in-flight request, which rejects here.
        // That is a cancel, not a failure — skip the error toast/bubble.
        if (!abortedRef.current) {
          const messageText = safeErrorMessage(error);
          toast.error('Provider send failed', { description: messageText });
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
        requestIdRef.current = null;
        setIsSending(false);
        // An aborted run is stopped (not "done"); only a settled request completes.
        if (abortedRef.current) {
          stop();
        } else {
          finishRun();
        }
      }
    },
    [threadId, staged, clearStaged, startRun, finishRun, stop],
  );

  const onCancel = useCallback(async () => {
    abortedRef.current = true;
    const requestId = requestIdRef.current;
    if (requestId) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('llm_fetch_abort', { requestId }).catch(() => undefined);
    }
    stop();
  }, [stop]);

  return useExternalStoreRuntime({
    messages,
    onNew,
    convertMessage,
    isRunning: isRunning || isSending,
    onCancel,
  });
}
