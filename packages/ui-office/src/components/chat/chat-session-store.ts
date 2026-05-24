import type {
  ChatAttachmentRef,
  RunScope,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { create } from 'zustand';
import { stripLegacySpeakerPrefix } from '../../lib/legacy-speaker-prefix';

export type MessageStatus = 'completed' | 'interrupted' | 'failed';

export type { RunScope };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Terminal status of the message. Undefined defaults to 'completed'. */
  status?: MessageStatus;
  /** Graph node that produced this message (e.g., 'boss', 'employee'). */
  nodeName?: string | null;
  /** Reasoning content accumulated during streaming. */
  reasoning?: string;
  /** Unix ms when the message was appended/committed. Used to correlate with deliverable events. */
  createdAt?: number;
  /** Internal assistant-turn key. All streaming/final commits for one run converge here. */
  runId?: string;
  /**
   * User-side attachment refs persisted via `AttachmentStore.write` at send
   * time. Bubble renderer re-resolves bytes from the store on demand. Empty
   * for non-attachment messages.
   */
  attachments?: ChatAttachmentRef[];
  /** Runtime tool telemetry rendered as assistant-ui native tool-call parts. */
  toolCalls?: ChatToolCall[];
}

export interface ChatToolCall {
  toolCallId: string;
  toolName: string;
  toolType: ToolExecutionTelemetryPayload['toolType'];
  status: ToolExecutionTelemetryPayload['status'];
  evidenceClass: ToolExecutionTelemetryPayload['evidenceClass'];
  startedAt: number;
  serverName?: string;
  completedAt?: number;
  durationMs?: number;
  errorType?: string;
}

export interface ChatStreamingState {
  nodeName: string | null;
  content: string;
  reasoning: string;
  toolCalls: ChatToolCall[];
  isStreaming: boolean;
  updatedAt: number;
}

interface ChatConversationState {
  messages: ChatMessage[];
  streaming: ChatStreamingState | null;
}

const CHAT_SESSION_STORAGE_KEY = 'offisim:chat-session-store:v1';
const MAX_PERSISTED_MESSAGES_PER_CONVERSATION = 200;

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeAttachmentRef(raw: unknown): ChatAttachmentRef | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw.attachmentId !== 'string' ||
    typeof raw.vaultRef !== 'string' ||
    typeof raw.filename !== 'string' ||
    typeof raw.mimeType !== 'string' ||
    typeof raw.byteLength !== 'number' ||
    typeof raw.kind !== 'string' ||
    typeof raw.parsedRev !== 'number'
  ) {
    return null;
  }
  return {
    attachmentId: raw.attachmentId,
    vaultRef: raw.vaultRef as ChatAttachmentRef['vaultRef'],
    filename: raw.filename,
    mimeType: raw.mimeType,
    byteLength: raw.byteLength,
    kind: raw.kind as ChatAttachmentRef['kind'],
    parsedRev: raw.parsedRev,
    ...(typeof raw.summary === 'string' ? { summary: raw.summary } : {}),
  };
}

function normalizeMessage(raw: unknown): ChatMessage | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    (raw.role !== 'user' && raw.role !== 'assistant' && raw.role !== 'system') ||
    typeof raw.content !== 'string'
  ) {
    return null;
  }
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.map(normalizeAttachmentRef).filter((ref): ref is ChatAttachmentRef => !!ref)
    : undefined;
  const toolCalls = Array.isArray(raw.toolCalls)
    ? raw.toolCalls.map(normalizeToolCall).filter((call): call is ChatToolCall => !!call)
    : undefined;
  const status =
    raw.status === 'completed' || raw.status === 'interrupted' || raw.status === 'failed'
      ? raw.status
      : undefined;
  return {
    id: raw.id,
    role: raw.role,
    content: raw.content,
    ...(status ? { status } : {}),
    ...(typeof raw.nodeName === 'string' || raw.nodeName === null
      ? { nodeName: raw.nodeName }
      : {}),
    ...(typeof raw.reasoning === 'string' ? { reasoning: raw.reasoning } : {}),
    ...(typeof raw.createdAt === 'number' ? { createdAt: raw.createdAt } : {}),
    ...(typeof raw.runId === 'string' ? { runId: raw.runId } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function normalizeToolCall(raw: unknown): ChatToolCall | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw.toolCallId !== 'string' ||
    typeof raw.toolName !== 'string' ||
    typeof raw.toolType !== 'string' ||
    typeof raw.status !== 'string' ||
    typeof raw.evidenceClass !== 'string' ||
    typeof raw.startedAt !== 'number'
  ) {
    return null;
  }
  return {
    toolCallId: raw.toolCallId,
    toolName: raw.toolName,
    toolType: raw.toolType as ToolExecutionTelemetryPayload['toolType'],
    status: raw.status as ToolExecutionTelemetryPayload['status'],
    evidenceClass: raw.evidenceClass as ToolExecutionTelemetryPayload['evidenceClass'],
    startedAt: raw.startedAt,
    ...(typeof raw.serverName === 'string' ? { serverName: raw.serverName } : {}),
    ...(typeof raw.completedAt === 'number' ? { completedAt: raw.completedAt } : {}),
    ...(typeof raw.durationMs === 'number' ? { durationMs: raw.durationMs } : {}),
    ...(typeof raw.errorType === 'string' ? { errorType: raw.errorType } : {}),
  };
}

