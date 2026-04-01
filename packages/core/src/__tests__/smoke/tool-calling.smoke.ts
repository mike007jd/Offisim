import { beforeAll, describe, expect, it } from 'vitest';
import type { LlmGateway, LlmStreamChunk, ToolDef } from '../../llm/gateway.js';
import { HAS_MINIMAX, MINIMAX_MODEL, createMiniMaxGateway } from '../helpers/smoke-providers.js';

// --- Shared tool definition ---
const GET_WEATHER_TOOL: ToolDef = {
  name: 'get_weather',
  description: 'Get the current weather for a given city.',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: 'The city name, e.g. "Tokyo"',
      },
    },
    required: ['city'],
  },
};

describe.skipIf(!HAS_MINIMAX)('MiniMax tool-calling smoke (live API)', () => {
  let adapter: LlmGateway;
  const model = MINIMAX_MODEL;

  beforeAll(() => {
    adapter = createMiniMaxGateway();
  });

  it('single tool call', async () => {
    const response = await adapter.chat({
      messages: [{ role: 'user', content: "What's the weather in Tokyo?" }],
      model,
      maxTokens: 4096,
      tools: [GET_WEATHER_TOOL],
    });

    expect(response.toolCalls.length).toBeGreaterThan(0);
    const toolCall = response.toolCalls[0];
    if (!toolCall) throw new Error('Expected tool call');
    expect(toolCall.name).toBe('get_weather');
    expect(toolCall.arguments).toBeDefined();
    expect(toolCall.arguments.city).toBeDefined();
    // City should mention Tokyo (case-insensitive, may include extra text)
    expect(String(toolCall.arguments.city).toLowerCase()).toContain('tokyo');
    expect(toolCall.id).toBeTruthy();
  }, 60_000);

  it('tool result round-trip', async () => {
    // Step 1: get the tool call
    const step1 = await adapter.chat({
      messages: [{ role: 'user', content: "What's the weather in Tokyo?" }],
      model,
      maxTokens: 4096,
      tools: [GET_WEATHER_TOOL],
    });

    expect(step1.toolCalls.length).toBeGreaterThan(0);
    const toolCall = step1.toolCalls[0];
    if (!toolCall) throw new Error('Expected tool call in first response');

    // Step 2: send tool result back
    const step2 = await adapter.chat({
      messages: [
        { role: 'user', content: "What's the weather in Tokyo?" },
        {
          role: 'assistant',
          content: step1.content,
          toolCalls: step1.toolCalls,
        },
        {
          role: 'tool',
          toolCallId: toolCall.id,
          content: JSON.stringify({ temperature: 22, condition: 'sunny', humidity: 55 }),
        },
      ],
      model,
      maxTokens: 4096,
      tools: [GET_WEATHER_TOOL],
    });

    // Model should generate a natural language response incorporating the weather data
    expect(step2.content.length).toBeGreaterThan(0);
    // Should reference something from the tool result (temperature, sunny, etc.)
    const lower = step2.content.toLowerCase();
    const mentionsSomething =
      lower.includes('22') || lower.includes('sunny') || lower.includes('tokyo');
    expect(mentionsSomething).toBe(true);
  }, 60_000);

  it('streaming tool call', async () => {
    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of adapter.chatStream({
      messages: [{ role: 'user', content: "What's the weather in Tokyo?" }],
      model,
      maxTokens: 4096,
      tools: [GET_WEATHER_TOOL],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const finalChunk = chunks.at(-1);
    expect(finalChunk).toBeDefined();
    if (!finalChunk) throw new Error('Expected final tool-calling chunk');
    expect(finalChunk.done).toBe(true);

    // Final chunk should have accumulated tool calls
    expect(finalChunk.toolCalls).toBeDefined();
    if (!finalChunk.toolCalls) throw new Error('Expected tool calls on final chunk');
    expect(finalChunk.toolCalls.length).toBeGreaterThan(0);

    const toolCall = finalChunk.toolCalls[0];
    if (!toolCall) throw new Error('Expected accumulated tool call');
    expect(toolCall.name).toBe('get_weather');
    expect(toolCall.arguments).toBeDefined();
    expect(String(toolCall.arguments.city).toLowerCase()).toContain('tokyo');
    expect(toolCall.id).toBeTruthy();
  }, 60_000);
});
