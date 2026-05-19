import { readFileSync } from 'node:fs';
import { ensureRuntimeBuild } from './harness-lib.mjs';

await ensureRuntimeBuild({ force: process.argv.includes('--force-build') });

const { OpenAiAdapter } = await import(
  new URL('../packages/core/dist/llm/openai-adapter.js', import.meta.url).href
);
const { AnthropicAdapter } = await import(
  new URL('../packages/core/dist/llm/anthropic-adapter.js', import.meta.url).href
);
const { ClaudeAgentSdkAdapter } = await import(
  new URL('../packages/core/dist/llm/claude-agent-sdk-adapter.js', import.meta.url).href
);
const { OpenAiAgentsSdkAdapter } = await import(
  new URL('../packages/core/dist/llm/openai-agents-sdk-adapter.js', import.meta.url).href
);
const { createExecutionAdapter } = await import(
  new URL('../packages/core/dist/llm/execution-adapter-factory.js', import.meta.url).href
);
const { sdkLaneTextOnlyMessage } = await import(
  new URL('../packages/core/dist/llm/sdk-lane-policy.js', import.meta.url).href
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
await assertChatTimeout(OpenAiAdapter, 'openai-chat-timeout');
await assertChatTimeout(AnthropicAdapter, 'anthropic-chat-timeout');
await assertSdkAdapterRejectsTools(
  () =>
    new ClaudeAgentSdkAdapter(undefined, {
      pathToClaudeCodeExecutable: '/__offisim_harness_should_not_spawn_claude__',
    }),
  'claude-agent-sdk-rejects-tools',
  'Claude Agent SDK',
);
let openAiAgentsFetchCount = 0;
await assertSdkAdapterRejectsTools(
  () =>
    new OpenAiAgentsSdkAdapter('test-key', {
      baseURL: 'https://mock.openai-agents.local/v1',
      fetch: async () => {
        openAiAgentsFetchCount += 1;
        return new Response('{}');
      },
      dangerouslyAllowBrowser: true,
    }),
  'openai-agents-sdk-rejects-tools',
  'OpenAI Agents SDK',
);
if (openAiAgentsFetchCount !== 0) {
  throw new Error('openai-agents-sdk-rejects-tools called transport before rejecting tools');
}
assertCodexCoreFactoryFailsClosed();
assertCodexHostTextOnlyInstructions();
assertTauriEngineAdaptersResolveProjectId();

console.log(
  JSON.stringify(
    {
      ok: true,
      suite: 'provider-adapter',
      scenarios: [
        'openai-partial-function-args',
        'anthropic-partial-json-tool-use',
        'openai-chat-timeout',
        'anthropic-chat-timeout',
        'claude-agent-sdk-rejects-tools',
        'openai-agents-sdk-rejects-tools',
        'codex-agent-sdk-core-factory-fails-closed',
        'codex-agent-host-text-only-instructions',
        'tauri-engine-adapters-project-id',
      ],
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

async function assertChatTimeout(Adapter, scenarioId) {
  let sawAbort = false;
  const adapter = new Adapter('test-key', {
    baseURL: `https://mock.${scenarioId}.local/v1`,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            sawAbort = true;
            reject(init.signal.reason ?? new DOMException('aborted', 'AbortError'));
          },
          { once: true },
        );
      }),
    dangerouslyAllowBrowser: true,
  });

  try {
    await adapter.chat({ ...request, timeoutMs: 25 });
  } catch (error) {
    if (!sawAbort) {
      throw new Error(`${scenarioId} did not abort the injected fetch`);
    }
    if (!/timed out|abort/i.test(error instanceof Error ? error.message : String(error))) {
      throw new Error(`${scenarioId} surfaced unexpected error: ${String(error)}`);
    }
    return;
  }

  throw new Error(`${scenarioId} unexpectedly completed`);
}

async function assertSdkAdapterRejectsTools(adapterFactory, scenarioId, laneLabel) {
  const adapter = adapterFactory();
  try {
    await adapter.chat(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expected = sdkLaneTextOnlyMessage(laneLabel);
    if (!message.includes(expected)) {
      throw new Error(`${scenarioId} surfaced unexpected error: ${message}`);
    }
    return;
  }

  throw new Error(`${scenarioId} unexpectedly accepted tool-bearing request`);
}

function assertCodexCoreFactoryFailsClosed() {
  try {
    createExecutionAdapter({
      executionLane: 'codex-agent-sdk',
      provider: 'openai',
      model: 'mock-model',
      apiKey: 'test-key',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes('codex-agent-sdk') ||
      !message.includes('trusted desktop host') ||
      !message.includes('unavailable in the generic core adapter factory')
    ) {
      throw new Error(`codex-agent-sdk-core-factory-fails-closed surfaced ${message}`);
    }
    return;
  }

  throw new Error('codex-agent-sdk-core-factory-fails-closed unexpectedly created adapter');
}

function assertCodexHostTextOnlyInstructions() {
  const source = readFileSync(new URL('./tauri-codex-agent-host.mjs', import.meta.url), 'utf8');
  const forbidden = [
    'use them when needed to verify file or shell work',
    'Prefer native trusted-host tools',
  ];
  for (const phrase of forbidden) {
    if (source.includes(phrase)) {
      throw new Error(`codex-agent-host-text-only-instructions still contains "${phrase}"`);
    }
  }
  const required = [
    'model transport is not a tool-capable runtime',
    'Do not execute Offisim file, shell, memory, todo, skill, MCP, or builtin tools.',
    'default Offisim harness/gateway tools or a verified tool-capable employee profile',
  ];
  for (const phrase of required) {
    if (!source.includes(phrase)) {
      throw new Error(`codex-agent-host-text-only-instructions missing "${phrase}"`);
    }
  }
}

function assertTauriEngineAdaptersResolveProjectId() {
  const engineSource = readFileSync(
    new URL('../apps/desktop/renderer/src/lib/tauri-engine-adapters.ts', import.meta.url),
    'utf8',
  );
  const runtimeSource = readFileSync(
    new URL('../apps/desktop/renderer/src/lib/tauri-runtime.ts', import.meta.url),
    'utf8',
  );
  const executorSource = readFileSync(
    new URL('../packages/core/src/agents/employee-engine-executor.ts', import.meta.url),
    'utf8',
  );
  const requiredEnginePhrases = [
    'readonly resolveProjectId?: () => Promise<string | null | undefined>;',
    'const resolvedProjectId = envelope.projectId ?? (await this.options.resolveProjectId?.());',
    'projectId: resolvedProjectId',
    'new TauriCodexEngineAdapter({ resolveProjectId: options.resolveProjectId })',
    'resolveProjectId: options.resolveProjectId',
  ];
  for (const phrase of requiredEnginePhrases) {
    if (!engineSource.includes(phrase)) {
      throw new Error(`tauri-engine-adapters-project-id missing "${phrase}"`);
    }
  }
  const requiredRuntimePhrases = [
    'engineAdapters: createTauriEngineAdapterRegistry({',
    'async resolveProjectId()',
    'thread?.project_id ?? (await resolveSingleActiveProjectId(repos, companyId))',
  ];
  for (const phrase of requiredRuntimePhrases) {
    if (!runtimeSource.includes(phrase)) {
      throw new Error(`tauri-runtime-engine-project-id missing "${phrase}"`);
    }
  }
  if (!executorSource.includes('projectId: state.projectId ?? null,')) {
    throw new Error('tauri-engine-adapters-project-id missing engine envelope projectId');
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