function loadPersistedConversations(): Record<string, ChatConversationState> {
  if (!isBrowserStorageAvailable()) return {};
  try {
    const raw = window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !isObject(parsed.conversations)) return {};
    const conversations: Record<string, ChatConversationState> = {};
    for (const [key, value] of Object.entries(parsed.conversations)) {
      if (!isObject(value) || !Array.isArray(value.messages)) continue;
      const messages = value.messages
        .map(normalizeMessage)
        .filter((message): message is ChatMessage => !!message)
        .slice(-MAX_PERSISTED_MESSAGES_PER_CONVERSATION);
      if (messages.length === 0) continue;
      conversations[key] = { messages, streaming: null };
    }
    return conversations;
  } catch {
    return {};
  }
}

function persistConversations(conversations: Record<string, ChatConversationState>): void {
  if (!isBrowserStorageAvailable()) return;
  try {
    const entries: Array<[string, { messages: ChatMessage[] }]> = [];
    for (const [key, conversation] of Object.entries(conversations)) {
      const messages = conversation.messages.slice(-MAX_PERSISTED_MESSAGES_PER_CONVERSATION);
      if (messages.length > 0) entries.push([key, { messages }]);
    }
    const persisted = Object.fromEntries(entries);
    window.localStorage.setItem(
      CHAT_SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, conversations: persisted }),
    );
  } catch {
    // Chat history is convenience state; storage quota/private-mode failures
    // must not block live sends or attachment persistence.
  }
}

interface ActiveChatRunState {
  runId: string;
  conversationKey: string;
  threadId: string;
  startedAt: number;
}

interface ChatSessionStore {
  activeRun: ActiveChatRunState | null;
  conversations: Record<string, ChatConversationState>;
  appendMessage: (conversationKey: string, message: ChatMessage) => void;
  startRun: (scope: RunScope) => void;
  setActiveRunNode: (nodeName: string | null, options?: { resetContent?: boolean }) => void;
  setActiveRunStreaming: (isStreaming: boolean) => void;
  appendStreamingChunkForActiveRun: (
    conversationKey: string,
    runId: string,
    nodeName: string,
    content: string,
    channel?: 'content' | 'reasoning',
  ) => void;
  commitSpeakerSegment: (
    conversationKey: string,
    runId: string,
    options?: { status?: MessageStatus },
  ) => void;
  commitToolCallCheckpoint: (conversationKey: string, runId: string) => void;
  recordToolExecutionTelemetry: (
    conversationKey: string,
    runId: string,
    payload: ToolExecutionTelemetryPayload,
  ) => void;
  terminateActiveRun: (
    conversationKey: string,
    runId: string,
    options: { status: 'failed' | 'interrupted' },
  ) => void;
  clearActiveRunStreamingContent: (conversationKey: string, runId: string) => void;
  finalizeActiveRun: (conversationKey: string, runId: string, finalContent?: string) => void;
  clearActiveRun: () => void;
  clearConversation: (conversationKey: string) => void;
  clearAllConversations: () => void;
  getMessages: (conversationKey: string) => ChatMessage[];
  /** True when no run is currently active. Event handlers use this to drop late events. */
  isActiveRunTerminated: () => boolean;
  reset: () => void;
}

