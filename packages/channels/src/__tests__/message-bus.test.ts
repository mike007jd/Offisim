import { describe, expect, it } from 'vitest';
import { ChannelMessageBus } from '../message-bus.js';
import type { ChannelAdapter, ChannelConfig, InboundMessage, OutboundMessage } from '../types.js';

/** Minimal mock adapter for testing. */
class MockAdapter implements ChannelAdapter {
  readonly name: string;
  private handlers: ((msg: InboundMessage) => Promise<OutboundMessage | null>)[] = [];
  private _connected = false;
  replies: { channelRef: string; message: OutboundMessage }[] = [];

  constructor(name = 'mock') {
    this.name = name;
  }

  async initialize(_config: ChannelConfig): Promise<void> {
    this._connected = true;
  }

  onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  async reply(channelRef: string, message: OutboundMessage): Promise<void> {
    this.replies.push({ channelRef, message });
  }

  isConnected(): boolean {
    return this._connected;
  }

  async dispose(): Promise<void> {
    this._connected = false;
    this.handlers = [];
  }

  /** Simulate an incoming message */
  async simulateIncoming(msg: InboundMessage): Promise<OutboundMessage | null> {
    for (const handler of this.handlers) {
      const reply = await handler(msg);
      if (reply) return reply;
    }
    return null;
  }
}

describe('ChannelMessageBus', () => {
  it('routes inbound messages to the handler', async () => {
    const bus = new ChannelMessageBus();
    const adapter = new MockAdapter();

    bus.registerAdapter(adapter);
    bus.setMessageHandler(async (msg) => ({
      text: `Echo: ${msg.text}`,
    }));

    const reply = await adapter.simulateIncoming({
      text: 'Hello',
      senderId: 'user-1',
      channelRef: 'mock:chat-1',
    });

    expect(reply).toEqual({ text: 'Echo: Hello' });
  });

  it('provides thread mapping to handler', async () => {
    const bus = new ChannelMessageBus();
    const adapter = new MockAdapter();

    bus.registerAdapter(adapter);
    bus.mapThread('mock:chat-1', 'company-1', 'thread-1');

    let receivedMapping: unknown = undefined;
    bus.setMessageHandler(async (_msg, mapping) => {
      receivedMapping = mapping;
      return { text: 'ok' };
    });

    await adapter.simulateIncoming({
      text: 'test',
      senderId: 'user-1',
      channelRef: 'mock:chat-1',
    });

    expect(receivedMapping).toEqual({
      channelRef: 'mock:chat-1',
      companyId: 'company-1',
      threadId: 'thread-1',
      createdAt: expect.any(String),
    });
  });

  it('returns null mapping for unmapped channels', async () => {
    const bus = new ChannelMessageBus();
    const adapter = new MockAdapter();

    bus.registerAdapter(adapter);

    let receivedMapping: unknown = 'not-set';
    bus.setMessageHandler(async (_msg, mapping) => {
      receivedMapping = mapping;
      return { text: 'ok' };
    });

    await adapter.simulateIncoming({
      text: 'test',
      senderId: 'user-1',
      channelRef: 'mock:unknown-chat',
    });

    expect(receivedMapping).toBeNull();
  });

  it('manages multiple adapters', () => {
    const bus = new ChannelMessageBus();
    bus.registerAdapter(new MockAdapter('feishu'));
    bus.registerAdapter(new MockAdapter('slack'));

    expect(bus.getAdapterNames()).toEqual(['feishu', 'slack']);
    expect(bus.getAdapter('feishu')?.name).toBe('feishu');
    expect(bus.getAdapter('slack')?.name).toBe('slack');
  });

  it('dispose cleans up all adapters', async () => {
    const bus = new ChannelMessageBus();
    const adapter = new MockAdapter();
    await adapter.initialize({ enabled: true, platformConfig: {} });

    bus.registerAdapter(adapter);
    expect(adapter.isConnected()).toBe(true);

    await bus.dispose();
    expect(adapter.isConnected()).toBe(false);
    expect(bus.getAdapterNames()).toEqual([]);
  });

  it('returns null when no message handler is set', async () => {
    const bus = new ChannelMessageBus();
    const adapter = new MockAdapter();
    bus.registerAdapter(adapter);

    const reply = await adapter.simulateIncoming({
      text: 'test',
      senderId: 'user-1',
      channelRef: 'mock:chat-1',
    });

    expect(reply).toBeNull();
  });
});
