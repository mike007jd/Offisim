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
  private adapterCleanupMap = new Map<string, () => void>();
  private messageHandler:
    | ((
        msg: InboundMessage,
        mapping: ChannelThreadMapping | null,
      ) => Promise<OutboundMessage | null>)
    | null = null;

  /**
   * Register an adapter and wire up its message handler.
   * If an adapter with the same name already exists, its cleanup and dispose
   * are called before registering the new one.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    const existing = this.adapters.get(adapter.name);
    if (existing) {
      // Clean up old adapter's message handler subscription
      const oldCleanup = this.adapterCleanupMap.get(adapter.name);
      if (oldCleanup) {
        oldCleanup();
        const idx = this.cleanupFns.indexOf(oldCleanup);
        if (idx >= 0) this.cleanupFns.splice(idx, 1);
      }
      // Dispose old adapter (fire-and-forget — don't block registration)
      existing.dispose().catch(() => {});
    }

    this.adapters.set(adapter.name, adapter);

    const cleanup = adapter.onMessage(async (msg) => {
      const mapping = this.threadMappings.get(msg.channelRef) ?? null;
      if (this.messageHandler) {
        return this.messageHandler(msg, mapping);
      }
      return null;
    });

    this.adapterCleanupMap.set(adapter.name, cleanup);
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
    this.adapterCleanupMap.clear();
    this.threadMappings.clear();
    this.messageHandler = null;
  }
}
