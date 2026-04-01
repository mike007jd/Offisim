import { beforeAll, describe, expect, it } from 'vitest';
import type { LlmGateway, LlmStreamChunk } from '../../llm/gateway.js';
import { HAS_MINIMAX, MINIMAX_MODEL, createMiniMaxGateway } from '../helpers/smoke-providers.js';

describe.skipIf(!HAS_MINIMAX)('MiniMax edge-case smoke tests', () => {
  let adapter: LlmGateway;
  const model = MINIMAX_MODEL;

  beforeAll(() => {
    adapter = createMiniMaxGateway();
  });

  // 1. Multi-turn conversation
  it('multi-turn conversation preserves context', async () => {
    const response = await adapter.chat({
      messages: [
        { role: 'user', content: 'My name is Zephyr. Remember it.' },
        { role: 'assistant', content: 'Got it, your name is Zephyr.' },
        { role: 'user', content: 'What is my name?' },
      ],
      model,
      maxTokens: 128,
    });
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.content.toLowerCase()).toContain('zephyr');
  }, 60_000);

  // 2. System message handling
  it('system message instruction is respected', async () => {
    const response = await adapter.chat({
      messages: [
        { role: 'system', content: 'Always respond in exactly one word. No punctuation.' },
        { role: 'user', content: 'What color is the sky?' },
      ],
      model,
      maxTokens: 4096,
      temperature: 0,
    });
    expect(response.content.length).toBeGreaterThan(0);
    // The response should be very short — one word means few characters
    const trimmed = response.content.trim();
    expect(trimmed.split(/\s+/).length).toBeLessThanOrEqual(5);
  }, 60_000);

  // 3. Long input handling
  it('handles long input (~2000 tokens)', async () => {
    // Build a ~2000-token message. Average English word ≈ 1.3 tokens,
    // so ~1500 words should approximate 2000 tokens.
    const paragraph = 'The quick brown fox jumps over the lazy dog. ';
    const longContent = paragraph.repeat(170); // ~1530 words
    const response = await adapter.chat({
      messages: [
        {
          role: 'user',
          content: `Here is a long text:\n\n${longContent}\n\nSummarize the above text in one sentence.`,
        },
      ],
      model,
      maxTokens: 4096,
    });
    expect(response.content.length).toBeGreaterThan(0);
    // MiniMax tokenizer is more efficient — 1500 English words ≈ 400+ tokens
    expect(response.usage.inputTokens).toBeGreaterThan(200);
  }, 60_000);

  // 4. Temperature 0 determinism
  it('temperature 0 produces deterministic output', async () => {
    const request = {
      messages: [{ role: 'user' as const, content: 'What is 2 + 2? Reply with just the number.' }],
      model,
      maxTokens: 4096,
      temperature: 0,
    };
    const [r1, r2] = await Promise.all([adapter.chat(request), adapter.chat(request)]);
    expect(r1.content.length).toBeGreaterThan(0);
    expect(r2.content.length).toBeGreaterThan(0);
    // Both responses should contain "4"
    expect(r1.content).toContain('4');
    expect(r2.content).toContain('4');
    // With temperature 0, responses should be identical or extremely similar
    expect(r1.content.trim()).toBe(r2.content.trim());
  }, 60_000);

  // 5. maxTokens respect
  it('maxTokens limits response length', async () => {
    // Use 512 to verify the model respects the cap while having enough for thinking.
    const response = await adapter.chat({
      messages: [
        {
          role: 'user',
          content:
            'Write a very long essay about the history of mathematics. Be as detailed as possible.',
        },
      ],
      model,
      maxTokens: 512,
    });
    // output_tokens should be <= 512
    expect(response.usage.outputTokens).toBeLessThanOrEqual(520);
    // Content should be relatively short (not a full essay)
    expect(response.content.length).toBeLessThan(5000);
  }, 60_000);

  // 6. Empty/minimal response
  it('produces minimal response when asked', async () => {
    const response = await adapter.chat({
      messages: [
        {
          role: 'system',
          content: 'You must respond with only the exact text "OK" and nothing else.',
        },
        { role: 'user', content: 'Acknowledge.' },
      ],
      model,
      maxTokens: 4096,
      temperature: 0,
    });
    const trimmed = response.content.trim();
    expect(trimmed.length).toBeLessThan(30);
    expect(trimmed.toLowerCase()).toContain('ok');
  }, 60_000);

  // 7. Stream content accumulation
  it('stream accumulates non-empty content', async () => {
    const chunks: LlmStreamChunk[] = [];
    let accumulatedContent = '';

    for await (const chunk of adapter.chatStream({
      messages: [
        {
          role: 'user',
          content: 'List the first 5 prime numbers, one per line.',
        },
      ],
      model,
      maxTokens: 4096,
    })) {
      chunks.push(chunk);
      if (chunk.content) {
        accumulatedContent += chunk.content;
      }
    }

    // Should have at least a few chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Last chunk should be done
    const finalChunk = chunks.at(-1);
    expect(finalChunk).toBeDefined();
    if (!finalChunk) throw new Error('Expected final chunk');
    expect(finalChunk.done).toBe(true);

    // Accumulated content should be non-empty and contain prime numbers
    expect(accumulatedContent.length).toBeGreaterThan(0);
    expect(accumulatedContent).toContain('2');
    expect(accumulatedContent).toContain('3');
    expect(accumulatedContent).toContain('5');

    // Final chunk should report usage
    expect(finalChunk.usage).toBeDefined();
    if (!finalChunk.usage) throw new Error('Expected usage on final chunk');
    expect(finalChunk.usage.inputTokens).toBeGreaterThan(0);
    expect(finalChunk.usage.outputTokens).toBeGreaterThan(0);
  }, 60_000);
});
