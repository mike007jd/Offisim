import { ScrollArea } from '@aics/ui-core';
import type { GraphNodeEnteredPayload, RuntimeEvent } from '@aics/shared-types';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useErrorTracking } from '../../hooks/useErrorTracking';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { useStreamingContent } from '../../runtime/use-streaming-content';
import { EmptyState } from '../error/EmptyState';
import { ErrorBanner } from '../error/ErrorBanner';
import { MeetingPanel } from '../office/MeetingPanel';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { StreamingBubble } from './StreamingBubble';

// ---------------------------------------------------------------------------
// Pipeline status — derived from graph.node.entered events
// ---------------------------------------------------------------------------

type PipelineStage = 'routing' | 'planning' | 'executing' | 'delivering' | null;

function nodeToPipelineStage(nodeName: string): PipelineStage {
  const lower = nodeName.toLowerCase();
  if (lower === 'manager') return 'routing';
  if (lower === 'pm' || lower === 'project_manager' || lower === 'planner') return 'planning';
  if (lower.includes('deliver') || lower === 'boss_summary' || lower === 'boss') return 'delivering';
  return 'executing';
}

const STAGE_LABEL: Record<NonNullable<PipelineStage>, string> = {
  routing: 'Manager routing…',
  planning: 'PM planning…',
  executing: 'Executing…',
  delivering: 'Delivering…',
};

const STAGE_COLOR: Record<NonNullable<PipelineStage>, string> = {
  routing: 'text-amber-400',
  planning: 'text-blue-400',
  executing: 'text-emerald-400',
  delivering: 'text-purple-400',
};

function usePipelineStatus(): { stage: PipelineStage; label: string | null } {
  const { eventBus, isRunning } = useAicsRuntime();
  const [stage, setStage] = useState<PipelineStage>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear stage when run ends
  useEffect(() => {
    if (!isRunning) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStage(null), 3000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isRunning]);

  useEffect(() => {
    const off = eventBus.on('graph.node.entered', (e: RuntimeEvent<GraphNodeEnteredPayload>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setStage(nodeToPipelineStage(e.payload.nodeName));
    });
    return off;
  }, [eventBus]);

  return {
    stage,
    label: stage ? STAGE_LABEL[stage] : null,
  };
}

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
  const pipeline = usePipelineStatus();

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

      {/* Meeting panel — shows live participants, transcript, actions, controls */}
      <MeetingPanel agents={agents} />

      {/* Pipeline status — inline, only visible while active */}
      {pipeline.stage && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-t border-white/5">
          <span className="flex gap-0.5">
            <span className={`w-1 h-1 rounded-full animate-bounce ${STAGE_COLOR[pipeline.stage]} opacity-80`} style={{ animationDelay: '0ms' }} />
            <span className={`w-1 h-1 rounded-full animate-bounce ${STAGE_COLOR[pipeline.stage]} opacity-60`} style={{ animationDelay: '120ms' }} />
            <span className={`w-1 h-1 rounded-full animate-bounce ${STAGE_COLOR[pipeline.stage]} opacity-40`} style={{ animationDelay: '240ms' }} />
          </span>
          <span className={`font-mono text-[10px] tracking-wide ${STAGE_COLOR[pipeline.stage]}`}>
            {pipeline.label}
          </span>
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
