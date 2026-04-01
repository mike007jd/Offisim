import type {
  ChannelAdapter,
  ChannelThreadMapping,
  InboundMessage,
  OutboundMessage,
} from './types.js';

/**
 * Central message bus that routes inbound IM messages to the Offisim runtime
 * and sends responses back.
 *
 * Acts as the bridge between IM adapters and OrchestrationService.
 */
export class ChannelMessageBus {
  private adapters = new Map<string, ChannelAdapter>();
  private threadMappings = new Map<string, ChannelThreadMapping>();
  private cleanupFns: (() => void)[] = [];
  private messageHandler:
    | ((
        msg: InboundMessage,
        mapping: ChannelThreadMapping | null,
      ) => Promise<OutboundMessage | null>)
    | null = null;

  /**
   * Register an adapter and wire up its message handler.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter);

    const cleanup = adapter.onMessage(async (msg) => {
      const mapping = this.threadMappings.get(msg.channelRef) ?? null;
      if (this.messageHandler) {
        return this.messageHandler(msg, mapping);
      }
      return null;
    });

    this.cleanupFns.push(cleanup);
  }

  /**
   * Set the handler that processes inbound messages.
   * Typically wired to OrchestrationService.execute().
   */
  setMessageHandler(
    handler: (
      msg: InboundMessage,
      mapping: ChannelThreadMapping | null,
    ) => Promise<OutboundMessage | null>,
  ): void {
    this.messageHandler = handler;
  }

  /**
   * Register or update a thread mapping.
   */
  mapThread(channelRef: string, companyId: string, threadId: string): void {
    this.threadMappings.set(channelRef, {
      channelRef,
      companyId,
      threadId,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Look up the thread mapping for a channel reference.
   */
  getMapping(channelRef: string): ChannelThreadMapping | null {
    return this.threadMappings.get(channelRef) ?? null;
  }

  /**
   * Get a registered adapter by name.
   */
  getAdapter(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * Get all registered adapter names.
   */
  getAdapterNames(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Dispose all adapters and clean up.
   */
  async dispose(): Promise<void> {
    for (const fn of this.cleanupFns) {
      fn();
    }
    this.cleanupFns = [];

    // Dispose all adapters concurrently — don't let one stuck adapter block others
    await Promise.allSettled([...this.adapters.values()].map((a) => a.dispose()));
    this.adapters.clear();
    this.threadMappings.clear();
    this.messageHandler = null;
  }
}
