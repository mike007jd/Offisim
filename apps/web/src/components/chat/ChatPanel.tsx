import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { MessageBubble } from './MessageBubble';
import { StreamingBubble } from './StreamingBubble';
import { ChatInput } from './ChatInput';
import { ErrorBanner } from '../error/ErrorBanner';
import { EmptyState } from '../error/EmptyState';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { useStreamingContent } from '../../runtime/use-streaming-content';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  onOpenSettings: () => void;
}

export function ChatPanel({ onOpenSettings }: ChatPanelProps) {
  const { sendMessage, isRunning, isReady, error, clearError } = useAicsRuntime();
  const { content: streamContent, isStreaming } = useStreamingContent();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastStreamRef = useRef('');

  // When streaming ends and there's content, add as assistant message
  useEffect(() => {
    if (!isStreaming && lastStreamRef.current) {
      setMessages((prev) => [
        ...prev,
        { id: `msg-${Date.now()}`, role: 'assistant', content: lastStreamRef.current },
      ]);
      lastStreamRef.current = '';
    }
    if (isStreaming && streamContent) {
      lastStreamRef.current = streamContent;
    }
  }, [isStreaming, streamContent]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamContent]);

  function handleSend(text: string) {
    setMessages((prev) => [
      ...prev,
      { id: `msg-${Date.now()}`, role: 'user', content: text },
    ]);
    sendMessage(text);
  }

  const showEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {error && (
        <ErrorBanner message={error} onDismiss={clearError} />
      )}
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
