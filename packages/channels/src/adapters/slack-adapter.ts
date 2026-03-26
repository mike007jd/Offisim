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

  async initialize(config: ChannelConfig): Promise<void> {
    if (!config.enabled) return;

    // TODO: Initialize Slack Bolt with Socket Mode
    // const { App } = await import('@slack/bolt');
    // this.app = new App({
    //   token: config.platformConfig.botToken,
    //   appToken: config.platformConfig.appToken,
    //   socketMode: true,
    // });
    // this.app.message(async ({ message, say }) => { ... });
    // await this.app.start();
    // Set this.connected = true after successful SDK initialization.
  }

  async reply(_channelRef: string, _message: OutboundMessage): Promise<void> {
    // TODO: Use Slack API to send/update message
    // If message.update, use chat.update
    // Otherwise, use chat.postMessage
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
