import { DEFAULT_INTERACTION_MODE } from '@offisim/shared-types';
import type { ChatAttachmentRef } from '@offisim/shared-types';
import type { InteractionRequest, ProjectRow } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { ArrowLeft, BriefcaseBusiness, Paperclip } from 'lucide-react';
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
import {
  type SendMessageResult,
  useOffisimRuntimeExecution,
  useOffisimRuntimeInteraction,
  useOffisimRuntimeServices,
  useOffisimRuntimeStatus,
} from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { useStreamingContentForConversation } from '../../runtime/use-streaming-content';
import { useCompany } from '../company/CompanyContext.js';
import { ErrorBanner } from '../error/ErrorBanner';
import { ActivityRail } from './ActivityRail';
import { ChatInput } from './ChatInput';
import type { ChatInputAttachmentPayload } from './ChatInput.js';
import { InteractionPrompt } from './InteractionPrompt';
import { MessageBubble } from './MessageBubble';
import { SessionModeChip } from './SessionModeChip';
import { StreamingBubble } from './StreamingBubble';
import { SystemMessageFeed } from './SystemMessageFeed';
import {
  persistStagedAttachments,
  rollbackPersistedAttachments,
} from './chat-attachment-pipeline.js';
import {
  type ChatMessage,
  type RunScope,
  genRunId,
  getConversationKey,
  useChatSessionStore,
} from './chat-session-store';

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
  /** Active product chat_threads.thread_id (SSOT: OfficeSessionState.selectedThreadId). */
  activeThreadId?: string | null;
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
const DIRECT_CHAT_TARGET_MISSING_ERROR =
  'Direct chat target missing — selectedEmployeeId not propagated';
const MAX_AVAILABLE_THREAD_ATTACHMENTS = 20;

function genMsgId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `msg-${crypto.randomUUID()}`
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getScopedConversationKey(
  projectId: string | null | undefined,
  threadId: string | null | undefined,
  targetEmployeeId: string | null,
): string {
  return getConversationKey({
    projectId: projectId ?? null,
    threadId: threadId ?? null,
    targetEmployeeId,
  });
}

function conversationKeyThreadId(conversationKey: string): string | null {
  const [, threadId] = conversationKey.split('::');
  return threadId && threadId !== 'unscoped' ? threadId : null;
}

function mergeAttachmentRefs(...groups: readonly ChatAttachmentRef[][]): ChatAttachmentRef[] {
  const seen = new Set<string>();
  const merged: ChatAttachmentRef[] = [];
  for (const group of groups) {
    for (const ref of group) {
      if (seen.has(ref.vaultRef)) continue;
      seen.add(ref.vaultRef);
      merged.push(ref);
    }
  }
  return merged.slice(-MAX_AVAILABLE_THREAD_ATTACHMENTS);
}

