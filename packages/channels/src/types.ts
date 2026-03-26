/**
 * IM Channel Integration Types.
 *
 * Enables Offisim to receive messages from external IM platforms
 * (Feishu, Slack, Telegram) and route them through the Boss.
 */

/** Inbound message from an IM platform. */
export interface InboundMessage {
  /** The text content of the message. */
  text: string;
  /** Platform-specific sender ID. */
  senderId: string;
  /** Display name of the sender (if available). */
  senderName?: string;
  /**
   * Channel reference — uniquely identifies the conversation context.
   * Format: `platform:chatId[:topicId]`
   * Examples: "feishu:oc_abc123", "slack:C01234:ts_5678"
   */
  channelRef: string;
  /** File attachments (future). */
  attachments?: ChannelAttachment[];
  /** Raw platform-specific metadata. */
  platformMeta?: Record<string, unknown>;
}

/** Outbound message to send back to the IM platform. */
export interface OutboundMessage {
  /** The text reply. */
  text: string;
  /** If true, update the previous message instead of sending new one (for streaming). */
  update?: boolean;
  /** Platform-specific message ID to update. */
  updateMessageId?: string;
}

export interface ChannelAttachment {
  type: 'file' | 'image';
  name: string;
  url?: string;
  mimeType?: string;
}

/** Configuration for a channel adapter. */
export interface ChannelConfig {
  /** Whether this channel is enabled. */
  enabled: boolean;
  /** Platform-specific configuration (tokens, webhook URLs, etc.). */
  platformConfig: Record<string, unknown>;
}

/**
 * A channel adapter handles communication with one IM platform.
 *
 * Lifecycle: initialize → onMessage (loop) → dispose
 */
export interface ChannelAdapter {
  /** Human-readable platform name (e.g., "feishu", "slack", "telegram"). */
  readonly name: string;

  /** Initialize the adapter (connect WebSocket, start polling, etc.). */
  initialize(config: ChannelConfig): Promise<void>;

  /** Register a handler for incoming messages. Returns cleanup function. */
  onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): () => void;

  /** Send a reply to a specific channel. */
  reply(channelRef: string, message: OutboundMessage): Promise<void>;

  /** Whether the adapter is currently connected and receiving messages. */
  isConnected(): boolean;

  /** Gracefully shut down. */
  dispose(): Promise<void>;
}

/** Maps channel references to company + thread IDs. */
export interface ChannelThreadMapping {
  channelRef: string;
  companyId: string;
  threadId: string;
  createdAt: string;
}
