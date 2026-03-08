import { describe, it, expect, beforeAll } from 'vitest';
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
// maxTokens raised to 256 because reasoning models (Kimi, StepFun) consume tokens
// on internal reasoning before emitting content; 32 is not enough.
async function assertChat(adapter: LlmGateway, model: string) {
  const response = await adapter.chat({
    messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    model,
    maxTokens: 256,
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
    maxTokens: 256,
  })) {
    chunks.push(chunk);
  }
  // Some compat providers may emit only a done chunk with no content chunks
  // (e.g. reasoning models with short output). Accept >= 1 total chunks.
  expect(chunks.length).toBeGreaterThanOrEqual(1);
  const finalChunk = chunks.at(-1);
  expect(finalChunk.done).toBe(true);
}

// --- Native providers ---
describe.skipIf(!HAS_ANTHROPIC)('AnthropicAdapter smoke (live API)', () => {
  let adapter: AnthropicAdapter;
  const model = 'claude-sonnet-4-20250514';

  beforeAll(() => { adapter = new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!); });

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 30_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 30_000);
});

describe.skipIf(!HAS_OPENAI)('OpenAiAdapter smoke (live API)', () => {
  let adapter: OpenAiAdapter;
  const model = 'gpt-4o-mini';

  beforeAll(() => { adapter = new OpenAiAdapter(process.env.OPENAI_API_KEY!); });

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 30_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 30_000);
});

// --- OpenAI-compatible providers ---
describe.skipIf(!HAS_OPENROUTER)('OpenRouter smoke (openai-compat)', () => {
  let adapter: LlmGateway;
  // Default to a non-reasoning free model; reasoning models (stepfun) may consume
  // all tokens on internal reasoning before emitting visible content.
  const model = process.env.OPENROUTER_MODEL ?? 'google/gemma-3-4b-it:free';

  beforeAll(() => {
    adapter = createGateway({
      provider: 'openai-compat',
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    });
  });

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 60_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 60_000);
});

describe.skipIf(!HAS_KIMI)('Kimi smoke (openai-compat)', () => {
  let adapter: LlmGateway;
  const model = process.env.KIMI_MODEL ?? 'kimi-for-coding';

  beforeAll(() => {
    adapter = createGateway({
      provider: 'openai-compat',
      apiKey: process.env.KIMI_API_KEY!,
      baseURL: process.env.KIMI_BASE_URL ?? 'https://api.kimi.com/coding/v1',
      // Kimi requires a recognized coding agent User-Agent
      defaultHeaders: { 'User-Agent': 'claude-code/1.0.0' },
    });
  });

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 60_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 60_000);
});

describe.skipIf(!HAS_GEMINI)('Gemini smoke (openai-compat)', () => {
  let adapter: LlmGateway;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  beforeAll(() => {
    adapter = createGateway({
      provider: 'openai-compat',
      apiKey: process.env.GEMINI_API_KEY!,
      baseURL: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  });

  it('chat', async () => {
    await assertChat(adapter, model);
  }, 60_000);

  it('chatStream', async () => {
    await assertChatStream(adapter, model);
  }, 60_000);
});
