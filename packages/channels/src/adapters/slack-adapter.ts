import type { ChannelConfig, OutboundMessage } from '../types.js';
import { BaseChannelAdapter } from './base-adapter.js';

/**
 * Slack channel adapter.
 *
 * Uses Socket Mode for desktop-friendly operation — no public URL needed.
 * Slack Socket Mode uses WebSocket to receive events directly.
 *
 * Configuration:
 * - platformConfig.botToken: Slack Bot OAuth Token (xoxb-...)
 * - platformConfig.appToken: Slack App-Level Token (xapp-...) for Socket Mode
 *
 * Requires: @slack/bolt (not bundled — installed at runtime)
 */
export class SlackAdapter extends BaseChannelAdapter {
  readonly name = 'slack';

  private unsupported(): never {
    throw new Error(
      'Slack adapter is declared but not implemented yet. Install the Slack SDK integration before enabling this channel.',
    );
  }

  async initialize(config: ChannelConfig): Promise<void> {
    if (!config.enabled) return;
    this.unsupported();
  }

  async reply(_channelRef: string, _message: OutboundMessage): Promise<void> {
    this.unsupported();
  }

  /** @internal */
  async handleIncoming(event: {
    channel: string;
    user: string;
    text: string;
    threadTs?: string;
  }): Promise<OutboundMessage | null> {
    const channelRef = event.threadTs
      ? `slack:${event.channel}:${event.threadTs}`
      : `slack:${event.channel}`;

    return this.dispatchIncoming({
      text: event.text,
      senderId: event.user,
      channelRef,
    });
  }
}
