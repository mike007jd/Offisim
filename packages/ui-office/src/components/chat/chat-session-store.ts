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
      return {
        conversations: {
          ...state.conversations,
          [conversationKey]: {
            ...conversation,
            messages: [...conversation.messages, message],
          },
        },
      };
    }),
  startRun: (conversationKey) =>
    set((state) => {
      const conversation = ensureConversation(state.conversations, conversationKey);
      return {
        activeRun: { conversationKey, startedAt: Date.now(), isTerminated: false },
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
      const nextContent =
        channel === 'reasoning'
          ? shouldReset
            ? ''
            : previous.content
          : `${shouldReset ? '' : previous.content}${content}`;
      const nextReasoning =
        channel === 'reasoning'
          ? `${shouldReset ? '' : previous.reasoning}${content}`
          : shouldReset
            ? ''
            : previous.reasoning;
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
      const sanitizedContent = stripLegacySpeakerPrefix(streaming.content);
      const committedMessage: ChatMessage = {
        id: genAssistantMessageId(),
        role: 'assistant',
        content: sanitizedContent,
        status: options?.status ?? 'completed',
        nodeName: streaming.nodeName,
        reasoning: streaming.reasoning || undefined,
      };
      return {
        conversations: {
          ...state.conversations,
          [activeRun.conversationKey]: {
            ...conversation,
            messages: [...conversation.messages, committedMessage],
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
  terminateActiveRun: (options) =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.isTerminated) return state;
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      const content = streaming?.content.trim() ?? '';
      const sanitizedContent = content.length > 0 ? stripLegacySpeakerPrefix(streaming!.content) : '';
      const newMessages =
        content.length > 0
          ? [
              ...conversation.messages,
              {
                id: genAssistantMessageId(),
                role: 'assistant' as const,
                content: sanitizedContent,
                status: options.status,
                nodeName: streaming!.nodeName,
                reasoning: streaming!.reasoning || undefined,
              },
            ]
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
            messages: resolvedContent
              ? [
                  ...conversation.messages,
                  {
                    id: genAssistantMessageId(),
                    role: 'assistant',
                    content: resolvedContent,
                    status: 'completed',
                    nodeName: streaming?.nodeName,
                    reasoning: streaming?.reasoning || undefined,
                  },
                ]
              : conversation.messages,
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
