import type { InteractionRequest, ProjectRow } from '@offisim/shared-types';
import { ScrollArea } from '@offisim/ui-core';
import { ArrowLeft } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from 'react';
import { type Deliverable, useDeliverables } from '../../hooks/useDeliverables';
import { useErrorTracking } from '../../hooks/useErrorTracking';
import { useMeeting } from '../../hooks/useMeeting.js';
import { usePipelineStage } from '../../hooks/usePipelineStage';
import {
  type ChatCommand,
  type ClientCommandContext,
  type PanelCommandContext,
  buildHelpText,
  extractAtFragments,
  extractMentionHints,
} from '../../lib/chat-commands.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { useStreamingContentForConversation } from '../../runtime/use-streaming-content';
import { ErrorBanner } from '../error/ErrorBanner';
import { ProjectContextStrip } from '../project/ProjectContextStrip';
import { ActivityRail } from './ActivityRail';
import { ChatInput } from './ChatInput';
import { InteractionPrompt } from './InteractionPrompt';
import { MessageBubble } from './MessageBubble';
import { StreamingBubble } from './StreamingBubble';
import { SystemMessageFeed } from './SystemMessageFeed';
import { type ChatMessage, getConversationKey, useChatSessionStore } from './chat-session-store';

interface StarterPrompt {
  label: string;
  text: string;
}

const MeetingPanel = lazy(() =>
  import('../office/MeetingPanel').then((module) => ({ default: module.MeetingPanel })),
);
const MeetingActionItems = lazy(() =>
  import('./MeetingActionItems.js').then((module) => ({ default: module.MeetingActionItems })),
);
const PipelineProgress = lazy(() =>
  import('./PipelineProgress').then((module) => ({ default: module.PipelineProgress })),
);

interface ChatPanelProps {
  onOpenSettings: () => void;
  selectedEmployeeId?: string | null;
  selectedEmployeeName?: string | null;
  onClearSelection?: () => void;
  /** Toggle dashboard overlay */
  onToggleDashboard?: () => void;
  /** Toggle kanban overlay */
  onToggleKanban?: () => void;
  /** Open office layout editor */
  onOpenEditor?: () => void;
  /** Open decoration studio */
  onOpenStudio?: () => void;
  /** Active project — when set, all messages use the project's threadId. */
  activeProject?: ProjectRow | null;
  /** Open ProjectCreateDialog in edit mode for the active project. */
  onRequestEditProject?: (project: ProjectRow) => void;
  /** Toast surface for project context strip errors (e.g. "Folder not found"). */
  onProjectStripError?: (message: string) => void;
  /** Called when the user sends a message (provides the raw text for Kanban board etc.) */
  onUserMessage?: (text: string) => void;
  /** Template-aware starter prompts for the chat empty state. */
  onboardingStarterPrompts?: readonly StarterPrompt[];
  compact?: boolean;
  showPipelineProgress?: boolean;
  showMeetingPanel?: boolean;
  showActivityRail?: boolean;
}

const EMPTY_MESSAGES: ChatMessage[] = [];
function genMsgId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `msg-${crypto.randomUUID()}`
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getScopedConversationKey(
  threadId: string | null | undefined,
  targetEmployeeId: string | null,
): string {
  return getConversationKey({
    threadId: threadId ?? null,
    targetEmployeeId,
  });
}

function resolveInteractionTargetEmployeeId(
  request: InteractionRequest | null | undefined,
): string | null {
  if (!request) return null;
  if (
    request.kind === 'skill_install_confirm' &&
    request.context?.type === 'skill_install_confirm'
  ) {
    return request.context.resolvedEmployeeId ?? null;
  }
  return request.employeeId ?? null;
}

/**
 * Collaboration chat surface — rendered inside the Right Rail.
 *
 * Workspace isolation (Req 11.3): `selectedEmployeeId` changes only affect
 * local chat state (direct-chat header, message target). The parent (App.tsx)
 * ensures this via `setSelectedEmployeeId` + `setChatOpenToken`, neither of
 * which touches workspace state.
 */
