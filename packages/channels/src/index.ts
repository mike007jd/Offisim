// @offisim/channels — IM Channel Integration

export type {
  ChannelAdapter,
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
  ChannelAttachment,
  ChannelThreadMapping,
} from './types.js';

export { ChannelMessageBus } from './message-bus.js';
export { BaseChannelAdapter } from './adapters/base-adapter.js';
export { FeishuAdapter } from './adapters/feishu-adapter.js';
export { SlackAdapter } from './adapters/slack-adapter.js';
