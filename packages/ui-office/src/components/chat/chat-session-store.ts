import { create } from 'zustand';
import { stripLegacySpeakerPrefix } from '../../lib/legacy-speaker-prefix';

export type MessageStatus = 'completed' | 'interrupted' | 'failed';

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
  /** Set to true when the run has been terminated (abort/error). Prevents double-commit. */
  isTerminated: boolean;
}

interface ChatSessionStore {
  activeRun: ActiveChatRunState | null;
  conversations: Record<string, ChatConversationState>;
  appendMessage: (conversationKey: string, message: ChatMessage) => void;
  startRun: (conversationKey: string) => void;
  setActiveRunNode: (nodeName: string | null, options?: { resetContent?: boolean }) => void;
  setActiveRunStreaming: (isStreaming: boolean) => void;
  appendStreamingChunkForActiveRun: (
    nodeName: string,
    content: string,
    channel?: 'content' | 'reasoning',
  ) => void;
  commitSpeakerSegment: (options?: { status?: MessageStatus }) => void;
  commitToolCallCheckpoint: () => void;
  terminateActiveRun: (options: { status: 'failed' | 'interrupted' }) => void;
  clearActiveRunStreamingContent: () => void;
  finalizeActiveRun: (finalContent?: string) => void;
  clearActiveRun: () => void;
  clearConversation: (conversationKey: string) => void;
  clearAllConversations: () => void;
  getMessages: (conversationKey: string) => ChatMessage[];
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

function genRunId(): string {
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

export const useChatSessionStore = create<ChatSessionStore>((set, get) => ({
  activeRun: null,
  conversations: {},
  appendMessage: (conversationKey, message) =>
    set((state) => {
      const conversation = ensureConversation(state.conversations, conversationKey);
      const stamped =
        message.createdAt === undefined ? { ...message, createdAt: Date.now() } : message;
      return {
        conversations: {
          ...state.conversations,
          [conversationKey]: {
            ...conversation,
            messages: [...conversation.messages, stamped],
          },
        },
      };
    }),
  startRun: (conversationKey) =>
    set((state) => {
      const conversation = ensureConversation(state.conversations, conversationKey);
      return {
        activeRun: {
          runId: genRunId(),
          conversationKey,
          startedAt: Date.now(),
          isTerminated: false,
        },
        conversations: {
          ...state.conversations,
          [conversationKey]: {
            ...conversation,
            streaming: conversation.streaming ?? createEmptyStreamingState(),
          },
        },
      };
    }),
  setActiveRunNode: (nodeName, options) =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.isTerminated) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous = conversation.streaming ?? createEmptyStreamingState();
      const shouldReset = options?.resetContent || previous.nodeName !== nodeName;
      return {
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            streaming: {
              nodeName,
              content: shouldReset ? '' : previous.content,
              reasoning: shouldReset ? '' : previous.reasoning,
              isStreaming: previous.isStreaming,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }),
  setActiveRunStreaming: (isStreaming) =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.isTerminated) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous = conversation.streaming ?? createEmptyStreamingState();
      return {
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            streaming: {
              ...previous,
              isStreaming,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }),
  appendStreamingChunkForActiveRun: (nodeName, content, channel = 'content') =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.isTerminated || content.length === 0) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous = conversation.streaming ?? createEmptyStreamingState(nodeName);
      const shouldReset = previous.nodeName !== nodeName;
      let nextContent = shouldReset ? '' : previous.content;
      let nextReasoning = shouldReset ? '' : previous.reasoning;
      if (channel === 'reasoning') {
        nextReasoning += content;
      } else {
        nextContent += content;
      }
      return {
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            streaming: {
              nodeName,
              content: nextContent,
              reasoning: nextReasoning,
              isStreaming: true,
              updatedAt: Date.now(),
            },
          },
        },
      };
    }),
  commitSpeakerSegment: (options) =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      if (!streaming || !streaming.content.trim()) return state;
      return {
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            messages: finalizeAssistantMessage(
              conversation.messages,
              activeRun.runId,
              {
                content: streaming.content,
                status: options?.status ?? 'completed',
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
    }),
  commitToolCallCheckpoint: () =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.isTerminated) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      if (!streaming) return state;
      const content = streaming.content.trim();
      const reasoning = streaming.reasoning.trim();
      const hasVisibleProgress = content.length > 0 || reasoning.length > 0;
      return {
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
    }),
  terminateActiveRun: (options) =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.isTerminated) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      const content = streaming?.content.trim() ?? '';
      const reasoning = streaming?.reasoning.trim() ?? '';
      const hasVisibleProgress = content.length > 0 || reasoning.length > 0;
      const shouldCommitTerminalMessage =
        !!streaming && (hasVisibleProgress || options.status === 'interrupted');
      const newMessages = shouldCommitTerminalMessage
        ? finalizeAssistantMessage(
            conversation.messages,
            activeRun.runId,
            {
              content: content || terminalContentForStatus(options.status),
              status: options.status,
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
    }),
  clearActiveRunStreamingContent: () =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.isTerminated) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const previous = conversation.streaming ?? createEmptyStreamingState();
      return {
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
    }),
  finalizeActiveRun: (finalContent) =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun) return state;
      if (activeRun.isTerminated) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      const resolvedContent = stripLegacySpeakerPrefix(
        finalContent?.trim() || streaming?.content.trim() || '',
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
    }),
  clearActiveRun: () => set({ activeRun: null }),
  clearConversation: (conversationKey) =>
    set((state) => {
      const next = { ...state.conversations };
      delete next[conversationKey];
      return {
        activeRun: state.activeRun?.conversationKey === conversationKey ? null : state.activeRun,
        conversations: next,
      };
    }),
  clearAllConversations: () => set({ activeRun: null, conversations: {} }),
  getMessages: (conversationKey) => get().conversations[conversationKey]?.messages ?? [],
  isActiveRunTerminated: () => get().activeRun?.isTerminated ?? false,
  reset: () => set({ activeRun: null, conversations: {} }),
}));
