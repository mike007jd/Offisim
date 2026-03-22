import { ScrollArea } from '@aics/ui-core';
import { ArrowLeft, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useErrorTracking } from '../../hooks/useErrorTracking';
import { usePipelineStage, STAGE_META } from '../../hooks/usePipelineStage';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { useStreamingContent } from '../../runtime/use-streaming-content';
import { EmptyState } from '../error/EmptyState';
import { ErrorBanner } from '../error/ErrorBanner';
import { MeetingPanel } from '../office/MeetingPanel';
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
  /** Switch active direct-chat target (used by @mention selection). */
  onSelectEmployee?: (employeeId: string) => void;
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
  onSelectEmployee,
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
    abortExecution,
  } = useAicsRuntime();
  const { content: streamContent, isStreaming } = useStreamingContent();
  const errorHistory = useErrorTracking();
  const agents = useAgentStates();
  const pipelineStage = usePipelineStage();

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
    (employeeId: string) => {
      if (employeeId === 'team') return; // @team stays in team chat
      onSelectEmployee?.(employeeId); // Switch to direct chat with that employee
    },
    [onSelectEmployee],
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

      {/* Meeting panel — shows live participants, transcript, actions, controls */}
      <MeetingPanel agents={agents} />

      {/* Pipeline status + stop button — inline, only visible while active */}
      {pipelineStage && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-t border-white/5">
          <span className="flex gap-0.5">
            <span className={`w-1 h-1 rounded-full animate-bounce ${STAGE_META[pipelineStage].chatColorClass} opacity-80`} style={{ animationDelay: '0ms' }} />
            <span className={`w-1 h-1 rounded-full animate-bounce ${STAGE_META[pipelineStage].chatColorClass} opacity-60`} style={{ animationDelay: '120ms' }} />
            <span className={`w-1 h-1 rounded-full animate-bounce ${STAGE_META[pipelineStage].chatColorClass} opacity-40`} style={{ animationDelay: '240ms' }} />
          </span>
          <span className={`font-mono text-[10px] tracking-wide ${STAGE_META[pipelineStage].chatColorClass}`}>
            {STAGE_META[pipelineStage].chatLabel}
          </span>
          {isRunning && (
            <button
              type="button"
              onClick={abortExecution}
              title="Stop execution"
              className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              <span>Stop</span>
            </button>
          )}
        </div>
      )}

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
