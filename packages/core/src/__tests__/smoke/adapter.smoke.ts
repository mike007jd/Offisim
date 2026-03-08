import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from '../../llm/anthropic-adapter.js';
import { OpenAiAdapter } from '../../llm/openai-adapter.js';
import { createGateway } from '../../llm/gateway-factory.js';
import type { LlmGateway } from '../../llm/gateway.js';

// --- Provider detection ---
const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY;
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const HAS_OPENROUTER = !!process.env.OPENROUTER_API_KEY;
const HAS_KIMI = !!process.env.KIMI_API_KEY;
const HAS_GEMINI = !!process.env.GEMINI_API_KEY;

// --- Shared assertions ---
async function assertChat(adapter: LlmGateway, model: string) {
  const response = await adapter.chat({
    messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    model,
    maxTokens: 32,
  });
  expect(response.content.length).toBeGreaterThan(0);
  expect(response.toolCalls).toEqual([]);
}

async function assertChatStream(adapter: LlmGateway, model: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chunks: any[] = [];
  for await (const chunk of adapter.chatStream({
    messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    model,
    maxTokens: 32,
  })) {
    chunks.push(chunk);
  }
  expect(chunks.length).toBeGreaterThan(1);
  const contentChunks = chunks.filter((c) => c.content);
  expect(contentChunks.length).toBeGreaterThan(0);
  const finalChunk = chunks.at(-1);
  expect(finalChunk.done).toBe(true);
}

// --- Native providers ---
describe.skipIf(!HAS_ANTHROPIC)('AnthropicAdapter smoke (live API)', () => {
  const adapter = new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!);
  const model = 'claude-sonnet-4-20250514';

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 30_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 30_000);
});

describe.skipIf(!HAS_OPENAI)('OpenAiAdapter smoke (live API)', () => {
  const adapter = new OpenAiAdapter(process.env.OPENAI_API_KEY!);
  const model = 'gpt-4o-mini';

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 30_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 30_000);
});

// --- OpenAI-compatible providers ---
describe.skipIf(!HAS_OPENROUTER)('OpenRouter smoke (openai-compat)', () => {
  const adapter = createGateway({
    provider: 'openai-compat',
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  });
  const model = process.env.OPENROUTER_MODEL ?? 'stepfun/step-3.5-flash:free';

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 60_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 60_000);
});

describe.skipIf(!HAS_KIMI)('Kimi smoke (openai-compat)', () => {
  const adapter = createGateway({
    provider: 'openai-compat',
    apiKey: process.env.KIMI_API_KEY!,
    baseURL: process.env.KIMI_BASE_URL ?? 'https://api.kimi.com/coding/v1',
  });
  const model = process.env.KIMI_MODEL ?? 'kimi-for-coding';

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 60_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 60_000);
});

describe.skipIf(!HAS_GEMINI)('Gemini smoke (openai-compat)', () => {
  const adapter = createGateway({
    provider: 'openai-compat',
    apiKey: process.env.GEMINI_API_KEY!,
    baseURL: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
  });
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 60_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 60_000);
});
