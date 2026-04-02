import type { ProjectRow } from '@offisim/shared-types';
import { ScrollArea } from '@offisim/ui-core';
import { ArrowLeft, Folder } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useErrorTracking } from '../../hooks/useErrorTracking';
import { usePipelineStage } from '../../hooks/usePipelineStage';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { useStreamingContent } from '../../runtime/use-streaming-content';
import { EmptyState } from '../error/EmptyState';
import { ErrorBanner } from '../error/ErrorBanner';
import { MeetingPanel } from '../office/MeetingPanel';
import { ActivityRail } from './ActivityRail';
import { ChatInput } from './ChatInput';
import { InteractionPrompt } from './InteractionPrompt';
import { MessageBubble } from './MessageBubble';
import { PipelineProgress } from './PipelineProgress';
import { StreamingBubble } from './StreamingBubble';
import { SystemMessageFeed } from './SystemMessageFeed';

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
  /** Active project — when set, all messages use the project's threadId. */
  activeProject?: ProjectRow | null;
  /** Called when the user sends a message (provides the raw text for Kanban board etc.) */
  onUserMessage?: (text: string) => void;
  compact?: boolean;
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
  activeProject,
  onUserMessage,
  compact = false,
}: ChatPanelProps) {
  const { sendMessage, retryLastMessage, isRunning, isReady, error, clearError, abortExecution } =
    useOffisimRuntime();
  const { pendingInteraction, respondToInteraction } = useOffisimRuntime();
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
  const interactionTargetRef = useRef<string | null>(null);

  // Current target key
  const targetKey = selectedEmployeeId ?? null;
  const interactionEmployeeName = pendingInteraction?.employeeId
    ? (agents.get(pendingInteraction.employeeId)?.name ?? null)
    : null;

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

  useEffect(() => {
    if (pendingInteraction) {
      interactionTargetRef.current = errorTargetRef.current ?? targetKey;
      return;
    }
    interactionTargetRef.current = null;
  }, [pendingInteraction, targetKey]);

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

  async function handleInteractionRespond(
    selectedOptionId: string,
    freeformResponse?: string,
  ): Promise<void> {
    const pending = pendingInteraction;
    if (!pending || !respondToInteraction) return;
    const interactionTarget = interactionTargetRef.current ?? targetKey;

    const trimmedResponse = freeformResponse?.trim();
    if (pending.kind === 'agent_question' && selectedOptionId !== 'cancel' && trimmedResponse) {
      addMessage(interactionTarget, { id: genMsgId(), role: 'user', content: trimmedResponse });
    }

    lastStreamRef.current = '';
    const response = await respondToInteraction(selectedOptionId, trimmedResponse);
    const finalContent = lastStreamRef.current || response;
    if (finalContent) {
      addMessage(interactionTarget, { id: genMsgId(), role: 'assistant', content: finalContent });
    }
    lastStreamRef.current = '';
  }

  async function handleSend(
    text: string,
    options?: { entryMode?: 'boss_chat' | 'direct_chat' | 'meeting' },
  ) {
    lastStreamRef.current = '';
    errorTargetRef.current = targetKey;

    // Notify parent of user message (only for team chat, not direct employee chat)
    if (!selectedEmployeeId) {
      onUserMessage?.(text);
    }

    addMessage(targetKey, { id: genMsgId(), role: 'user', content: text });

    const response = await sendMessage(text, {
      entryMode: options?.entryMode,
      targetEmployeeId: selectedEmployeeId ?? undefined,
      threadId: activeProject?.thread_id ?? undefined,
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

  const showEmpty = messages.length === 0 && !isStreaming && !pendingInteraction;
  const isDirectChat = !!selectedEmployeeId;
  const latestMessage = messages.at(-1);
  const inputDisabledReason = !isReady
    ? '请先在 Settings 中配置 API Key，随后即可开始对话。'
    : isRunning
      ? '任务执行中，等待当前回合完成。'
      : undefined;

  const inputPlaceholder = isDirectChat
    ? `Message ${selectedEmployeeName ?? 'employee'}...`
    : 'Message your team...';

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {!isReady && (
        <div className="mx-3 mt-3 rounded-xl border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-[11px] text-amber-100">
          <div className="flex items-center justify-between gap-3">
            <span>配置 API Key 以开始真实协作。当前仍可浏览场景、模板和编辑器。</span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="shrink-0 rounded-md border border-amber-300/20 bg-black/20 px-2 py-1 text-[10px] text-amber-50 transition-colors hover:bg-black/35"
            >
              Open Settings
            </button>
          </div>
        </div>
      )}

      {/* Project context banner — shown when a project is scoped */}
      {activeProject && !isDirectChat && (
        <div
          className="flex items-center gap-1.5 border-b border-white/5 h-7 bg-white/2"
          style={{ paddingInline: 'var(--sp-md)' }}
        >
          <Folder className="h-3 w-3 text-slate-600 flex-shrink-0" />
          <span className="text-[11px] text-slate-500 truncate">{activeProject.name}</span>
        </div>
      )}

      {/* Direct chat header — single compact line */}
      {isDirectChat && (
        <div
          className="flex items-center gap-2 border-b border-white/5 h-8"
          style={{ paddingInline: 'var(--sp-md)' }}
        >
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

      {compact ? (
        <div className="flex flex-1 flex-col justify-end gap-2 px-3 py-2">
          {latestMessage ? (
            <MessageBubble role={latestMessage.role} content={latestMessage.content} />
          ) : isDirectChat ? (
            <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-xs text-slate-500">
              Start a conversation with {selectedEmployeeName ?? 'this employee'}
            </div>
          ) : (
            <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-xs text-slate-500">
              输入任务，观察 AI 团队协作。
            </div>
          )}
          {isStreaming && <StreamingBubble />}
        </div>
      ) : (
        <>
          {/* Message area */}
          {showEmpty ? (
            isRunning ? (
              <ScrollArea className="flex-1">
                <div
                  ref={scrollRef}
                  className="flex flex-col gap-1"
                  style={{ padding: 'var(--sp-sm)' }}
                >
                  <ActivityRail
                    focusedEmployeeId={selectedEmployeeId}
                    focusedEmployeeName={selectedEmployeeName}
                  />
                  <SystemMessageFeed />
                </div>
              </ScrollArea>
            ) : isDirectChat ? (
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
              <div
                ref={scrollRef}
                className="flex flex-col gap-1"
                style={{ padding: 'var(--sp-sm)' }}
              >
                <ActivityRail
                  focusedEmployeeId={selectedEmployeeId}
                  focusedEmployeeName={selectedEmployeeName}
                />
                <SystemMessageFeed />
                {pendingInteraction?.severity !== 'high' &&
                  pendingInteraction &&
                  respondToInteraction && (
                    <InteractionPrompt
                      request={pendingInteraction}
                      employeeName={interactionEmployeeName}
                      onRespond={handleInteractionRespond}
                    />
                  )}
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
                ))}
                {isStreaming && <StreamingBubble />}
              </div>
            </ScrollArea>
          )}
        </>
      )}

      {/* Meeting panel — shows live participants, transcript, actions, controls */}
      {!compact && <MeetingPanel agents={agents} />}
      {pendingInteraction?.severity === 'high' && pendingInteraction && respondToInteraction && (
        <InteractionPrompt
          request={pendingInteraction}
          employeeName={interactionEmployeeName}
          onRespond={handleInteractionRespond}
        />
      )}

      {/* Pipeline progress bar — 5-stage visual indicator, only visible while active */}
      {!compact && (
        <PipelineProgress stage={pipelineStage} isRunning={isRunning} onAbort={abortExecution} />
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isRunning || !isReady}
        disabledReason={inputDisabledReason}
        placeholder={inputPlaceholder}
        agents={agents}
        onSlashCommand={handleSlashCommand}
        onMentionSelect={handleMentionSelect}
      />
    </div>
  );
}
