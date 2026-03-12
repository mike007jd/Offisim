import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { useStreamingContent } from '../../runtime/use-streaming-content';
import { EmptyState } from '../error/EmptyState';
import { ErrorBanner } from '../error/ErrorBanner';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { StreamingBubble } from './StreamingBubble';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  onOpenSettings: () => void;
  selectedEmployeeId?: string | null;
  selectedEmployeeName?: string | null;
  onClearSelection?: () => void;
}

let nextMsgId = 0;
function genMsgId(): string {
  return `msg-${nextMsgId++}`;
}

export function ChatPanel({
  onOpenSettings,
  selectedEmployeeId,
  selectedEmployeeName,
  onClearSelection,
}: ChatPanelProps) {
  const { sendMessage, retryLastMessage, isRunning, isReady, error, clearError } = useAicsRuntime();
  const { content: streamContent, isStreaming } = useStreamingContent();

  // Per-target message history: null key = boss chat, employeeId = direct chat
  const [messagesByTarget, setMessagesByTarget] = useState<Map<string | null, ChatMessage[]>>(
    new Map(),
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Track which target the last error occurred on, so retry adds response to the correct bucket
  const errorTargetRef = useRef<string | null>(null);

  // Current target key
  const targetKey = selectedEmployeeId ?? null;

  // Current messages for the active target
  const messages = messagesByTarget.get(targetKey) ?? [];

  // Clear error when switching targets — old error is no longer relevant
  const prevTargetRef = useRef(targetKey);
  useEffect(() => {
    if (prevTargetRef.current !== targetKey && error) {
      clearError();
    }
    prevTargetRef.current = targetKey;
  }, [targetKey, error, clearError]);

  // Track latest stream content in a ref so handleSend can read it after
  // sendMessage resolves.
  const lastStreamRef = useRef('');

  useEffect(() => {
    if (isStreaming && streamContent) {
      lastStreamRef.current = streamContent;
    }
  }, [isStreaming, streamContent]);

  // Auto-scroll when new messages arrive or streaming content updates
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/streamContent trigger scroll-to-bottom intentionally
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamContent]);

  function addMessage(target: string | null, msg: ChatMessage) {
    setMessagesByTarget((prev) => {
      const next = new Map(prev);
      const existing = next.get(target) ?? [];
      next.set(target, [...existing, msg]);
      return next;
    });
  }

  async function handleSend(text: string) {
    lastStreamRef.current = '';
    errorTargetRef.current = targetKey;

    addMessage(targetKey, { id: genMsgId(), role: 'user', content: text });

    const response = await sendMessage(text, {
      targetEmployeeId: selectedEmployeeId ?? undefined,
    });

    // After sendMessage resolves, pick the best source for the assistant reply:
    // 1. Streaming content (from boss-summary's llm.stream.chunk events)
    // 2. Direct graph return value (for non-streaming / direct_reply paths)
    const finalContent = lastStreamRef.current || response;
    if (finalContent) {
      addMessage(targetKey, { id: genMsgId(), role: 'assistant', content: finalContent });
    }
    lastStreamRef.current = '';
  }

  async function handleRetry() {
    lastStreamRef.current = '';
    // Use the target where the error originally occurred
    const retryTarget = errorTargetRef.current;
    const response = await retryLastMessage();
    const finalContent = lastStreamRef.current || response;
    if (finalContent) {
      addMessage(retryTarget, { id: genMsgId(), role: 'assistant', content: finalContent });
    }
    lastStreamRef.current = '';
  }

  const showEmpty = messages.length === 0 && !isStreaming;
  const isDirectChat = !!selectedEmployeeId;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {isDirectChat && (
        <div className="flex items-center gap-2 border-b-2 border-ocean-light bg-ocean-deep/80 px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-shell hover:text-sand"
            onClick={onClearSelection}
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Team
          </Button>
          <span className="text-xs font-pixel-mono text-coral">
            Direct chat with {selectedEmployeeName ?? selectedEmployeeId}
          </span>
        </div>
      )}
      {error && <ErrorBanner message={error} onDismiss={clearError} onRetry={handleRetry} />}
      {showEmpty ? (
        isDirectChat ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <p className="text-xs text-shell font-pixel-mono text-center">
              Start a conversation with {selectedEmployeeName ?? 'this employee'}.
              <br />
              They will respond using their persona.
            </p>
          </div>
        ) : (
          <EmptyState isConfigured={isReady} onOpenSettings={onOpenSettings} />
        )
      ) : (
        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="flex flex-col gap-3 p-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
            ))}
            {isStreaming && <StreamingBubble />}
          </div>
        </ScrollArea>
      )}
      <ChatInput onSend={handleSend} disabled={isRunning || !isReady} />
    </div>
  );
}