export function ChatPanel({
  onOpenSettings,
  selectedEmployeeId,
  selectedEmployeeName,
  onClearSelection,
  onToggleDashboard,
  onToggleKanban,
  onOpenEditor,
  onOpenStudio,
  activeProject,
  onRequestEditProject,
  onProjectStripError,
  onUserMessage,
  onboardingStarterPrompts,
  compact = false,
  showPipelineProgress = true,
  showMeetingPanel = true,
  showActivityRail = false,
}: ChatPanelProps) {
  const {
    sendMessage,
    retryLastMessage,
    isRunning,
    isReady,
    error,
    failedRunError,
    clearError,
    abortExecution,
    pendingInteraction,
    respondToInteraction,
  } = useOffisimRuntime();
  const errorHistory = useErrorTracking();
  const agents = useAgentStates();
  const { meetingState } = useMeeting();
  const { stage: pipelineStage, routeLabel } = usePipelineStage();
  const appendMessage = useChatSessionStore((state) => state.appendMessage);
  const startRun = useChatSessionStore((state) => state.startRun);
  const finalizeActiveRun = useChatSessionStore((state) => state.finalizeActiveRun);
  const clearAllConversations = useChatSessionStore((state) => state.clearAllConversations);
  const getMessages = useChatSessionStore((state) => state.getMessages);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const SCROLL_THRESHOLD = 80;

  const interactionTargetRef = useRef<string | null>(null);

  // Current target key
  const activeThreadId = activeProject?.thread_id ?? null;
  const targetKey = selectedEmployeeId ?? null;
  const conversationKey = getScopedConversationKey(activeThreadId, targetKey);
  const failedConversationKey = failedRunError?.conversationKey ?? null;
  const failedTargetEmployeeId = failedRunError?.targetEmployeeId ?? null;
  const interactionEmployeeId = resolveInteractionTargetEmployeeId(pendingInteraction);
  const interactionEmployeeName = interactionEmployeeId
    ? (agents.get(interactionEmployeeId)?.name ?? null)
    : null;
  const {
    content: streamContent,
    reasoning: streamReasoning,
    isStreaming,
    nodeName: streamNodeName,
  } = useStreamingContentForConversation(conversationKey);
  const bannerMessage = failedRunError?.message ?? error;

  // Current messages for the active target
  const messages = useChatSessionStore(
    useCallback(
      (state) => state.conversations[conversationKey]?.messages ?? EMPTY_MESSAGES,
      [conversationKey],
    ),
  );

  // Deliverables — attach each to its matching assistant message.
  // Pins the assignment by deliverableId so late re-renders don't reshuffle attachments.
  const allDeliverables = useDeliverables();
  const assignedDeliverableRef = useRef<Map<string, string>>(new Map());
  const deliverablesByMessageId = useMemo(() => {
    const map = new Map<string, Deliverable[]>();
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    if (assistantMessages.length === 0) return map;
    for (const d of allDeliverables) {
      let messageId = assignedDeliverableRef.current.get(d.id);
      if (!messageId) {
        // Pick latest assistant message created within a sane window around the deliverable.
        // The 2s slack lets message commits that happen slightly after the deliverable still match.
        const candidates = assistantMessages.filter(
          (m) => (m.createdAt ?? 0) <= d.createdAt + 2000,
        );
        const fallback = assistantMessages.at(-1);
        const candidate = candidates.at(-1) ?? fallback;
        if (candidate) {
          messageId = candidate.id;
          assignedDeliverableRef.current.set(d.id, messageId);
        }
      }
      if (!messageId) continue;
      // Only attach if that message belongs to the current conversation view.
      if (!assistantMessages.some((m) => m.id === messageId)) continue;
      const arr = map.get(messageId) ?? [];
      arr.push(d);
      map.set(messageId, arr);
    }
    return map;
  }, [allDeliverables, messages]);

  // Clear error when switching targets
  const prevTargetRef = useRef(targetKey);
  useEffect(() => {
    if (prevTargetRef.current !== targetKey && error && !failedRunError) {
      clearError();
    }
    prevTargetRef.current = targetKey;
  }, [targetKey, error, failedRunError, clearError]);

  useEffect(() => {
    if (pendingInteraction) {
      interactionTargetRef.current =
        resolveInteractionTargetEmployeeId(pendingInteraction) ??
        failedTargetEmployeeId ??
        targetKey;
      return;
    }
    interactionTargetRef.current = null;
  }, [pendingInteraction, failedTargetEmployeeId, targetKey]);

  const getScrollViewport = useCallback((): HTMLDivElement | null => {
    const viewport = scrollRef.current?.parentElement;
    return viewport instanceof HTMLDivElement ? viewport : null;
  }, []);

  useEffect(() => {
    const viewport = getScrollViewport();
    if (!viewport) return;

    const updateNearBottom = () => {
      isNearBottomRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < SCROLL_THRESHOLD;
    };

    updateNearBottom();
    viewport.addEventListener('scroll', updateNearBottom, { passive: true });
    return () => viewport.removeEventListener('scroll', updateNearBottom);
  });

  // Auto-scroll — only when user is near the bottom
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/streamContent trigger scroll
  useEffect(() => {
    const viewport = getScrollViewport();
    if (isNearBottomRef.current && viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, streamContent, streamReasoning, getScrollViewport]);

  function addMessage(targetEmployeeId: string | null, msg: ChatMessage) {
    appendMessage(getScopedConversationKey(activeThreadId, targetEmployeeId), msg);
  }

  async function handleInteractionRespond(
    selectedOptionId: string,
    freeformResponse?: string,
  ): Promise<void> {
    const pending = pendingInteraction;
    if (!pending || !respondToInteraction) return;
    const interactionTarget =
      resolveInteractionTargetEmployeeId(pending) ?? interactionTargetRef.current ?? targetKey;

    const trimmedResponse = freeformResponse?.trim();
    if (pending.kind === 'agent_question' && selectedOptionId !== 'cancel' && trimmedResponse) {
      addMessage(interactionTarget, { id: genMsgId(), role: 'user', content: trimmedResponse });
    }

    startRun(getScopedConversationKey(activeThreadId, interactionTarget));
    const response = await respondToInteraction(selectedOptionId, trimmedResponse);
    finalizeActiveRun(response);
  }

  async function handleSend(
    text: string,
    options?: { entryMode?: 'boss_chat' | 'direct_chat' | 'meeting' },
  ) {
    // Notify parent of user message (only for team chat, not direct employee chat)
    if (!selectedEmployeeId) {
      onUserMessage?.(text);
    }

    // Extract @mention hints — if exactly one mention and no explicit target, use as hint
    const mentionHints = agents ? extractMentionHints(text, agents) : [];
    const atFragments = extractAtFragments(text);
    if (atFragments.length > 0 && mentionHints.length === 0) {
      addMessage(targetKey, {
        id: genMsgId(),
        role: 'system',
        content: `No employee matches: @${atFragments.join(', @')}. Check the name and try again.`,
      });
    }
    const targetHint =
      mentionHints.length === 1 && !selectedEmployeeId ? mentionHints[0]?.employeeId : undefined;
    const resolvedTargetEmployeeId = selectedEmployeeId ?? targetHint ?? null;
    const runConversationTarget = selectedEmployeeId ? resolvedTargetEmployeeId : targetKey;
    const runConversationKey = getScopedConversationKey(activeThreadId, runConversationTarget);

    addMessage(runConversationTarget ?? null, { id: genMsgId(), role: 'user', content: text });
    startRun(runConversationKey);

    const response = await sendMessage(text, {
      entryMode: options?.entryMode,
      targetEmployeeId: resolvedTargetEmployeeId ?? undefined,
      threadId: activeThreadId ?? undefined,
      conversationKey: runConversationKey,
    });
    finalizeActiveRun(response);
  }

  async function handleRetry() {
    if (!failedConversationKey) return;
    startRun(failedConversationKey);
    const response = await retryLastMessage();
    finalizeActiveRun(response);
  }

  function handleSwapPerson(employeeId: string) {
    const sourceConversationKey = failedConversationKey ?? conversationKey;
    const allMessages = getMessages(sourceConversationKey);
    const lastUserMsg = [...allMessages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;

    clearError();

    addMessage(employeeId, { id: genMsgId(), role: 'user', content: lastUserMsg.content });
    const nextConversationKey = getScopedConversationKey(activeThreadId, employeeId);
    startRun(nextConversationKey);
    sendMessage(lastUserMsg.content, {
      targetEmployeeId: employeeId,
      threadId: activeThreadId ?? undefined,
      conversationKey: nextConversationKey,
    }).then((response) => {
      finalizeActiveRun(response);
    });
  }

  function handleSwapModel() {
    onOpenSettings();
  }

  // ── Unified command executor (replaces old handleSlashCommand) ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleSend is render-scoped; context builders use stable refs
  const executeCommand = useCallback(
    (command: ChatCommand, args: string) => {
      if (command.type === 'runtime') {
        const prompt = command.buildPrompt(args);
        handleSend(prompt, { entryMode: command.entryMode });
        return;
      }
      if (command.type === 'client') {
        const ctx: ClientCommandContext = {
          showDashboard: () => onToggleDashboard?.(),
          clearMessages: () => clearAllConversations(),
          showHelp: () => {
            const helpText = buildHelpText();
            addMessage(targetKey, { id: genMsgId(), role: 'system', content: helpText });
          },
        };
        command.execute(args, ctx);
        return;
      }
      if (command.type === 'panel') {
        const ctx: PanelCommandContext = {
          toggleDashboard: () => onToggleDashboard?.(),
          toggleKanban: () => onToggleKanban?.(),
          openSettings: () => onOpenSettings(),
          openEditor: () => onOpenEditor?.(),
          openStudio: () => onOpenStudio?.(),
        };
        command.execute(args, ctx);
      }
    },
    [
      targetKey,
      onToggleDashboard,
      onToggleKanban,
      onOpenSettings,
      onOpenEditor,
      onOpenStudio,
      clearAllConversations,
    ],
  );

  const showEmpty = messages.length === 0 && !isStreaming && !pendingInteraction;
  const isDirectChat = !!selectedEmployeeId;
  const latestMessage = messages.at(-1);
  const inputDisabledReason = !isReady
    ? 'Configure an API Key in Settings to start chatting.'
    : isRunning
      ? 'Task in progress — waiting for current round to finish.'
      : undefined;

  const inputPlaceholder = isDirectChat
    ? `Message ${selectedEmployeeName ?? 'employee'}...`
    : 'Message your team...';
  const activityRail = showActivityRail ? (
    <ActivityRail
      focusedEmployeeId={selectedEmployeeId}
      focusedEmployeeName={selectedEmployeeName}
      variant="compact"
    />
  ) : null;

  return (
    <div data-chat-panel-root className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {!isReady && (
        <div className="mx-3 mt-3 rounded-xl border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-[11px] text-amber-100">
          <div className="flex items-center justify-between gap-3">
            <span>
              Configure an API Key to enable AI collaboration. You can still browse scenes,
              templates, and editors.
            </span>
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

      {/* Project context strip — visible across team + direct chat sub-tabs. */}
      {activeProject && onRequestEditProject && (
        <ProjectContextStrip
          activeProject={activeProject}
          onRequestEdit={onRequestEditProject}
          onError={onProjectStripError}
        />
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
      {bannerMessage && (
        <ErrorBanner
          message={bannerMessage}
          onDismiss={clearError}
          onRetry={failedRunError ? handleRetry : undefined}
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
              Enter a task and watch your AI team collaborate.
            </div>
          )}
          <StreamingBubble
            content={streamContent}
            reasoning={streamReasoning}
            isStreaming={isStreaming}
            nodeName={streamNodeName}
          />
        </div>
      ) : (
        <>
          {/* Message area */}
          {showEmpty ? (
            isRunning ? (
              <ScrollArea className="flex-1 min-h-0">
                <div
                  ref={scrollRef}
                  className="flex flex-col gap-1"
                  style={{ padding: 'var(--sp-sm)' }}
                >
                  {activityRail}
                  <SystemMessageFeed />
                </div>
              </ScrollArea>
            ) : isDirectChat ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-xs text-slate-500">
                  Start a conversation with {selectedEmployeeName ?? 'this employee'}
                </p>
              </div>
            ) : (
              <div className="flex-1 min-h-0" aria-hidden="true" />
            )
          ) : (
            <ScrollArea className="flex-1 min-h-0">
              <div
                ref={scrollRef}
                className="flex flex-col gap-1"
                style={{ padding: 'var(--sp-sm)' }}
              >
                {activityRail}
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
                  <MessageBubble
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    status={msg.status}
                    nodeName={msg.nodeName}
                    reasoning={msg.reasoning}
                    deliverables={deliverablesByMessageId.get(msg.id)}
                  />
                ))}
                <StreamingBubble
                  content={streamContent}
                  reasoning={streamReasoning}
                  isStreaming={isStreaming}
                  nodeName={streamNodeName}
                />
              </div>
            </ScrollArea>
          )}
        </>
      )}

      {/* Meeting panel — shows live participants, transcript, actions, controls */}
      {!compact && showMeetingPanel && (
        <div className="shrink-0">
          <Suspense fallback={null}>
            <MeetingPanel agents={agents} />
          </Suspense>
        </div>
      )}
      {!compact && meetingState.status === 'idle' && meetingState.actions.length > 0 && (
        <div className="shrink-0">
          <Suspense fallback={null}>
            <MeetingActionItems
              actions={meetingState.actions}
              agents={agents}
              onDelegate={(text) => void handleSend(text)}
            />
          </Suspense>
        </div>
      )}
      {pendingInteraction?.severity === 'high' && pendingInteraction && respondToInteraction && (
        <InteractionPrompt
          request={pendingInteraction}
          employeeName={interactionEmployeeName}
          onRespond={handleInteractionRespond}
        />
      )}

      {/* Pipeline progress bar — 5-stage visual indicator, only visible while active */}
      {!compact && showPipelineProgress && (
        <div className="shrink-0">
          <Suspense fallback={null}>
            <PipelineProgress
              stage={pipelineStage}
              routeLabel={routeLabel}
              isRunning={isRunning}
              onAbort={abortExecution}
            />
          </Suspense>
        </div>
      )}

      {/* Starter prompt chip row — only when team-chat is empty and prompts are provided */}
      {showEmpty &&
        !isDirectChat &&
        !isRunning &&
        isReady &&
        onboardingStarterPrompts &&
        onboardingStarterPrompts.length > 0 && (
          <div
            className="shrink-0 flex flex-wrap gap-2 px-3 pb-2"
            data-testid="chat-starter-chip-row"
          >
            {onboardingStarterPrompts.slice(0, 3).map(({ label, text }) => (
              <button
                key={label}
                type="button"
                onClick={() => handleSend(text)}
                className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:text-blue-300 hover:border-blue-500/30 transition-colors"
                data-onboarding-starter-prompt={label}
              >
                {label}
              </button>
            ))}
          </div>
        )}

      {/* Input */}
      <div className="shrink-0">
        <ChatInput
          onSend={handleSend}
          onCommand={executeCommand}
          disabled={isRunning || !isReady}
          disabledReason={inputDisabledReason}
          placeholder={inputPlaceholder}
          agents={agents}
        />
      </div>
    </div>
  );
}