function collectThreadAttachmentRefs(
  conversations: Record<string, { messages: ChatMessage[] }>,
  threadId: string | null,
): ChatAttachmentRef[] {
  if (!threadId) return [];
  const refs: ChatAttachmentRef[] = [];
  for (const [key, conversation] of Object.entries(conversations)) {
    if (conversationKeyThreadId(key) !== threadId) continue;
    for (const message of conversation.messages) {
      if (message.role !== 'user' || !message.attachments) continue;
      refs.push(...message.attachments);
    }
  }
  return mergeAttachmentRefs(refs);
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

function resolveDirectChatTarget(
  selectedEmployeeId: string | null | undefined,
  candidateTargetEmployeeId: string | null | undefined,
): string | null {
  if (!selectedEmployeeId) return candidateTargetEmployeeId ?? null;
  if (candidateTargetEmployeeId !== selectedEmployeeId) {
    throw new Error(DIRECT_CHAT_TARGET_MISSING_ERROR);
  }
  return selectedEmployeeId;
}

function ChatContextStrip({
  project,
  attachmentCount,
}: {
  project: ProjectRow | null;
  attachmentCount: number;
}) {
  if (!project && attachmentCount === 0) return null;
  return (
    <div className="border-t border-border-default px-3 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption text-text-muted">
        {project ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle bg-surface-muted px-2 py-1">
            <BriefcaseBusiness className="h-3 w-3 shrink-0 text-text-secondary" />
            <span className="min-w-0 truncate text-text-secondary">{project.name}</span>
          </span>
        ) : null}
        {attachmentCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-muted px-2 py-1 text-text-secondary">
            <Paperclip className="h-3 w-3" />
            <span>{attachmentCount} attached</span>
          </span>
        ) : null}
      </div>
    </div>
  );
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
  activeThreadId: activeThreadIdProp,
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
    isReady,
    error,
    failedRunError,
    clearError,
    abortExecution,
  } = useOffisimRuntimeExecution();
  const { pendingInteraction, respondToInteraction, interactionMode, setInteractionMode } =
    useOffisimRuntimeInteraction();
  const { attachmentStore, eventBus } = useOffisimRuntimeServices();
  const { isRunning } = useOffisimRuntimeStatus();
  const { activeCompanyId } = useCompany();
  const errorHistory = useErrorTracking();
  const agents = useAgentStates();
  const { meetingState } = useMeeting();
  const { stage: pipelineStage, routeLabel } = usePipelineStage();
  const appendMessage = useChatSessionStore((state) => state.appendMessage);
  const startRun = useChatSessionStore((state) => state.startRun);
  const finalizeActiveRun = useChatSessionStore((state) => state.finalizeActiveRun);
  const clearActiveRun = useChatSessionStore((state) => state.clearActiveRun);
  const clearAllConversations = useChatSessionStore((state) => state.clearAllConversations);
  const getMessages = useChatSessionStore((state) => state.getMessages);
  const conversations = useChatSessionStore((state) => state.conversations);

  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const SCROLL_THRESHOLD = 80;

  const interactionTargetRef = useRef<string | null>(null);

  // Current target key
  const activeProjectId = activeProject?.project_id ?? null;
  const activeThreadId =
    activeThreadIdProp ?? (activeCompanyId ? `thread-${activeCompanyId}` : null);
  const targetKey = selectedEmployeeId ?? null;
  const conversationKey = getScopedConversationKey(activeProjectId, activeThreadId, targetKey);
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
  const availableThreadAttachments = useMemo(
    () => collectThreadAttachmentRefs(conversations, activeThreadId),
    [activeThreadId, conversations],
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

  const getScrollViewport = useCallback(
    (): HTMLDivElement | null => messagesViewportRef.current,
    [],
  );

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

  const addMessage = useCallback(
    (targetEmployeeId: string | null, msg: ChatMessage) => {
      appendMessage(
        getScopedConversationKey(activeProjectId, activeThreadId, targetEmployeeId),
        msg,
      );
    },
    [activeProjectId, activeThreadId, appendMessage],
  );

  const commitRuntimeResult = useCallback(
    (
      runScope: RunScope,
      result: SendMessageResult | undefined,
      targetEmployeeId: string | null,
    ) => {
      if (result?.kind === 'system') {
        clearActiveRun();
        addMessage(targetEmployeeId, {
          id: genMsgId(),
          role: 'system',
          content: result.content,
          status: 'completed',
        });
        return;
      }
      finalizeActiveRun(
        runScope.conversationKey,
        runScope.runId,
        result?.kind === 'assistant' ? result.content : undefined,
      );
    },
    [addMessage, clearActiveRun, finalizeActiveRun],
  );

  async function handleInteractionRespond(
    selectedOptionId: string,
    freeformResponse?: string,
  ): Promise<void> {
    const pending = pendingInteraction;
    if (!pending || !respondToInteraction) return;

    // Direct-chat safety: bubble shows globally based on `pendingInteraction`,
    // but if the user navigated into a different employee's direct chat the
    // followUp would silently route to the wrong place. Keep the existing
    // hard-error guard (uses the same resolution as the pre-refactor code).
    resolveDirectChatTarget(
      selectedEmployeeId,
      resolveInteractionTargetEmployeeId(pending) ?? interactionTargetRef.current ?? targetKey,
    );

    const trimmedResponse = freeformResponse?.trim();
    if (pending.kind === 'agent_question' && selectedOptionId !== 'cancel' && trimmedResponse) {
      addMessage(targetKey, { id: genMsgId(), role: 'user', content: trimmedResponse });
    }

    // Skill outcomes are activity/notification events, not chat messages.
    // The agent resumes under its own runtime-driven activeRun separately.
    if (pending.kind === 'skill_install_confirm') {
      const response = await respondToInteraction(selectedOptionId, trimmedResponse);
      if (response) {
        addMessage(targetKey, {
          id: genMsgId(),
          role: response.kind === 'system' ? 'system' : 'assistant',
          content: response.content,
          status: 'completed',
        });
      }
      return;
    }

    if (!activeThreadId) return;
    const runScope: RunScope = { conversationKey, runId: genRunId(), threadId: activeThreadId };
    startRun(runScope);
    const response = await respondToInteraction(selectedOptionId, trimmedResponse, { runScope });
    commitRuntimeResult(runScope, response, targetKey);
  }

  const handleSend = useCallback(
    async (
      text: string,
      options?: {
        entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
        attachments?: ChatInputAttachmentPayload;
      },
    ) => {
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
      const resolvedTargetEmployeeId = resolveDirectChatTarget(
        selectedEmployeeId,
        selectedEmployeeId ?? targetHint ?? null,
      );
      const runConversationTarget = selectedEmployeeId ? resolvedTargetEmployeeId : targetKey;
      const runConversationKey = getScopedConversationKey(
        activeProjectId,
        activeThreadId,
        runConversationTarget,
      );
      // Runtime graph_thread.thread_id is now always derived from conversationKey
      // (team chat under a thread uses `<P>::<T>::`; direct chat under a thread
      // uses `<P>::<T>::<E>` — both unique runtime threads keyed by the chat scope).
      const runThreadId = runConversationKey;

      // Persist BEFORE the user bubble lands so a partial-write failure can
      // surface inline + roll back the already-written refs (no orphan blobs).
      let persistedRefs: ChatAttachmentRef[] = [];
      if (options?.attachments && options.attachments.staged.length > 0) {
        if (!attachmentStore || !activeCompanyId || !activeThreadId) {
          addMessage(runConversationTarget ?? null, {
            id: genMsgId(),
            role: 'system',
            content: 'Cannot send attachments: chat attachment storage is not ready.',
          });
          return;
        }
        try {
          persistedRefs = await persistStagedAttachments({
            staged: options.attachments.staged,
            companyId: activeCompanyId,
            threadId: activeThreadId,
            attachmentStore,
            eventBus,
          });
        } catch (persistErr) {
          await rollbackPersistedAttachments(attachmentStore, persistedRefs);
          addMessage(runConversationTarget ?? null, {
            id: genMsgId(),
            role: 'system',
            content: `Failed to persist attachments: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
          });
          return;
        }
      }

      addMessage(runConversationTarget ?? null, {
        id: genMsgId(),
        role: 'user',
        content: text,
        ...(persistedRefs.length > 0 ? { attachments: persistedRefs } : {}),
      });
      if (!activeThreadId) return;
      const availableAttachments = mergeAttachmentRefs(availableThreadAttachments, persistedRefs);
      const runScope: RunScope = {
        conversationKey: runConversationKey,
        runId: genRunId(),
        threadId: activeThreadId,
        ...(persistedRefs.length > 0 ? { pendingAttachments: persistedRefs } : {}),
        ...(availableAttachments.length > 0 ? { availableAttachments } : {}),
      };
      startRun(runScope);

      const response = await sendMessage(text, {
        entryMode: options?.entryMode,
        targetEmployeeId: resolvedTargetEmployeeId ?? undefined,
        threadId: runThreadId,
        projectId: activeProjectId,
        conversationKey: runConversationKey,
        runScope,
      });
      commitRuntimeResult(runScope, response, runConversationTarget ?? null);
    },
    [
      activeProjectId,
      activeThreadId,
      addMessage,
      agents,
      onUserMessage,
      selectedEmployeeId,
      sendMessage,
      startRun,
      targetKey,
      attachmentStore,
      activeCompanyId,
      eventBus,
      commitRuntimeResult,
      availableThreadAttachments,
    ],
  );

  async function handleRetry() {
    if (!failedConversationKey || !activeThreadId) return;
    const runScope: RunScope = {
      conversationKey: failedConversationKey,
      runId: genRunId(),
      threadId: activeThreadId,
    };
    startRun(runScope);
    const response = await retryLastMessage({ runScope });
    commitRuntimeResult(runScope, response, targetKey);
  }

  function handleSwapPerson(employeeId: string) {
    const sourceConversationKey = failedConversationKey ?? conversationKey;
    const allMessages = getMessages(sourceConversationKey);
    const lastUserMsg = [...allMessages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;

    clearError();

    addMessage(employeeId, { id: genMsgId(), role: 'user', content: lastUserMsg.content });
    const nextConversationKey = getScopedConversationKey(
      activeProjectId,
      activeThreadId,
      employeeId,
    );
    const nextThreadId = nextConversationKey;
    if (!activeThreadId) return;
    const runScope: RunScope = {
      conversationKey: nextConversationKey,
      runId: genRunId(),
      threadId: activeThreadId,
    };
    startRun(runScope);
    sendMessage(lastUserMsg.content, {
      targetEmployeeId: employeeId,
      threadId: nextThreadId,
      projectId: activeProjectId,
      conversationKey: nextConversationKey,
      runScope,
    }).then((response) => {
      commitRuntimeResult(runScope, response, employeeId);
    });
  }

  function handleSwapModel() {
    onOpenSettings();
  }

  // ── Unified command executor (replaces old handleSlashCommand) ──
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
      addMessage,
      handleSend,
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
    <div
      data-chat-panel-root
      className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-surface-elevated text-text-primary"
    >
      {!isReady && (
        <div className="mx-3 mt-3 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-muted px-3 py-1.5 text-caption text-warning">
          <span>Configure an API key to enable AI collaboration.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenSettings}
            className="h-6 shrink-0 rounded-md border-warning/30 bg-surface px-2 py-0.5 text-caption text-warning hover:bg-surface-hover"
          >
            Settings
          </Button>
        </div>
      )}

      {/* Direct chat header — single compact line */}
      {isDirectChat && (
        <div
          className="flex h-8 items-center gap-2 border-b border-border-default"
          style={{ paddingInline: 'var(--sp-md)' }}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            className="h-auto gap-1 px-0 py-0 text-text-muted hover:text-text-primary"
          >
            <ArrowLeft className="size-3" />
            <span className="text-xs">Team</span>
          </Button>
          <span className="text-xs font-medium text-text-primary">
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
        <div className="box-border flex w-full min-w-0 max-w-full flex-1 flex-col justify-end gap-2 overflow-hidden py-2 pl-3 pr-4">
          {latestMessage ? (
            <MessageBubble role={latestMessage.role} content={latestMessage.content} />
          ) : (
            <div className="rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs text-text-muted">
              {isDirectChat
                ? `Start a conversation with ${selectedEmployeeName ?? 'this employee'}`
                : 'Enter a task to start collaborating.'}
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
              <div
                ref={messagesViewportRef}
                className="custom-scrollbar min-h-0 w-full min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-hidden"
              >
                <div
                  className="box-border flex w-full min-w-0 max-w-full flex-col gap-1 overflow-x-hidden"
                  style={{
                    paddingBottom: 'var(--sp-sm)',
                    paddingLeft: 'var(--sp-sm)',
                    paddingRight: 'var(--sp-md)',
                    paddingTop: 'var(--sp-sm)',
                  }}
                >
                  {activityRail}
                  <SystemMessageFeed />
                </div>
              </div>
            ) : isDirectChat ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-xs text-text-muted">
                  Start a conversation with {selectedEmployeeName ?? 'this employee'}
                </p>
              </div>
            ) : (
              <div className="flex-1 min-h-0" aria-hidden="true" />
            )
          ) : (
            <div
              ref={messagesViewportRef}
              className="custom-scrollbar min-h-0 w-full min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-hidden"
            >
              <div
                className="box-border flex w-full min-w-0 max-w-full flex-col gap-1 overflow-x-hidden"
                style={{
                  paddingBottom: 'var(--sp-sm)',
                  paddingLeft: 'var(--sp-sm)',
                  paddingRight: 'var(--sp-md)',
                  paddingTop: 'var(--sp-sm)',
                }}
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
                    attachments={msg.attachments}
                    attachmentStore={attachmentStore}
                  />
                ))}
                <StreamingBubble
                  content={streamContent}
                  reasoning={streamReasoning}
                  isStreaming={isStreaming}
                  nodeName={streamNodeName}
                />
              </div>
            </div>
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
              <Button
                key={label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSend(text)}
                className="rounded-full border-border-subtle bg-surface-muted px-3 py-1.5 text-xs text-text-secondary hover:border-border-focus hover:bg-accent-muted hover:text-accent-text"
                data-onboarding-starter-prompt={label}
              >
                {label}
              </Button>
            ))}
          </div>
        )}

      {/* Input */}
      <div className="shrink-0">
        {!compact ? (
          <ChatContextStrip
            project={activeProject ?? null}
            attachmentCount={availableThreadAttachments.length}
          />
        ) : null}
        <ChatInput
          onSend={handleSend}
          onCommand={executeCommand}
          disabled={isRunning || !isReady}
          disabledReason={inputDisabledReason}
          placeholder={inputPlaceholder}
          agents={agents}
          companyId={activeCompanyId ?? ''}
          threadId={activeThreadId ?? ''}
          attachmentStore={attachmentStore}
          eventBus={eventBus}
          modeChip={
            setInteractionMode ? (
              <SessionModeChip
                current={interactionMode ?? DEFAULT_INTERACTION_MODE}
                onChange={setInteractionMode}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}