/**
 * Compose the runtime conversationKey: `<projectId>::<threadId>::<employeeId?>`.
 *
 * - The trailing `<employeeId>` segment is empty for team chat and present for
 *   direct chat (per `chat-streaming-ux` Direct chat partitioning Requirement).
 * - When `projectId` is null/missing, falls back to the literal `unscoped` so
 *   the parser can still split on `::` deterministically.
 */
export function getConversationKey(options: {
  projectId?: string | null;
  threadId?: string | null;
  targetEmployeeId?: string | null;
}): string {
  const project = options.projectId ?? 'unscoped';
  const thread = options.threadId ?? 'unscoped';
  const employee = options.targetEmployeeId ?? '';
  return `${project}::${thread}::${employee}`;
}

function genAssistantMessageId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `assistant-${crypto.randomUUID()}`
    : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a fresh chat-run identifier. Exposed so `ChatPanel.handleSend` can capture
 * the scope before any side effect. */
export function genRunId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `run-${crypto.randomUUID()}`
    : `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mergeDistinctText(
  existing: string | undefined,
  incoming: string | undefined,
  mode: 'append' | 'replace' = 'append',
): string | undefined {
  const normalizedIncoming = incoming?.trim();
  if (!normalizedIncoming) return existing;
  if (mode === 'replace') return normalizedIncoming;
  const normalizedExisting = existing?.trim();
  if (!normalizedExisting) return normalizedIncoming;
  if (
    normalizedExisting === normalizedIncoming ||
    normalizedExisting.includes(normalizedIncoming)
  ) {
    return normalizedExisting;
  }
  return `${normalizedExisting}\n\n${normalizedIncoming}`;
}

function finalizeAssistantMessage(
  messages: ChatMessage[],
  runId: string,
  payload: {
    content: string;
    status: MessageStatus;
    nodeName?: string | null;
    reasoning?: string | undefined;
    toolCalls?: ChatToolCall[] | undefined;
  },
  mode: 'append' | 'replace',
): ChatMessage[] {
  const sanitizedContent = stripLegacySpeakerPrefix(payload.content);
  const toolCalls = payload.toolCalls?.length ? payload.toolCalls : undefined;
  if (!sanitizedContent.trim() && !toolCalls?.length) return messages;
  const existingIndex = messages.findIndex(
    (message) => message.role === 'assistant' && message.runId === runId,
  );
  if (existingIndex === -1) {
    return [
      ...messages,
      {
        id: genAssistantMessageId(),
        role: 'assistant',
        content: sanitizedContent.trim(),
        status: payload.status,
        nodeName: payload.nodeName,
        reasoning: payload.reasoning || undefined,
        toolCalls,
        createdAt: Date.now(),
        runId,
      },
    ];
  }

  const next = [...messages];
  const existing = next[existingIndex];
  if (!existing) return messages;
  next[existingIndex] = {
    ...existing,
    content: mergeDistinctText(existing.content, sanitizedContent, mode) ?? '',
    status: payload.status,
    nodeName: payload.nodeName ?? existing.nodeName,
    reasoning: mergeDistinctText(existing.reasoning, payload.reasoning),
    toolCalls: mergeToolCalls(existing.toolCalls, toolCalls),
  };
  return next;
}

function mergeToolCalls(
  existing: ChatToolCall[] | undefined,
  incoming: ChatToolCall[] | undefined,
): ChatToolCall[] | undefined {
  if (!incoming?.length) return existing;
  const byId = new Map<string, ChatToolCall>();
  for (const call of existing ?? []) byId.set(call.toolCallId, call);
  for (const call of incoming) byId.set(call.toolCallId, { ...byId.get(call.toolCallId), ...call });
  return [...byId.values()];
}

function terminalContentForStatus(status: 'failed' | 'interrupted'): string {
  return status === 'interrupted'
    ? 'Run interrupted before final response.'
    : 'Run failed before final response.';
}

function createEmptyStreamingState(nodeName: string | null = null): ChatStreamingState {
  return {
    nodeName,
    content: '',
    reasoning: '',
    toolCalls: [],
    isStreaming: false,
    updatedAt: Date.now(),
  };
}

function toolCallFromTelemetry(payload: ToolExecutionTelemetryPayload): ChatToolCall {
  return {
    toolCallId: payload.toolCallId,
    toolName: payload.toolName,
    toolType: payload.toolType,
    status: payload.status,
    evidenceClass: payload.evidenceClass,
    startedAt: payload.startedAt,
    ...(payload.serverName ? { serverName: payload.serverName } : {}),
    ...(payload.completedAt ? { completedAt: payload.completedAt } : {}),
    ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
    ...(payload.errorType ? { errorType: payload.errorType } : {}),
  };
}

function hasVisibleStreamingProgress(streaming: ChatStreamingState): boolean {
  return (
    streaming.content.trim().length > 0 ||
    streaming.reasoning.trim().length > 0 ||
    streaming.toolCalls.length > 0
  );
}

function ensureConversation(
  conversations: Record<string, ChatConversationState>,
  conversationKey: string,
): ChatConversationState {
  return conversations[conversationKey] ?? { messages: [], streaming: null };
}

/** Run-scoped action read of the active run; returns null when caller's scope
 * does not match the current activeRun (or when no run is active). */
function activeRunMatchingScope(
  state: ChatSessionDataState,
  conversationKey: string,
  runId: string,
): ActiveChatRunState | null {
  const active = state.activeRun;
  if (!active) return null;
  if (active.runId !== runId) return null;
  if (active.conversationKey !== conversationKey) return null;
  return active;
}

type ChatSessionDataState = Pick<ChatSessionStore, 'activeRun' | 'conversations'>;

type ChatSessionAction =
  | { type: 'appendMessage'; conversationKey: string; message: ChatMessage }
  | { type: 'startRun'; scope: RunScope }
  | {
      type: 'setActiveRunNode';
      nodeName: string | null;
      options?: { resetContent?: boolean };
    }
  | { type: 'setActiveRunStreaming'; isStreaming: boolean }
  | {
      type: 'appendStreamingChunkForActiveRun';
      conversationKey: string;
      runId: string;
      nodeName: string;
      content: string;
      channel: 'content' | 'reasoning';
    }
  | {
      type: 'commitSpeakerSegment';
      conversationKey: string;
      runId: string;
      options?: { status?: MessageStatus };
    }
  | { type: 'commitToolCallCheckpoint'; conversationKey: string; runId: string }
  | {
      type: 'recordToolExecutionTelemetry';
      conversationKey: string;
      runId: string;
      payload: ToolExecutionTelemetryPayload;
    }
  | {
      type: 'terminateActiveRun';
      conversationKey: string;
      runId: string;
      status: 'failed' | 'interrupted';
    }
  | { type: 'clearActiveRunStreamingContent'; conversationKey: string; runId: string }
  | { type: 'finalizeActiveRun'; conversationKey: string; runId: string; finalContent?: string }
  | { type: 'clearActiveRun' }
  | { type: 'clearConversation'; conversationKey: string }
  | { type: 'clearAllConversations' };

function reduceChatSession(
  state: ChatSessionDataState,
  action: ChatSessionAction,
): ChatSessionDataState {
  switch (action.type) {
    case 'appendMessage': {
      const conversation = ensureConversation(state.conversations, action.conversationKey);
      const stamped =
        action.message.createdAt === undefined
          ? { ...action.message, createdAt: Date.now() }
          : action.message;
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [action.conversationKey]: {
            ...conversation,
            messages: [...conversation.messages, stamped],
          },
        },
      };
    }
    case 'startRun': {
      const conversation = ensureConversation(state.conversations, action.scope.conversationKey);
      return {
        activeRun: {
          runId: action.scope.runId,
          conversationKey: action.scope.conversationKey,
          threadId: action.scope.threadId,
          startedAt: Date.now(),
        },
        conversations: {
          ...state.conversations,
          [action.scope.conversationKey]: {
            ...conversation,
            streaming: conversation.streaming ?? createEmptyStreamingState(),
          },
        },
      };
    }
    case 'setActiveRunNode': {
      const activeRun = state.activeRun;
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous = conversation.streaming ?? createEmptyStreamingState();
      const shouldReset = action.options?.resetContent || previous.nodeName !== action.nodeName;
      if (!shouldReset && conversation.streaming) return state;
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            streaming: {
              nodeName: action.nodeName,
              content: shouldReset ? '' : previous.content,
              reasoning: shouldReset ? '' : previous.reasoning,
              toolCalls: shouldReset ? [] : previous.toolCalls,
              isStreaming: previous.isStreaming,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }
    case 'setActiveRunStreaming': {
      const activeRun = state.activeRun;
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous = conversation.streaming ?? createEmptyStreamingState();
      if (previous.isStreaming === action.isStreaming && conversation.streaming) return state;
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            streaming: {
              ...previous,
              isStreaming: action.isStreaming,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }
    case 'appendStreamingChunkForActiveRun': {
      const activeRun = activeRunMatchingScope(state, action.conversationKey, action.runId);
      if (!activeRun || action.content.length === 0) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous = conversation.streaming ?? createEmptyStreamingState(action.nodeName);
      const shouldReset = previous.nodeName !== action.nodeName;
      let nextContent = shouldReset ? '' : previous.content;
      let nextReasoning = shouldReset ? '' : previous.reasoning;
      const nextToolCalls = shouldReset ? [] : previous.toolCalls;
      if (action.channel === 'reasoning') {
        nextReasoning += action.content;
      } else {
        nextContent += action.content;
      }
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            streaming: {
              nodeName: action.nodeName,
              content: nextContent,
              reasoning: nextReasoning,
              toolCalls: nextToolCalls,
              isStreaming: true,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }
    case 'commitSpeakerSegment': {
      const activeRun = activeRunMatchingScope(state, action.conversationKey, action.runId);
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      if (!streaming || !hasVisibleStreamingProgress(streaming)) return state;
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            messages: finalizeAssistantMessage(
              conversation.messages,
              activeRun.runId,
              {
                content: streaming.content,
                status: action.options?.status ?? 'completed',
                nodeName: streaming.nodeName,
                reasoning: streaming.reasoning || undefined,
                toolCalls: streaming.toolCalls,
              },
              'append',
            ),
            streaming: {
              ...streaming,
              content: '',
              reasoning: '',
              toolCalls: [],
              updatedAt: Date.now(),
            },
          },
        },
      };
    }
    case 'commitToolCallCheckpoint': {
      const activeRun = activeRunMatchingScope(state, action.conversationKey, action.runId);
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      if (!streaming) return state;
      const content = streaming.content.trim();
      const hasVisibleProgress = hasVisibleStreamingProgress(streaming);
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            messages: hasVisibleProgress
              ? finalizeAssistantMessage(
                  conversation.messages,
                  activeRun.runId,
                  {
                    content: content || 'Waiting for your input to continue.',
                    status: 'completed',
                    nodeName: streaming.nodeName,
                    reasoning: streaming.reasoning || undefined,
                    toolCalls: streaming.toolCalls,
                  },
                  'append',
                )
              : conversation.messages,
            streaming: {
              ...streaming,
              content: '',
              reasoning: '',
              toolCalls: [],
              isStreaming: false,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }
    case 'recordToolExecutionTelemetry': {
      const activeRun = activeRunMatchingScope(state, action.conversationKey, action.runId);
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous =
        conversation.streaming ?? createEmptyStreamingState(action.payload.nodeName ?? null);
      const nextToolCalls = mergeToolCalls(previous.toolCalls, [
        toolCallFromTelemetry(action.payload),
      ]) ?? [];
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            streaming: {
              ...previous,
              nodeName: action.payload.nodeName ?? previous.nodeName,
              toolCalls: nextToolCalls,
              isStreaming: action.payload.status === 'started' ? true : previous.isStreaming,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }
    case 'terminateActiveRun': {
      const activeRun = activeRunMatchingScope(state, action.conversationKey, action.runId);
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      const content = streaming?.content.trim() ?? '';
      const reasoning = streaming?.reasoning.trim() ?? '';
      const hasVisibleProgress =
        content.length > 0 || reasoning.length > 0 || (streaming?.toolCalls.length ?? 0) > 0;
      const shouldCommitTerminalMessage =
        !!streaming && (hasVisibleProgress || action.status === 'interrupted');
      const newMessages = shouldCommitTerminalMessage
        ? finalizeAssistantMessage(
            conversation.messages,
            activeRun.runId,
            {
              content: content || terminalContentForStatus(action.status),
              status: action.status,
              nodeName: streaming.nodeName,
              reasoning: streaming.reasoning || undefined,
              toolCalls: streaming.toolCalls,
            },
            'append',
          )
        : conversation.messages;
      return {
        activeRun: null,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            messages: newMessages,
            streaming: null,
          },
        },
      };
    }
    case 'clearActiveRunStreamingContent': {
      const activeRun = activeRunMatchingScope(state, action.conversationKey, action.runId);
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous = conversation.streaming ?? createEmptyStreamingState();
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            streaming: {
              ...previous,
              content: '',
              reasoning: '',
              toolCalls: [],
              isStreaming: true,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }
    case 'finalizeActiveRun': {
      const activeRun = activeRunMatchingScope(state, action.conversationKey, action.runId);
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      const resolvedContent = stripLegacySpeakerPrefix(
        action.finalContent?.trim() || streaming?.content.trim() || '',
      );
      return {
        activeRun: null,
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            messages: finalizeAssistantMessage(
              conversation.messages,
              activeRun.runId,
              {
                content: resolvedContent,
                status: 'completed',
                nodeName: streaming?.nodeName,
                reasoning: streaming?.reasoning || undefined,
                toolCalls: streaming?.toolCalls,
              },
              'replace',
            ),
            streaming: null,
          },
        },
      };
    }
    case 'clearActiveRun':
      return { ...state, activeRun: null };
    case 'clearConversation': {
      const next = { ...state.conversations };
      delete next[action.conversationKey];
      return {
        activeRun:
          state.activeRun?.conversationKey === action.conversationKey ? null : state.activeRun,
        conversations: next,
      };
    }
    case 'clearAllConversations':
      return { activeRun: null, conversations: {} };
  }
}

function reduceChatSessionWithPersistence(
  state: ChatSessionDataState,
  action: ChatSessionAction,
): ChatSessionDataState {
  const next = reduceChatSession(state, action);
  persistConversations(next.conversations);
  return next;
}

export const useChatSessionStore = create<ChatSessionStore>((set, get) => ({
  activeRun: null,
  conversations: loadPersistedConversations(),
  appendMessage: (conversationKey, message) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, { type: 'appendMessage', conversationKey, message }),
    ),
  startRun: (scope) =>
    set((state) => reduceChatSessionWithPersistence(state, { type: 'startRun', scope })),
  setActiveRunNode: (nodeName, options) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, { type: 'setActiveRunNode', nodeName, options }),
    ),
  setActiveRunStreaming: (isStreaming) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, { type: 'setActiveRunStreaming', isStreaming }),
    ),
  appendStreamingChunkForActiveRun: (
    conversationKey,
    runId,
    nodeName,
    content,
    channel = 'content',
  ) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, {
        type: 'appendStreamingChunkForActiveRun',
        conversationKey,
        runId,
        nodeName,
        content,
        channel,
      }),
    ),
  commitSpeakerSegment: (conversationKey, runId, options) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, {
        type: 'commitSpeakerSegment',
        conversationKey,
        runId,
        options,
      }),
    ),
  commitToolCallCheckpoint: (conversationKey, runId) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, {
        type: 'commitToolCallCheckpoint',
        conversationKey,
        runId,
      }),
    ),
  recordToolExecutionTelemetry: (conversationKey, runId, payload) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, {
        type: 'recordToolExecutionTelemetry',
        conversationKey,
        runId,
        payload,
      }),
    ),
  terminateActiveRun: (conversationKey, runId, options) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, {
        type: 'terminateActiveRun',
        conversationKey,
        runId,
        status: options.status,
      }),
    ),
  clearActiveRunStreamingContent: (conversationKey, runId) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, {
        type: 'clearActiveRunStreamingContent',
        conversationKey,
        runId,
      }),
    ),
  finalizeActiveRun: (conversationKey, runId, finalContent) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, {
        type: 'finalizeActiveRun',
        conversationKey,
        runId,
        finalContent,
      }),
    ),
  clearActiveRun: () =>
    set((state) => reduceChatSessionWithPersistence(state, { type: 'clearActiveRun' })),
  clearConversation: (conversationKey) =>
    set((state) =>
      reduceChatSessionWithPersistence(state, { type: 'clearConversation', conversationKey }),
    ),
  clearAllConversations: () =>
    set((state) => reduceChatSessionWithPersistence(state, { type: 'clearAllConversations' })),
  getMessages: (conversationKey) => get().conversations[conversationKey]?.messages ?? [],
  isActiveRunTerminated: () => get().activeRun === null,
  reset: () => set((state) => reduceChatSession(state, { type: 'clearAllConversations' })),
}));
