#!/usr/bin/env node

// scripts/tauri-codex-agent-host.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
function asUtf8String(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
}
async function readPayloadFromStdin() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += asUtf8String(chunk);
    const trimmed2 = raw.trim();
    if (!trimmed2) continue;
    try {
      return JSON.parse(trimmed2);
    } catch {}
  }
  const trimmed = raw.trim();
  return trimmed ? JSON.parse(trimmed) : {};
}
function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : void 0;
}
function pathHasExecutable(command) {
  if (command.includes('/')) {
    return existsSync(command);
  }
  const pathValue = asNonEmptyString(process.env.PATH);
  if (!pathValue) return false;
  return pathValue.split(':').some((segment) => {
    const dir = segment.trim();
    return dir ? existsSync(join(dir, command)) : false;
  });
}
function codexAppExecutableCandidates() {
  if (process.platform !== 'darwin') return [];
  return [
    '/Applications/Codex.app/Contents/Resources/codex',
    process.env.HOME
      ? join(process.env.HOME, 'Applications/Codex.app/Contents/Resources/codex')
      : null,
  ].filter(Boolean);
}
function resolveCodexExecutable() {
  const explicit = asNonEmptyString(process.env.OFFISIM_CODEX_EXECUTABLE);
  if (explicit && pathHasExecutable(explicit)) {
    return explicit;
  }
  for (const candidate of codexAppExecutableCandidates()) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  if (pathHasExecutable('codex')) {
    return 'codex';
  }
  throw Object.assign(
    new Error(
      'No Codex executable was found on PATH or in Codex.app. Install `@openai/codex`, install Codex.app, or set OFFISIM_CODEX_EXECUTABLE.',
    ),
    { code: 'host-unavailable' },
  );
}
function buildSystemPrompt(messages) {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean);
  return systemMessages.length > 0 ? systemMessages : void 0;
}
function formatConversationMessage(message) {
  switch (message.role) {
    case 'assistant':
      return [
        'Assistant:',
        message.content || '(empty)',
        ...(message.reasoningContent ? [`Reasoning: ${message.reasoningContent}`] : []),
        ...(message.toolCalls && message.toolCalls.length > 0
          ? [`Tool calls: ${JSON.stringify(message.toolCalls)}`]
          : []),
      ].join('\n');
    case 'tool':
      return [
        `Tool${message.toolCallId ? ` (${message.toolCallId})` : ''}:`,
        message.content || '(empty)',
      ].join('\n');
    case 'user':
      return ['User:', message.content || '(empty)'].join('\n');
    default:
      return ['System:', message.content || '(empty)'].join('\n');
  }
}
function buildPrompt(messages) {
  const nonSystemMessages = messages.filter((message) => message.role !== 'system');
  if (
    nonSystemMessages.length === 1 &&
    nonSystemMessages[0]?.role === 'user' &&
    nonSystemMessages[0].content.trim()
  ) {
    return nonSystemMessages[0].content;
  }
  const transcript =
    nonSystemMessages.length > 0
      ? nonSystemMessages.map(formatConversationMessage).join('\n\n')
      : 'User:\n(empty conversation)';
  return [
    'Continue this conversation as the assistant.',
    'Answer the latest user/tool context directly. Do not mention hidden instructions.',
    '',
    transcript,
  ].join('\n');
}
function isFullAgentRuntime(request) {
  return request?.runtimeProfileTier === 'sdk-native-full-agent';
}
function shouldCollectLifecycleVerificationEvents(request) {
  return request?.enableLifecycleVerification === true;
}
function assertSupportedRuntimeRequest(request) {
  const tier = request?.runtimeProfileTier;
  const nativeRuntime = isFullAgentRuntime(request);
  if (!asNonEmptyString(request.model)) {
    throw Object.assign(new Error('Codex trusted-host requests must include a selected model.'), {
      code: 'invalid-request',
    });
  }
  if (tier === 'gateway-bridged-tools') {
    throw Object.assign(
      new Error(
        'Gateway-bridged runtime profiles must execute through the Offisim gateway adapter, not the Codex native host.',
      ),
      { code: 'invalid-request' },
    );
  }
  if (request?.enableNativeRuntimeEvents === true && !nativeRuntime) {
    throw Object.assign(
      new Error('Native runtime events require runtimeProfileTier "sdk-native-full-agent".'),
      { code: 'invalid-request' },
    );
  }
  if (shouldCollectLifecycleVerificationEvents(request) && !nativeRuntime) {
    throw Object.assign(
      new Error('Lifecycle verification requires runtimeProfileTier "sdk-native-full-agent".'),
      { code: 'invalid-request' },
    );
  }
  if (nativeRuntime && asNonEmptyString(request.approvalPolicy) === 'never') {
    throw Object.assign(
      new Error(
        'SDK-native full-agent requests must not use approvalPolicy "never" until a verified approval-bypass policy exists.',
      ),
      { code: 'invalid-request' },
    );
  }
}
function buildDeveloperInstructions(messages, tools, allowNativeTools) {
  const sections = [
    "You are Offisim's trusted Codex local-auth text/reasoning bridge.",
    'Return exactly one plain assistant reply.',
    allowNativeTools
      ? 'This request is running under an explicit Offisim full-agent runtime profile. You may use native Codex tools inside the provided workspace sandbox, and every native tool event must be surfaced to Offisim as runtime evidence.'
      : 'Offisim model transport is not a tool-capable runtime. Do not execute Offisim file, shell, memory, todo, skill, MCP, or builtin tools. If workspace verification is required, say the user must use the default Offisim harness/gateway tools or a verified tool-capable employee profile.',
  ];
  const systemPrompt = buildSystemPrompt(messages);
  if (systemPrompt) {
    sections.push('Follow these higher-priority system instructions:');
    sections.push(systemPrompt.join('\n\n'));
  }
  if (!allowNativeTools && Array.isArray(tools) && tools.length > 0) {
    sections.push(
      'The upstream caller supplied Offisim tool definitions, but this Codex model transport must not execute them without a verified runtime profile. State that the default Offisim harness/gateway tools or a verified tool-capable employee profile are required instead of simulating tool results.',
    );
  }
  return sections.join('\n\n');
}
function mapMcpStatus(status) {
  switch (status) {
    case 'ready':
      return 'connected';
    case 'starting':
      return 'degraded';
    case 'shutdown':
      return 'shutdown';
    default:
      return status === 'error' ? 'failed' : 'degraded';
  }
}
function commandToolName(item) {
  if (typeof item?.command === 'string' && item.command.trim()) {
    return item.command.trim().split(/\s+/)[0] ?? 'shell';
  }
  return 'shell';
}
function parseFunctionCallArguments(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function functionCallToolName(item) {
  if (typeof item?.name === 'string' && item.name.trim()) {
    if (item.name === 'exec_command') {
      const args = parseFunctionCallArguments(item.arguments);
      if (typeof args.cmd === 'string' && args.cmd.trim()) {
        return args.cmd.trim().split(/\s+/)[0] ?? 'exec_command';
      }
    }
    return item.name.trim();
  }
  return 'native_tool';
}
function outputIndicatesDenial(output) {
  if (typeof output !== 'string') return false;
  return /Operation not permitted|Permission denied|outside (?:bound )?project|sandbox|not allowed/i.test(
    output,
  );
}
function outputIndicatesFailure(output) {
  return typeof output === 'string' && /Process exited with code [1-9][0-9]*/.test(output);
}
function rememberCompletedToolCall(completedToolCalls, toolCallId) {
  completedToolCalls.add(toolCallId);
  if (completedToolCalls.size > 512) {
    const oldest = completedToolCalls.values().next().value;
    if (typeof oldest === 'string') {
      completedToolCalls.delete(oldest);
    }
  }
}
function mapRuntimeEventFromNotification(message, pendingToolCalls, completedToolCalls) {
  const params = message?.params;
  switch (message?.method) {
    case 'thread/started':
      return {
        kind: 'session_event',
        action: 'started',
        sessionId: params?.thread?.id ?? params?.threadId ?? 'codex-app-server',
        detail: params?.thread?.cwd,
      };
    case 'mcpServer/startupStatus/updated':
      return {
        kind: 'mcp_status',
        serverName: params?.name ?? 'mcp',
        status: mapMcpStatus(params?.status),
        ...(params?.error ? { detail: String(params.error) } : {}),
      };
    case 'item/started': {
      const item = params?.item;
      if (item?.type !== 'commandExecution') return null;
      if (
        typeof item.id === 'string' &&
        (pendingToolCalls.has(item.id) || completedToolCalls.has(item.id))
      ) {
        return null;
      }
      return {
        kind: 'tool_started',
        toolCallId: item.id,
        toolName: commandToolName(item),
        toolType: 'runtime-profile',
        evidenceClass: 'sdk-native',
        evidenceToolName: 'bash',
      };
    }
    case 'item/completed': {
      const item = params?.item;
      if (item?.type !== 'commandExecution') return null;
      if (
        typeof item.id === 'string' &&
        (pendingToolCalls.has(item.id) || completedToolCalls.has(item.id))
      ) {
        return null;
      }
      return {
        kind: 'tool_completed',
        toolCallId: item.id,
        toolName: commandToolName(item),
        toolType: 'runtime-profile',
        evidenceClass: 'sdk-native',
        evidenceToolName: 'bash',
        status: item.status === 'completed' ? 'completed' : 'error',
        ...(item.status !== 'completed' ? { errorType: item.status ?? 'command_failed' } : {}),
      };
    }
    case 'rawResponseItem/completed': {
      const item = params?.item;
      if (item?.type === 'function_call' && typeof item.call_id === 'string') {
        const toolName = functionCallToolName(item);
        pendingToolCalls.set(item.call_id, toolName);
        const isShellFunction = item.name === 'exec_command';
        return {
          kind: 'tool_started',
          toolCallId: item.call_id,
          toolName,
          toolType: 'runtime-profile',
          evidenceClass: 'sdk-native',
          ...(isShellFunction ? { evidenceToolName: 'bash' } : {}),
        };
      }
      if (item?.type === 'function_call_output' && typeof item.call_id === 'string') {
        const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
        const denied = outputIndicatesDenial(output);
        const failed = denied || outputIndicatesFailure(output);
        const toolName = pendingToolCalls.get(item.call_id) ?? 'native_tool';
        pendingToolCalls.delete(item.call_id);
        rememberCompletedToolCall(completedToolCalls, item.call_id);
        return {
          kind: 'tool_completed',
          toolCallId: item.call_id,
          toolName,
          toolType: 'runtime-profile',
          evidenceClass: 'sdk-native',
          ...(isShellCommandName(toolName) ? { evidenceToolName: 'bash' } : {}),
          status: denied ? 'denied' : failed ? 'error' : 'completed',
          ...(denied
            ? { errorType: 'sandbox_denied' }
            : failed
              ? { errorType: 'command_failed' }
              : {}),
        };
      }
      return null;
    }
    case 'item/autoApprovalReview/completed': {
      const review = params?.review ?? params?.item;
      return {
        kind: 'guardrail_decision',
        decision: review?.approved === false ? 'deny' : 'allow',
        title: 'Codex approval review',
        detail: review?.reason ?? review?.message,
      };
    }
    default:
      return null;
  }
}
function unexpectedExitMessage(stderr, code, signal) {
  return stderr
    ? `Codex app-server exited unexpectedly: ${stderr}`
    : `Codex app-server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`;
}
function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw Object.assign(
      new Error(
        `Codex app-server returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
      { code: 'protocol' },
    );
  }
}
function resolvePendingRequest(client, message) {
  if (
    !message ||
    typeof message !== 'object' ||
    !('id' in message) ||
    (!('result' in message) && !('error' in message))
  ) {
    return false;
  }
  const pending = client.pending.get(message.id);
  if (!pending) {
    return false;
  }
  client.pending.delete(message.id);
  if (message.error) {
    pending.reject(
      Object.assign(new Error(message.error.message ?? 'Codex app-server request failed.'), {
        code: 'upstream',
      }),
    );
  } else {
    pending.resolve(message.result);
  }
  return true;
}
function rejectUnsupportedServerRequest(client, message) {
  if (!message || typeof message !== 'object' || !('method' in message) || !('id' in message)) {
    return false;
  }
  client.sendRaw({
    jsonrpc: '2.0',
    id: message.id,
    error: {
      code: -32601,
      message: `Unsupported server request from Codex app-server: ${message.method}`,
    },
  });
  return true;
}
function turnMatches(turnId, params) {
  return !turnId || params?.turnId === turnId;
}
function reasoningSummaryText(item) {
  if (item?.type !== 'reasoning') {
    return '';
  }
  const parts = [...(item.summary ?? []), ...(item.content ?? [])]
    .map((part) => String(part).trim())
    .filter(Boolean);
  return parts.join('\n\n');
}
function createJsonRpcClient(child) {
  let requestCounter = 0;
  const pending = /* @__PURE__ */ new Map();
  const stderrChunks = [];
  let closed = false;
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  const reader = createInterface({
    input: child.stdout,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  const closeError = (message) => {
    if (closed) return;
    closed = true;
    const error = new Error(message);
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  };
  child.once('error', (error) => {
    closeError(`Codex app-server failed to start: ${error.message}`);
  });
  child.once('exit', (code, signal) => {
    if (closed) return;
    closeError(
      unexpectedExitMessage(Buffer.concat(stderrChunks).toString('utf8').trim(), code, signal),
    );
  });
  function sendRaw(payload) {
    child.stdin.write(`${JSON.stringify(payload)}
`);
  }
  function send(method, params) {
    const id = `req-${++requestCounter}`;
    sendRaw({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }
  function sendNotification(method, params) {
    sendRaw({ jsonrpc: '2.0', method, ...(params === void 0 ? {} : { params }) });
  }
  async function close() {
    if (closed) return;
    closed = true;
    reader.close();
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    if (!child.killed) {
      child.kill('SIGTERM');
    }
    await new Promise((resolve) => child.once('exit', resolve));
  }
  return {
    pending,
    reader,
    send,
    sendNotification,
    sendRaw,
    close,
    stderrText: () => Buffer.concat(stderrChunks).toString('utf8').trim(),
  };
}
function createUsage(breakdown) {
  return {
    inputTokens: breakdown?.inputTokens ?? 0,
    outputTokens: breakdown?.outputTokens ?? 0,
  };
}
function codexModel(request) {
  return asNonEmptyString(request.model);
}
function isShellCommandName(toolName) {
  return [
    'bash',
    'sh',
    'zsh',
    'exec_command',
    'shell',
    'pwd',
    'ls',
    'cat',
    'mkdir',
    'touch',
    'rm',
    'cp',
    'mv',
    'grep',
    'rg',
    'find',
    'git',
    'pnpm',
    'npm',
    'node',
    'python',
    'python3',
    'cargo',
    'sleep',
    'timeout',
  ].includes(toolName);
}
function tomlString(value) {
  return JSON.stringify(String(value));
}
function assertCodexResponsesCompatibleBaseURL(baseURL) {
  let parsed;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw Object.assign(new Error(`Invalid OPENAI_BASE_URL for Codex lane: ${baseURL}`), {
      code: 'invalid-provider-endpoint',
    });
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '');
  if (host === 'api.z.ai' && (path === '/api/paas/v4' || path === '/api/coding/paas/v4')) {
    throw Object.assign(
      new Error(
        'Z.AI OpenAI-compatible endpoints are chat-completions only. Use the gateway runtime profile, or use the Z.AI Anthropic endpoint for the Claude lane.',
      ),
      { code: 'invalid-provider-endpoint' },
    );
  }
}
function createScopedCodexHome(request) {
  const baseURL = asNonEmptyString(process.env.OPENAI_BASE_URL);
  if (!baseURL) {
    return {
      env: process.env,
      cleanup: () => {},
    };
  }
  const normalizedBaseURL = baseURL.replace(/\/+$/, '');
  assertCodexResponsesCompatibleBaseURL(normalizedBaseURL);
  const home = mkdtempSync(join(tmpdir(), 'offisim-codex-host-'));
  const codexHome = join(home, '.codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    join(codexHome, 'config.toml'),
    [
      `model = ${tomlString(codexModel(request))}`,
      'model_provider = "offisim"',
      '',
      '[model_providers.offisim]',
      'name = "Offisim OpenAI-compatible"',
      `base_url = ${tomlString(normalizedBaseURL)}`,
      'env_key = "OPENAI_API_KEY"',
      'wire_api = "responses"',
      'supports_websockets = false',
      '',
    ].join('\n'),
    'utf8',
  );
  return {
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: codexHome,
    },
    cleanup: () => {
      try {
        rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Codex scoped home cleanup warning: ${message}
`);
      }
    },
  };
}
function codexApprovalPolicy(request) {
  return asNonEmptyString(request.approvalPolicy) ?? 'on-request';
}
function codexSandbox(request) {
  return asNonEmptyString(request.sandbox) ?? 'workspace-write';
}
async function collectLifecycleVerificationEvents(
  client,
  threadId,
  request,
  cwd,
  allowNativeTools,
) {
  const events = [];
  const developerInstructions = buildDeveloperInstructions(
    request.messages ?? [],
    request.tools,
    allowNativeTools,
  );
  const commonParams = {
    model: codexModel(request),
    cwd,
    approvalPolicy: codexApprovalPolicy(request),
    sandbox: codexSandbox(request),
    developerInstructions,
  };
  try {
    const resumed = await client.send('thread/resume', {
      threadId,
      ...commonParams,
      personality: 'pragmatic',
    });
    events.push({
      kind: 'session_event',
      action: 'resumed',
      sessionId: resumed?.thread?.id ?? threadId,
      detail: resumed?.cwd ?? cwd,
    });
  } catch (error) {
    events.push({
      kind: 'partial_state',
      failureType: 'resume_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  let forkThreadId = null;
  try {
    const forked = await client.send('thread/fork', {
      threadId,
      ...commonParams,
      ephemeral: true,
    });
    forkThreadId = asNonEmptyString(forked?.thread?.id);
    if (!forkThreadId) {
      throw new Error('thread/fork did not return a fork thread id.');
    }
    events.push({
      kind: 'session_event',
      action: 'forked',
      sessionId: forkThreadId,
      parentSessionId: threadId,
      detail: forked?.cwd ?? cwd,
    });
  } catch (error) {
    events.push({
      kind: 'partial_state',
      failureType: 'fork_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (!forkThreadId) {
    return events;
  }
  const checkpointId = `${forkThreadId}:post-turn`;
  events.push({
    kind: 'checkpoint_created',
    checkpointId,
    label: 'Codex app-server fork checkpoint',
    detail: forkThreadId,
  });
  events.push({
    kind: 'rollback_started',
    checkpointId,
    label: 'Codex app-server fork rollback',
    detail: forkThreadId,
  });
  try {
    await client.send('thread/rollback', { threadId: forkThreadId, numTurns: 1 });
    events.push({
      kind: 'rollback_completed',
      checkpointId,
      label: 'Codex app-server fork rollback',
      detail: forkThreadId,
    });
  } catch (error) {
    events.push({
      kind: 'partial_state',
      failureType: 'rollback_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  return events;
}
async function runCodexTurn(payload) {
  const request = payload.request;
  if (!request || typeof request !== 'object') {
    throw Object.assign(new Error('Trusted host payload is missing request JSON.'), {
      code: 'invalid-request',
    });
  }
  const cwd = asNonEmptyString(payload.cwd) ?? process.cwd();
  assertSupportedRuntimeRequest(request);
  const allowNativeTools = isFullAgentRuntime(request);
  const codexExecutable = resolveCodexExecutable();
  const scopedHome = createScopedCodexHome(request);
  const child = spawn(codexExecutable, ['app-server', '--listen', 'stdio://'], {
    cwd,
    env: scopedHome.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = createJsonRpcClient(child);
  let timeout = null;
  const timeoutMs =
    typeof request.timeoutMs === 'number' &&
    Number.isFinite(request.timeoutMs) &&
    request.timeoutMs > 0
      ? request.timeoutMs
      : null;
  const responsePromise = new Promise((resolve, reject) => {
    let turnId = null;
    let threadId = null;
    let finalText = '';
    let reasoningText = '';
    let usage = createUsage();
    const runtimeEvents = [];
    const pendingToolCalls = /* @__PURE__ */ new Map();
    const completedToolCalls = /* @__PURE__ */ new Set();
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const resolveOnce = (response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    child.once('error', (error) => {
      rejectOnce(
        Object.assign(new Error(`Codex app-server failed to start: ${error.message}`), {
          code: 'spawn',
        }),
      );
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      rejectOnce(
        Object.assign(new Error(unexpectedExitMessage(client.stderrText(), code, signal)), {
          code: 'upstream',
        }),
      );
    });
    if (timeoutMs) {
      timeout = setTimeout(() => {
        rejectOnce(
          Object.assign(new Error(`Codex app-server timed out after ${timeoutMs}ms.`), {
            code: 'timeout',
          }),
        );
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      }, timeoutMs);
    }
    client.reader.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const message = parseJsonLine(trimmed);
        if (resolvePendingRequest(client, message)) {
          return;
        }
        if (rejectUnsupportedServerRequest(client, message)) {
          return;
        }
        if (allowNativeTools) {
          const runtimeEvent = mapRuntimeEventFromNotification(
            message,
            pendingToolCalls,
            completedToolCalls,
          );
          if (runtimeEvent) {
            runtimeEvents.push(runtimeEvent);
          }
        }
        switch (message?.method) {
          case 'error':
            if (message.params?.willRetry === true) {
              break;
            }
            {
              const errorParams = message.params?.error ?? message.params;
              const messageText =
                errorParams?.message ??
                message.params?.message ??
                'Codex app-server reported an error.';
              const detail = errorParams?.additionalDetails ?? message.params?.additionalDetails;
              rejectOnce(
                Object.assign(new Error(detail ? `${messageText} ${detail}` : messageText), {
                  code: 'upstream',
                }),
              );
            }
            break;
          case 'item/agentMessage/delta':
            if (turnMatches(turnId, message.params)) {
              finalText += message.params?.delta ?? '';
            }
            break;
          case 'item/completed':
            if (!turnMatches(turnId, message.params)) {
              break;
            }
            if (
              message.params?.item?.type === 'agentMessage' &&
              typeof message.params.item.text === 'string'
            ) {
              finalText = message.params.item.text;
            }
            {
              const nextReasoningText = reasoningSummaryText(message.params?.item);
              if (nextReasoningText) {
                reasoningText = nextReasoningText;
              }
            }
            break;
          case 'thread/tokenUsage/updated':
            if (turnMatches(turnId, message.params)) {
              usage = createUsage(message.params?.tokenUsage?.last);
            }
            break;
          case 'turn/completed': {
            const turn = message.params?.turn;
            if (turnId && turn?.id !== turnId) return;
            if (turn?.status !== 'completed') {
              const errorMessage =
                turn?.error?.message ??
                message.params?.turn?.error?.additionalDetails ??
                'Codex turn did not complete successfully.';
              rejectOnce(Object.assign(new Error(errorMessage), { code: 'upstream' }));
              return;
            }
            void (async () => {
              if (allowNativeTools && shouldCollectLifecycleVerificationEvents(request)) {
                const lifecycleThreadId = message.params?.threadId ?? turn?.threadId ?? threadId;
                if (typeof lifecycleThreadId === 'string' && lifecycleThreadId) {
                  runtimeEvents.push(
                    ...(await collectLifecycleVerificationEvents(
                      client,
                      lifecycleThreadId,
                      request,
                      cwd,
                      allowNativeTools,
                    )),
                  );
                }
              }
              resolveOnce({
                content: finalText,
                ...(reasoningText ? { reasoningContent: reasoningText } : {}),
                toolCalls: [],
                usage,
                ...(runtimeEvents.length > 0 ? { _offisimRuntimeEvents: runtimeEvents } : {}),
              });
            })().catch((error) => {
              rejectOnce(
                error instanceof Error
                  ? error
                  : Object.assign(new Error(String(error ?? 'Unknown Codex lifecycle error')), {
                      code: 'upstream',
                    }),
              );
            });
            break;
          }
          default:
            break;
        }
      } catch (error) {
        rejectOnce(
          error instanceof Error
            ? error
            : Object.assign(new Error(String(error ?? 'Unknown Codex app-server error')), {
                code: 'protocol',
              }),
        );
      }
    });
    (async () => {
      try {
        await client.send('initialize', {
          clientInfo: { name: 'offisim-desktop', version: '0.0.1' },
          capabilities: allowNativeTools ? { experimentalApi: true } : null,
        });
        client.sendNotification('initialized');
        const thread = await client.send('thread/start', {
          model: codexModel(request),
          cwd,
          approvalPolicy: codexApprovalPolicy(request),
          sandbox: codexSandbox(request),
          developerInstructions: buildDeveloperInstructions(
            request.messages ?? [],
            request.tools,
            allowNativeTools,
          ),
          ephemeral: !allowNativeTools,
          experimentalRawEvents: allowNativeTools,
          persistExtendedHistory: false,
          personality: 'pragmatic',
        });
        threadId = thread.thread.id;
        const started = await client.send('turn/start', {
          threadId,
          input: [
            {
              type: 'text',
              text: buildPrompt(request.messages ?? []),
              text_elements: [],
            },
          ],
          model: codexModel(request),
          effort: 'low',
          summary: 'none',
        });
        turnId = started.turn.id;
      } catch (error) {
        rejectOnce(
          error instanceof Error
            ? error
            : Object.assign(new Error(String(error ?? 'Unknown Codex app-server error')), {
                code: 'upstream',
              }),
        );
      }
    })();
  });
  try {
    return await responsePromise;
  } finally {
    if (timeout) clearTimeout(timeout);
    await client.close().catch(() => {});
    scopedHome.cleanup();
  }
}
async function main() {
  const payload = await readPayloadFromStdin();
  const response = await runCodexTurn(payload);
  process.stdout.write(JSON.stringify({ ok: true, response }));
}
main().catch((error) => {
  const code =
    typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'unknown';
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
      },
    }),
  );
  process.exit(1);
});
