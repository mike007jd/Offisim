import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
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
  clearActiveRunStreamingContent: () => void;
  finalizeActiveRun: (finalContent?: string) => void;
  clearActiveRun: () => void;
  clearConversation: (conversationKey: string) => void;
  clearAllConversations: () => void;
  getMessages: (conversationKey: string) => ChatMessage[];
  reset: () => void;
}

export function getConversationKey(options: {
  threadId?: string | null;
  targetEmployeeId?: string | null;
}): string {
  return `${options.threadId ?? 'unscoped'}::${options.targetEmployeeId ?? 'team'}`;
}

let nextAssistantMessageId = 0;

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
        activeRun: { conversationKey, startedAt: Date.now() },
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
      if (!activeRun) return state;
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
      if (!activeRun) return state;
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
      if (!activeRun || content.length === 0) return state;
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
  clearActiveRunStreamingContent: () =>
    set((state) => {
      const activeRun = state.activeRun;
      if (!activeRun) return state;
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
      const conversation = ensureConversation(state.conversations, activeRun.conversationKey);
      const streaming = conversation.streaming;
      const resolvedContent = finalContent?.trim() || streaming?.content.trim() || '';
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
                    id: `assistant-${nextAssistantMessageId++}`,
                    role: 'assistant',
                    content: resolvedContent,
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
  reset: () => set({ activeRun: null, conversations: {} }),
}));
