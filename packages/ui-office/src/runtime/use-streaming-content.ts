import { useCallback } from 'react';
import {
  getConversationKey,
  type ChatToolCall,
  useChatSessionStore,
} from '../components/chat/chat-session-store.js';

export function useStreamingContent(): {
  content: string;
  reasoning: string;
  toolCalls: readonly ChatToolCall[];
  isStreaming: boolean;
  nodeName: string | null;
} {
  return useStreamingContentForConversation(
    getConversationKey({
      threadId: null,
      targetEmployeeId: null,
    }),
  );
}

export function useStreamingContentForConversation(conversationKey: string): {
  content: string;
  reasoning: string;
  toolCalls: readonly ChatToolCall[];
  isStreaming: boolean;
  nodeName: string | null;
} {
  const stream = useChatSessionStore(
    useCallback(
      (state) => state.conversations[conversationKey]?.streaming ?? null,
      [conversationKey],
    ),
  );

  return {
    content: stream?.content ?? '',
    reasoning: stream?.reasoning ?? '',
    toolCalls: stream?.toolCalls ?? [],
    isStreaming: stream?.isStreaming ?? false,
    nodeName: stream?.nodeName ?? null,
  };
}
