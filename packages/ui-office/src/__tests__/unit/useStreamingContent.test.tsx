import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getConversationKey, useChatSessionStore } from '../../components/chat/chat-session-store.js';
import { useStreamingContentForConversation } from '../../runtime/use-streaming-content';

describe('useStreamingContent', () => {
  it('returns empty state when the selected conversation has no stream', () => {
    useChatSessionStore.getState().reset();
    const conversationKey = getConversationKey({ threadId: 'thread-1', targetEmployeeId: null });
    const { result } = renderHook(() => useStreamingContentForConversation(conversationKey));

    expect(result.current).toEqual({
      content: '',
      reasoning: '',
      isStreaming: false,
      nodeName: null,
    });
  });

  it('returns the selected conversation stream snapshot', () => {
    useChatSessionStore.getState().reset();
    const conversationKey = getConversationKey({ threadId: 'thread-1', targetEmployeeId: 'emp-1' });
    useChatSessionStore.getState().startRun(conversationKey);
    useChatSessionStore.getState().appendStreamingChunkForActiveRun('employee', 'Let me check');

    const { result } = renderHook(() => useStreamingContentForConversation(conversationKey));

    expect(result.current).toEqual({
      content: 'Let me check',
      reasoning: '',
      isStreaming: true,
      nodeName: 'employee',
    });
  });
});
