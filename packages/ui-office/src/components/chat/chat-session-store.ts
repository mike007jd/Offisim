import type { RunScope } from '@offisim/shared-types';
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
}

export interface ChatStreamingState {
  nodeName: string | null;
  content: string;
  reasoning: string;
  isStreaming: boolean;
  updatedAt: number;
}

interface ChatConversationState {
  messages: ChatMessage[];
  streaming: ChatStreamingState | null;
}

interface ActiveChatRunState {
  runId: string;
  conversationKey: string;
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

export function getConversationKey(options: {
  threadId?: string | null;
  targetEmployeeId?: string | null;
}): string {
  return `${options.threadId ?? 'unscoped'}::${options.targetEmployeeId ?? 'team'}`;
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
  },
  mode: 'append' | 'replace',
): ChatMessage[] {
  const sanitizedContent = stripLegacySpeakerPrefix(payload.content);
  if (!sanitizedContent.trim()) return messages;
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
  };
  return next;
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
    isStreaming: false,
    updatedAt: Date.now(),
  };
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
      if (!streaming || !streaming.content.trim()) return state;
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
              },
              'append',
            ),
            streaming: {
              ...streaming,
              content: '',
              reasoning: '',
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
      const reasoning = streaming.reasoning.trim();
      const hasVisibleProgress = content.length > 0 || reasoning.length > 0;
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
                  },
                  'append',
                )
              : conversation.messages,
            streaming: {
              ...streaming,
              content: '',
              reasoning: '',
              isStreaming: false,
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
      const hasVisibleProgress = content.length > 0 || reasoning.length > 0;
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

export const useChatSessionStore = create<ChatSessionStore>((set, get) => ({
  activeRun: null,
  conversations: {},
  appendMessage: (conversationKey, message) =>
    set((state) => reduceChatSession(state, { type: 'appendMessage', conversationKey, message })),
  startRun: (scope) =>
    set((state) => reduceChatSession(state, { type: 'startRun', scope })),
  setActiveRunNode: (nodeName, options) =>
    set((state) => reduceChatSession(state, { type: 'setActiveRunNode', nodeName, options })),
  setActiveRunStreaming: (isStreaming) =>
    set((state) => reduceChatSession(state, { type: 'setActiveRunStreaming', isStreaming })),
  appendStreamingChunkForActiveRun: (conversationKey, runId, nodeName, content, channel = 'content') =>
    set((state) =>
      reduceChatSession(state, {
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
      reduceChatSession(state, { type: 'commitSpeakerSegment', conversationKey, runId, options }),
    ),
  commitToolCallCheckpoint: (conversationKey, runId) =>
    set((state) =>
      reduceChatSession(state, { type: 'commitToolCallCheckpoint', conversationKey, runId }),
    ),
  terminateActiveRun: (conversationKey, runId, options) =>
    set((state) =>
      reduceChatSession(state, {
        type: 'terminateActiveRun',
        conversationKey,
        runId,
        status: options.status,
      }),
    ),
  clearActiveRunStreamingContent: (conversationKey, runId) =>
    set((state) =>
      reduceChatSession(state, { type: 'clearActiveRunStreamingContent', conversationKey, runId }),
    ),
  finalizeActiveRun: (conversationKey, runId, finalContent) =>
    set((state) =>
      reduceChatSession(state, { type: 'finalizeActiveRun', conversationKey, runId, finalContent }),
    ),
  clearActiveRun: () => set((state) => reduceChatSession(state, { type: 'clearActiveRun' })),
  clearConversation: (conversationKey) =>
    set((state) => reduceChatSession(state, { type: 'clearConversation', conversationKey })),
  clearAllConversations: () =>
    set((state) => reduceChatSession(state, { type: 'clearAllConversations' })),
  getMessages: (conversationKey) => get().conversations[conversationKey]?.messages ?? [],
  isActiveRunTerminated: () => get().activeRun === null,
  reset: () => set((state) => reduceChatSession(state, { type: 'clearAllConversations' })),
}));
