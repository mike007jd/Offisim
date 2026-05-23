import {
  type AppendMessage,
  AssistantRuntimeProvider,
  type ExternalStoreThreadListAdapter,
  useExternalMessageConverter,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import {
  type OffisimAdapterMessage,
  appendMessageToText,
  convertOffisimMessage,
  useOffisimAdapterMessages,
} from './useOffisimExternalStore';

export interface OffisimAssistantRuntimeProviderProps {
  /** `<projectId>::<threadId>::<employeeId?>` for the active conversation. */
  conversationKey: string;
  /** Drives `thread.isRunning` (from runtime Status). */
  isRunning: boolean;
  /**
   * Fire-and-forget send. Receives the plain text plus the raw assistant-ui
   * `AppendMessage` (for callers that need attachment/runConfig context). The
   * SSOT (store + event stream) keeps driving re-renders afterwards.
   */
  onSend: (text: string, message: AppendMessage) => void | Promise<void>;
  /** Maps to `abortExecution`. */
  onCancel: () => void;
  /** `chat_threads`-backed thread-list adapter (switch/rename/archive/delete). */
  threadList?: ExternalStoreThreadListAdapter;
  children: ReactNode;
}

/**
 * Wraps the existing chat SSOT (zustand `chat-session-store` + event-driven
 * streaming) in an assistant-ui `ExternalStoreRuntime`. Does NOT rewrite the
 * runtime: `onSend` is fire-and-forget into the existing `sendMessage`, and the
 * store remains the single source of truth. `joinStrategy: 'none'` keeps each
 * finalized speaker segment as its own message (multi-speaker fidelity).
 */
export function OffisimAssistantRuntimeProvider({
  conversationKey,
  isRunning,
  onSend,
  onCancel,
  threadList,
  children,
}: OffisimAssistantRuntimeProviderProps) {
  const adapterMessages = useOffisimAdapterMessages(conversationKey);

  const threadMessages = useExternalMessageConverter<OffisimAdapterMessage>({
    callback: convertOffisimMessage,
    messages: adapterMessages as OffisimAdapterMessage[],
    isRunning,
    joinStrategy: 'none',
  });

  const handleNew = useCallback(
    async (message: AppendMessage) => {
      await onSend(appendMessageToText(message), message);
    },
    [onSend],
  );

  const handleCancel = useCallback(async () => {
    onCancel();
  }, [onCancel]);

  const runtime = useExternalStoreRuntime({
    messages: threadMessages,
    isRunning,
    onNew: handleNew,
    onCancel: handleCancel,
    ...(threadList ? { adapters: { threadList } } : {}),
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
