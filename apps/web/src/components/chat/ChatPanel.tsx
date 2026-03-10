import { useEffect, useRef, useState } from 'react';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { useStreamingContent } from '../../runtime/use-streaming-content';
import { EmptyState } from '../error/EmptyState';
import { ErrorBanner } from '../error/ErrorBanner';
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
}

let nextMsgId = 0;
function genMsgId(): string {
  return `msg-${nextMsgId++}`;
}

export function ChatPanel({ onOpenSettings }: ChatPanelProps) {
  const { sendMessage, isRunning, isReady, error, clearError } = useAicsRuntime();
  const { content: streamContent, isStreaming } = useStreamingContent();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track latest stream content in a ref so handleSend can read it after
  // sendMessage resolves. This is the ONLY place assistant messages are
  // added — no competing useEffect path.
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

  async function handleSend(text: string) {
    lastStreamRef.current = '';

    setMessages((prev) => [...prev, { id: genMsgId(), role: 'user', content: text }]);

    const response = await sendMessage(text);

    // After sendMessage resolves, pick the best source for the assistant reply:
    // 1. Streaming content (from boss-summary's llm.stream.chunk events)
    // 2. Direct graph return value (for non-streaming / direct_reply paths)
    const finalContent = lastStreamRef.current || response;
    if (finalContent) {
      setMessages((prev) => [
        ...prev,
        { id: genMsgId(), role: 'assistant', content: finalContent },
      ]);
    }
    lastStreamRef.current = '';
  }

  const showEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {error && <ErrorBanner message={error} onDismiss={clearError} />}
      {showEmpty ? (
        <EmptyState isConfigured={isReady} onOpenSettings={onOpenSettings} />
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
