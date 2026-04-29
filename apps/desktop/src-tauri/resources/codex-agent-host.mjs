#!/usr/bin/env node

// scripts/tauri-codex-agent-host.mjs
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
function resolveCodexExecutable() {
  const explicit = asNonEmptyString(process.env.OFFISIM_CODEX_EXECUTABLE);
  if (explicit && pathHasExecutable(explicit)) {
    return explicit;
  }
  if (pathHasExecutable('codex')) {
    return 'codex';
  }
  if (process.platform === 'darwin') {
    const appCandidates = [
      '/Applications/Codex.app/Contents/Resources/codex',
      process.env.HOME
        ? join(process.env.HOME, 'Applications/Codex.app/Contents/Resources/codex')
        : null,
    ].filter(Boolean);
    for (const candidate of appCandidates) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }
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
function buildDeveloperInstructions(messages, tools) {
  const sections = [
    "You are Offisim's trusted Codex local-auth bridge.",
    'Return exactly one plain assistant reply.',
    'If tools are available in this trusted workspace, use them when needed to verify file or shell work before claiming completion.',
  ];
  const systemPrompt = buildSystemPrompt(messages);
  if (systemPrompt) {
    sections.push('Follow these higher-priority system instructions:');
    sections.push(systemPrompt.join('\n\n'));
  }
  if (Array.isArray(tools) && tools.length > 0) {
    sections.push(
      'The upstream caller supplied Offisim tool definitions. Prefer native trusted-host tools when they are available; if they are unavailable, state that explicitly instead of simulating tool results.',
    );
  }
  return sections.join('\n\n');
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
async function runCodexTurn(payload) {
  const request = payload.request;
  if (!request || typeof request !== 'object') {
    throw Object.assign(new Error('Trusted host payload is missing request JSON.'), {
      code: 'invalid-request',
    });
  }
  const cwd = asNonEmptyString(payload.cwd) ?? process.cwd();
  const codexExecutable = resolveCodexExecutable();
  const child = spawn(codexExecutable, ['app-server', '--listen', 'stdio://'], {
    cwd,
    env: process.env,
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
    let finalText = '';
    let reasoningText = '';
    let usage = createUsage();
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
        switch (message?.method) {
          case 'error':
            rejectOnce(
              Object.assign(
                new Error(message.params?.message ?? 'Codex app-server reported an error.'),
                {
                  code: 'upstream',
                },
              ),
            );
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
            resolveOnce({
              content: finalText,
              ...(reasoningText ? { reasoningContent: reasoningText } : {}),
              toolCalls: [],
              usage,
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
          capabilities: null,
        });
        client.sendNotification('initialized');
        const thread = await client.send('thread/start', {
          model: asNonEmptyString(request.model) ?? 'gpt-5.4',
          cwd,
          approvalPolicy: asNonEmptyString(request.approvalPolicy) ?? 'on-request',
          sandbox: asNonEmptyString(request.sandbox) ?? 'workspace-write',
          developerInstructions: buildDeveloperInstructions(request.messages ?? [], request.tools),
          ephemeral: true,
          experimentalRawEvents: false,
          persistExtendedHistory: false,
          personality: 'pragmatic',
        });
        const started = await client.send('turn/start', {
          threadId: thread.thread.id,
          input: [
            {
              type: 'text',
              text: buildPrompt(request.messages ?? []),
              text_elements: [],
            },
          ],
          model: asNonEmptyString(request.model) ?? 'gpt-5.4',
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
