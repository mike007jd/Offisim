import type { ChannelAdapter, ChannelConfig, InboundMessage, OutboundMessage } from '../types.js';

/**
 * Base implementation for channel adapters.
 * Handles handler registration, incoming message dispatch, and lifecycle state.
 * Subclasses implement: initialize(), reply(), and provide platform-specific event wiring.
 */
export abstract class BaseChannelAdapter implements ChannelAdapter {
  abstract readonly name: string;
  protected connected = false;
  protected handlers: ((msg: InboundMessage) => Promise<OutboundMessage | null>)[] = [];

  abstract initialize(config: ChannelConfig): Promise<void>;
  abstract reply(channelRef: string, message: OutboundMessage): Promise<void>;

  onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  async dispose(): Promise<void> {
    this.connected = false;
    this.handlers = [];
  }

  /** Route an incoming platform message through registered handlers. */
  protected async dispatchIncoming(msg: InboundMessage): Promise<OutboundMessage | null> {
    for (const handler of this.handlers) {
      const reply = await handler(msg);
      if (reply) return reply;
    }
    return null;
  }
}
