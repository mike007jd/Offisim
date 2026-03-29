import type { ChannelConfig, OutboundMessage } from '../types.js';
import { BaseChannelAdapter } from './base-adapter.js';

/**
 * Feishu (Lark) channel adapter.
 *
 * Uses WebSocket long connection mode (飞书长连接) for desktop-friendly
 * operation — no public URL needed, works behind NAT.
 *
 * Configuration:
 * - platformConfig.appId: Feishu Bot App ID
 * - platformConfig.appSecret: Feishu Bot App Secret
 *
 * Requires: @larksuiteoapi/node-sdk (not bundled — installed at runtime)
 */
export class FeishuAdapter extends BaseChannelAdapter {
  readonly name = 'feishu';

  private unsupported(): never {
    throw new Error(
      'Feishu adapter is declared but not implemented yet. Install the Feishu SDK integration before enabling this channel.',
    );
  }

  async initialize(config: ChannelConfig): Promise<void> {
    if (!config.enabled) return;
    this.unsupported();
  }

  async reply(_channelRef: string, _message: OutboundMessage): Promise<void> {
    this.unsupported();
  }

  /**
   * @internal — Called by Feishu SDK event handler.
   * Converts Feishu event to InboundMessage and routes to handlers.
   */
  async handleIncoming(event: {
    chatId: string;
    senderId: string;
    senderName?: string;
    text: string;
  }): Promise<OutboundMessage | null> {
    return this.dispatchIncoming({
      text: event.text,
      senderId: event.senderId,
      senderName: event.senderName,
      channelRef: `feishu:${event.chatId}`,
    });
  }
}
