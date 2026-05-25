import type { ChatAttachment, ChatMessage } from '@/data/types.js';
import {
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useCallback, useMemo, useState } from 'react';
import { useRunStore } from '../run-store.js';

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

/**
 * The Office conversation runtime. assistant-ui is the runtime over our external
 * message store: `isRunning` and the Stop control (`onCancel`) are bound to the
 * shared run-state store, and sending the boss instruction routes into it via
 * `onNew` → `start()`. The stage pipeline pill, Live run-axis and error banner
 * all read the same store.
 */
export function useOfficeRuntime({
  threadId,
  seedMessages,
}: {
  threadId: string;
  seedMessages: ChatMessage[];
}) {
  const [drafts, setDrafts] = useState<ChatMessage[]>([]);
  const messages = useMemo(() => [...seedMessages, ...drafts], [seedMessages, drafts]);

  const isRunning = useRunStore((s) => s.isRunning);
  const start = useRunStore((s) => s.start);
  const stop = useRunStore((s) => s.stop);
  const staged = useRunStore((s) => s.staged);
  const clearStaged = useRunStore((s) => s.clearStaged);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = appendText(message);
      if (!text) return;
      const attachments: ChatAttachment[] = staged
        .filter((a) => a.status === 'parsed')
        .map((a) => ({ id: a.id, name: a.name, sizeLabel: a.sizeLabel, ext: a.ext }));
      setDrafts((prev) => [
        ...prev,
        {
          id: `draft-${Date.now()}`,
          threadId,
          author: 'boss',
          employeeId: null,
          body: text,
          at: Date.now(),
          attachments: attachments.length ? attachments : undefined,
        },
      ]);
      clearStaged();
      start();
    },
    [threadId, staged, start, clearStaged],
  );

  const onCancel = useCallback(async () => {
    stop();
  }, [stop]);

  return useExternalStoreRuntime({ messages, onNew, convertMessage, isRunning, onCancel });
}
