import type { ChatMessage, Deliverable, Employee, ThreadScope } from '@/data/types.js';
import { Chip } from '@/design-system/grammar/Chip.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { ConvOutputs } from '@/surfaces/office/rail/ConvOutputs.js';
import { MessageItem } from '@/surfaces/office/rail/MessageItem.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  type AppendMessage,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  type ThreadMessageLike,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import {
  ChevronDown,
  Cpu,
  MessageSquarePlus,
  Paperclip,
  SendHorizontal,
  SlashSquare,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

/** Map an Offisim chat message into the assistant-ui thread model. The original
 *  message is carried in metadata.custom so the V3 renderer keeps full fidelity. */
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

interface OfficeThreadProps {
  threadId: string;
  seedMessages: ChatMessage[];
  employeesById: Map<string, Employee>;
  deliverables: Deliverable[];
  scope: ThreadScope;
  modelLabel: string;
}

function OfficeComposer({ modelLabel }: { modelLabel: string }) {
  return (
    <ComposerPrimitive.Root className="off-composer">
      <ComposerPrimitive.Input
        className="off-composer-input"
        placeholder="Message the team — Enter to send, Shift+Enter for newline"
        rows={2}
        submitOnEnter
      />
      <div className="off-composer-tools">
        <IconButton icon={Paperclip} label="Attach file" variant="subtle" size="iconSm" />
        <IconButton icon={SlashSquare} label="Slash commands" variant="subtle" size="iconSm" />
        <span className="off-composer-divider" aria-hidden />
        <Chip as="button" accent dotColor="var(--off-accent)">
          Team mode
          <Icon icon={ChevronDown} size="sm" />
        </Chip>
        <Chip as="button">
          <Icon icon={Cpu} size="sm" />
          {modelLabel}
          <Icon icon={ChevronDown} size="sm" />
        </Chip>
        <span className="off-grow" />
        <ComposerPrimitive.Send className="off-composer-send off-focusable">
          Send
          <Icon icon={SendHorizontal} size="sm" />
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

export function OfficeThread({
  threadId,
  seedMessages,
  employeesById,
  deliverables,
  scope,
  modelLabel,
}: OfficeThreadProps) {
  const [drafts, setDrafts] = useState<ChatMessage[]>([]);
  const messages = useMemo(() => [...seedMessages, ...drafts], [seedMessages, drafts]);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = appendText(message);
      if (!text) return;
      setDrafts((prev) => [
        ...prev,
        {
          id: `draft-${Date.now()}`,
          threadId,
          author: 'boss',
          employeeId: null,
          body: text,
          at: Date.now(),
        },
      ]);
    },
    [threadId],
  );

  const runtime = useExternalStoreRuntime({ messages, onNew, convertMessage, isRunning: false });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="off-thread">
        <ThreadPrimitive.Viewport className="off-thread-viewport">
          {messages.length === 0 ? (
            <EmptyState
              icon={MessageSquarePlus}
              title="No messages yet"
              description="Send the first instruction to start this conversation."
            />
          ) : (
            <div className="off-messages">
              <ThreadPrimitive.Messages>
                {({ message }) => {
                  const custom = message.metadata?.custom as unknown as ChatMessage | undefined;
                  return custom ? (
                    <MessageItem message={custom} employeesById={employeesById} />
                  ) : null;
                }}
              </ThreadPrimitive.Messages>
            </div>
          )}
          {scope === 'team' ? (
            <ConvOutputs deliverables={deliverables} employeesById={employeesById} />
          ) : null}
        </ThreadPrimitive.Viewport>
        <OfficeComposer modelLabel={modelLabel} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
