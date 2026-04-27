import { ensureRuntimeBuild } from './harness-lib.mjs';

await ensureRuntimeBuild({ force: process.argv.includes('--force-build') });

const { OpenAiAdapter } = await import(
  new URL('../packages/core/dist/llm/openai-adapter.js', import.meta.url).href
);
const { AnthropicAdapter } = await import(
  new URL('../packages/core/dist/llm/anthropic-adapter.js', import.meta.url).href
);

const request = {
  model: 'mock-model',
  messages: [{ role: 'user', content: 'call write_file' }],
  tools: [
    {
      name: 'write_file',
      description: 'Write a file',
      parameters: { type: 'object', properties: {} },
    },
  ],
};

const openai = new OpenAiAdapter('test-key', {
  baseURL: 'https://mock.openai.local/v1',
  fetch: async () => sseResponse(openaiToolSse()),
  dangerouslyAllowBrowser: true,
});
const anthropic = new AnthropicAdapter('test-key', {
  baseURL: 'https://mock.anthropic.local',
  fetch: async () => sseResponse(anthropicToolSse()),
  dangerouslyAllowBrowser: true,
});

const openaiToolCalls = await collectToolCalls(openai.chatStream(request));
const anthropicToolCalls = await collectToolCalls(anthropic.chatStream(request));

assertToolCall(openaiToolCalls, 'openai-partial-function-args');
assertToolCall(anthropicToolCalls, 'anthropic-partial-json-tool-use');

console.log(
  JSON.stringify(
    {
      ok: true,
      suite: 'provider-adapter',
      scenarios: ['openai-partial-function-args', 'anthropic-partial-json-tool-use'],
    },
    null,
    2,
  ),
);

async function collectToolCalls(stream) {
  const toolCalls = [];
  for await (const chunk of stream) {
    if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
  }
  return toolCalls;
}

function assertToolCall(toolCalls, scenarioId) {
  const [call] = toolCalls;
  if (
    !call ||
    call.name !== 'write_file' ||
    call.arguments.path !== 'out.txt' ||
    call.arguments.content !== 'hello'
  ) {
    throw new Error(`${scenarioId} failed to assemble streamed tool call JSON`);
  }
}

function sseResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

function openaiToolSse() {
  return [
    openaiData({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'mock-model',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'tc-1',
                type: 'function',
                function: { name: 'write_file', arguments: '{"path":"out' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
    openaiData({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'mock-model',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: '.txt","content":"hello"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
    openaiData({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'mock-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    }),
    openaiData({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'mock-model',
      choices: [],
      usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
    }),
    'data: [DONE]\n\n',
  ].join('');
}

function anthropicToolSse() {
  return [
    anthropicEvent('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        model: 'mock-model',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 4, output_tokens: 0 },
      },
    }),
    anthropicEvent('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tc-1', name: 'write_file', input: {} },
    }),
    anthropicEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"path":"out' },
    }),
    anthropicEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '.txt","content":"hello"}' },
    }),
    anthropicEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
    anthropicEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 5 },
    }),
    anthropicEvent('message_stop', { type: 'message_stop' }),
  ].join('');
}

function openaiData(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function anthropicEvent(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
