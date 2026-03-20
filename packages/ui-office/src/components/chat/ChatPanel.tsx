import { ScrollArea } from '@aics/ui-core';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useErrorTracking } from '../../hooks/useErrorTracking';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { useStreamingContent } from '../../runtime/use-streaming-content';
import { EmptyState } from '../error/EmptyState';
import { ErrorBanner } from '../error/ErrorBanner';
import { MeetingControlsAutoWired } from '../office/MeetingControlsAutoWired';
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
  /** Open dashboard overlay (for /status command) */
  onShowDashboard?: () => void;
  /** Open cost view (for /budget command) */
  onShowBudget?: () => void;
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
  onShowDashboard,
  onShowBudget,
}: ChatPanelProps) {
  const {
    sendMessage,
    retryLastMessage,
    isRunning,
    isReady,
    error,
    clearError,
  } = useAicsRuntime();
  const { content: streamContent, isStreaming } = useStreamingContent();
  const errorHistory = useErrorTracking();
  const agents = useAgentStates();

  // Per-target message history: null key = boss chat, employeeId = direct chat
  const [messagesByTarget, setMessagesByTarget] = useState<Map<string | null, ChatMessage[]>>(
    new Map(),
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Track which target the last error occurred on
  const errorTargetRef = useRef<string | null>(null);

  // Current target key
  const targetKey = selectedEmployeeId ?? null;

  // Current messages for the active target
  const messages = messagesByTarget.get(targetKey) ?? [];

  // Clear error when switching targets
  const prevTargetRef = useRef(targetKey);
  useEffect(() => {
    if (prevTargetRef.current !== targetKey && error) {
      clearError();
    }
    prevTargetRef.current = targetKey;
  }, [targetKey, error, clearError]);

  const lastStreamRef = useRef('');

  useEffect(() => {
    if (isStreaming && streamContent) {
      lastStreamRef.current = streamContent;
    }
  }, [isStreaming, streamContent]);

  // Auto-scroll
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/streamContent trigger scroll
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

    const finalContent = lastStreamRef.current || response;
    if (finalContent) {
      addMessage(targetKey, { id: genMsgId(), role: 'assistant', content: finalContent });
    }
    lastStreamRef.current = '';
  }

  async function handleRetry() {
    lastStreamRef.current = '';
    const retryTarget = errorTargetRef.current;
    const response = await retryLastMessage();
    const finalContent = lastStreamRef.current || response;
    if (finalContent) {
      addMessage(retryTarget, { id: genMsgId(), role: 'assistant', content: finalContent });
    }
    lastStreamRef.current = '';
  }

  function handleSwapPerson(employeeId: string) {
    const allMessages = messagesByTarget.get(errorTargetRef.current) ?? [];
    const lastUserMsg = [...allMessages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;

    clearError();
    lastStreamRef.current = '';

    addMessage(employeeId, { id: genMsgId(), role: 'user', content: lastUserMsg.content });
    sendMessage(lastUserMsg.content, { targetEmployeeId: employeeId }).then((response) => {
      const finalContent = lastStreamRef.current || response;
      if (finalContent) {
        addMessage(employeeId, { id: genMsgId(), role: 'assistant', content: finalContent });
      }
      lastStreamRef.current = '';
    });
  }

  function handleSwapModel() {
    onOpenSettings();
  }

  // ── Slash command handler (client-side only) ────────────────────
  const handleSlashCommand = useCallback(
    (cmd: string) => {
      switch (cmd) {
        case '/status':
          onShowDashboard?.();
          break;
        case '/budget':
          onShowBudget?.();
          break;
      }
    },
    [onShowDashboard, onShowBudget],
  );

  // ── Mention select handler ─────────────────────────────────────
  const handleMentionSelect = useCallback(
    (_employeeId: string) => {
      // For now, @mentions just insert the name in the message.
      // Direct chat switching happens when user sends the message
      // or could be wired here if desired.
    },
    [],
  );

  const showEmpty = messages.length === 0 && !isStreaming;
  const isDirectChat = !!selectedEmployeeId;

  const inputPlaceholder = isDirectChat
    ? `Message ${selectedEmployeeName ?? 'employee'}...`
    : 'Message your team...';

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Direct chat header — single compact line */}
      {isDirectChat && (
        <div className="flex items-center gap-2 border-b border-white/5 px-3 h-8">
          <button
            type="button"
            onClick={onClearSelection}
            className="flex items-center gap-1 text-slate-500 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            <span className="text-xs">Team</span>
          </button>
          <span className="text-xs text-slate-300 font-medium">
            {selectedEmployeeName ?? selectedEmployeeId}
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <ErrorBanner
          message={error}
          onDismiss={clearError}
          onRetry={handleRetry}
          employees={agents}
          onSwapPerson={handleSwapPerson}
          onSwapModel={handleSwapModel}
          errorHistory={errorHistory}
        />
      )}

      {/* Message area */}
      {showEmpty ? (
        isDirectChat ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-slate-600">
              Start a conversation with {selectedEmployeeName ?? 'this employee'}
            </p>
          </div>
        ) : (
          <EmptyState
            isConfigured={isReady}
            onOpenSettings={onOpenSettings}
            onSendPrompt={handleSend}
          />
        )
      ) : (
        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="flex flex-col gap-1 p-2">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
            ))}
            {isStreaming && <StreamingBubble />}
          </div>
        </ScrollArea>
      )}

      {/* Meeting controls (only shown when meeting is active) */}
      <MeetingControlsAutoWired />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isRunning || !isReady}
        placeholder={inputPlaceholder}
        agents={agents}
        onSlashCommand={handleSlashCommand}
        onMentionSelect={handleMentionSelect}
      />
    </div>
  );
}
