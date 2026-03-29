import { describe, expect, it } from 'vitest';
import { FeishuAdapter } from '../adapters/feishu-adapter.js';
import { SlackAdapter } from '../adapters/slack-adapter.js';

describe('channel adapter guardrails', () => {
  it('allows disabled adapters to initialize without throwing', async () => {
    await expect(
      new SlackAdapter().initialize({ enabled: false, platformConfig: {} }),
    ).resolves.toBeUndefined();
    await expect(
      new FeishuAdapter().initialize({ enabled: false, platformConfig: {} }),
    ).resolves.toBeUndefined();
  });

  it('fails fast when an unimplemented adapter is enabled', async () => {
    await expect(
      new SlackAdapter().initialize({ enabled: true, platformConfig: {} }),
    ).rejects.toThrow(/not implemented yet/i);
    await expect(
      new FeishuAdapter().initialize({ enabled: true, platformConfig: {} }),
    ).rejects.toThrow(/not implemented yet/i);
  });

  it('fails fast when trying to send through an unimplemented adapter', async () => {
    await expect(
      new SlackAdapter().reply('slack:C123', { text: 'hello' }),
    ).rejects.toThrow(/not implemented yet/i);
    await expect(
      new FeishuAdapter().reply('feishu:oc_123', { text: 'hello' }),
    ).rejects.toThrow(/not implemented yet/i);
  });
});
