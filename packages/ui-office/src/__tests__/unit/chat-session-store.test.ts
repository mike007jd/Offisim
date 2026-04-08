import { describe, expect, it } from 'vitest';
import {
  getConversationKey,
  useChatSessionStore,
} from '../../components/chat/chat-session-store.js';

describe('chat-session-store streaming lifecycle', () => {
  it('finalizes a streamed assistant reply into exactly one persisted message', () => {
    const store = useChatSessionStore.getState();
    store.reset();

    const conversationKey = getConversationKey({
      threadId: 'thread-1',
      targetEmployeeId: null,
    });

    useChatSessionStore.getState().startRun(conversationKey);
    useChatSessionStore.getState().appendStreamingChunkForActiveRun('boss', 'Hello');
    useChatSessionStore.getState().appendStreamingChunkForActiveRun('boss', ' world');
    useChatSessionStore.getState().finalizeActiveRun('Hello world');

    const conversation = useChatSessionStore.getState().conversations[conversationKey];
    expect(conversation?.streaming).toBeNull();
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Hello world',
    });
  });

  it('keeps streaming state isolated per conversation key', () => {
    const store = useChatSessionStore.getState();
    store.reset();

    const alpha = getConversationKey({ threadId: 'thread-alpha', targetEmployeeId: null });
    const beta = getConversationKey({ threadId: 'thread-beta', targetEmployeeId: 'emp-2' });

    useChatSessionStore.getState().startRun(alpha);
    useChatSessionStore.getState().appendStreamingChunkForActiveRun('employee', 'Draft A');

    useChatSessionStore.getState().startRun(beta);
    useChatSessionStore.getState().appendStreamingChunkForActiveRun('employee', 'Draft B');

    expect(useChatSessionStore.getState().conversations[alpha]?.streaming?.content).toBe('Draft A');
    expect(useChatSessionStore.getState().conversations[beta]?.streaming?.content).toBe('Draft B');
  });
});
