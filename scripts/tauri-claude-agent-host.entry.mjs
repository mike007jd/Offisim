import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createClaudeWorkspaceGuard } from './claude-workspace-guard.mjs';
import {
  errorLine,
  executionPreparedLine,
  messageDeltaLine,
  messageEndLine,
  readyLine,
  resultLine,
  startedLine,
  toolLine,
} from './pi-agent-host-wire.mjs';

const ENGINE_ID = 'claude';
const ACCOUNT_ID = 'claude:local';
const BILLING_MODE = 'subscription';
const MODEL_ID = 'engine-managed';
const CLAUDE_ADAPTER = Object.freeze({ id: 'claude-cli', version: '1' });
const CLAUDE_CLI_SOURCE_URL = 'https://code.claude.com/docs/en/cli-usage';
const CLAUDE_AUTH_DOCS_URL = 'https://code.claude.com/docs/en/authentication';
const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_DETAIL_CHARS = 2_000;

let activeChild;
let terminating = false;

function emit(line) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function clampText(value, max = MAX_DETAIL_CHARS) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function redact(value) {
  const home = nonEmpty(process.env.HOME);
  let text = clampText(value);
  if (home) text = text.split(home).join('~');
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, 'Bearer [redacted]')
    .replace(/\b(?:sk-ant|sk-proj|sk-or-v1)-[A-Za-z0-9_-]+\b/gu, '[redacted]')
    .replace(
      /\b(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)\s*=\s*\S+/giu,
      '$1=[redacted]',
    );
}

function safeError(error) {
  return redact(error instanceof Error ? error.message : String(error ?? 'Unknown Claude error'));
}

function hostError(message, code = 'upstream') {
  return Object.assign(new Error(message), { code });
}

async function executable(path) {
  if (!path) return undefined;
  try {
    await access(path, fsConstants.X_OK);
    return path;
  } catch {
    return undefined;
  }
}

async function resolveClaudeExecutable() {
  const override = nonEmpty(process.env.OFFISIM_CLAUDE_EXECUTABLE);
  if (override) return executable(override);
  const candidates = [];
  const home = nonEmpty(process.env.HOME);
  if (home) candidates.push(join(home, '.local', 'bin', 'claude'));
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    candidates.push(join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude'));
  }
  candidates.push('/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude');
  for (const candidate of [...new Set(candidates)]) {
    const found = await executable(candidate);
    if (found) return found;
  }
  return undefined;
}

function claudeChildEnv() {
  const blocked = new Set([
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS',
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => !blocked.has(key) && value !== undefined),
  );
}

function runCaptured(binary, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env: claudeChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const capture = (target, chunk, bytes) => {
      const remaining = MAX_CAPTURE_BYTES - bytes;
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
      return bytes + chunk.length;
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes = capture(stdout, chunk, stdoutBytes);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes = capture(stderr, chunk, stderrBytes);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolveRun({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function orchestrationCapabilities() {
  return {
    stop: true,
    steer: false,
    resume: true,
    attachmentInput: { textFiles: true, images: 'unsupported' },
    permissionModes: ['plan', 'auto', 'full'],
    interactions: { approval: false, userInput: false },
    processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
    interactionRoutes: {
      browser: [
        {
          id: 'offisim-browser',
          source: 'offisim-local',
          label: 'Offisim Browser',
          availability: 'available',
        },
      ],
      computer: [
        {
          id: 'claude-native-computer',
          source: 'engine-native',
          label: 'Claude Computer Use',
          availability: 'unsupported',
          reason:
            'Claude Computer Use requires an interactive CLI session; this adapter uses non-interactive mode.',
        },
        {
          id: 'offisim-computer',
          source: 'offisim-local',
          label: 'Offisim local driver',
          availability: 'runtime-determined',
        },
      ],
    },
  };
}

function statusProjection({ state, version, statusReason, checkedAt }) {
  return {
    engineId: ENGINE_ID,
    displayName: 'Claude',
    state,
    ...(version ? { version } : {}),
    ...(statusReason ? { statusReason } : {}),
    loginCommand: 'claude auth login',
    docsUrl: CLAUDE_AUTH_DOCS_URL,
    sourceUrl: CLAUDE_CLI_SOURCE_URL,
    checkedAt,
    capabilities: orchestrationCapabilities(),
  };
}

async function inspectClaudeCli(cwd = process.cwd()) {
  const checkedAt = new Date().toISOString();
  const binary = await resolveClaudeExecutable();
  if (!binary) {
    return statusProjection({
      state: 'not-installed',
      statusReason: 'Install Claude CLI to run Claude tasks.',
      checkedAt,
    });
  }
  const versionResult = await runCaptured(binary, ['--version'], cwd);
  const version = nonEmpty(versionResult.stdout.split(/\r?\n/u).find((line) => line.trim()));
  if (versionResult.code !== 0 || !version) {
    return statusProjection({
      state: 'unavailable',
      statusReason: 'Claude CLI is installed but could not report its version.',
      checkedAt,
    });
  }
  const authResult = await runCaptured(binary, ['auth', 'status'], cwd);
  if (authResult.code !== 0) {
    return statusProjection({
      state: 'not-signed-in',
      version,
      statusReason: 'Sign in with `claude auth login`; credentials remain managed by Claude CLI.',
      checkedAt,
    });
  }
  try {
    const auth = JSON.parse(authResult.stdout);
    if (auth?.loggedIn === true) return statusProjection({ state: 'ready', version, checkedAt });
    return statusProjection({
      state: 'not-signed-in',
      version,
      statusReason: 'Sign in with `claude auth login`; credentials remain managed by Claude CLI.',
      checkedAt,
    });
  } catch {
    return statusProjection({
      state: 'unavailable',
      version,
      statusReason: 'Claude CLI login status could not be checked.',
      checkedAt,
    });
  }
}

function validateTarget(target) {
  if (
    !isRecord(target) ||
    target.engineId !== ENGINE_ID ||
    target.accountId !== ACCOUNT_ID ||
    target.billingMode !== BILLING_MODE ||
    target.modelId !== MODEL_ID ||
    !isRecord(target.modelSource) ||
    target.modelSource.kind !== 'native' ||
    'sourceUrl' in target.modelSource ||
    'checkedAt' in target.modelSource
  ) {
    throw hostError(
      'Claude execution requires the canonical local orchestration target.',
      'execution-target-mismatch',
    );
  }
  return {
    engineId: ENGINE_ID,
    accountId: ACCOUNT_ID,
    billingMode: BILLING_MODE,
    modelId: MODEL_ID,
    modelSource: { kind: 'native' },
  };
}

async function validatePayload(payload) {
  if (!isRecord(payload) || !['execute', 'enhance'].includes(payload.mode)) {
    throw hostError('Claude host received an unsupported request mode.', 'request-invalid');
  }
  const requestId = nonEmpty(payload.requestId);
  const text = nonEmpty(payload.text);
  if (!requestId || !text) {
    throw hostError('Claude requestId and text are required.', 'request-invalid');
  }
  const target = validateTarget(payload.expectedTarget);
  const cwd = await realpath(nonEmpty(payload.cwd) ?? process.cwd());
  const actualCwd = await realpath(process.cwd());
  if (cwd !== actualCwd) {
    throw hostError(
      'Claude workspace payload does not match the authorized process cwd.',
      'workspace-invalid',
    );
  }
  if (payload.mode === 'execute' && !nonEmpty(payload.rootRunId)) {
    throw hostError('Claude execute requires rootRunId.', 'request-invalid');
  }
  if (payload.mode === 'enhance' && !nonEmpty(payload.systemPrompt)) {
    throw hostError('Claude enhance requires systemPrompt.', 'request-invalid');
  }
  return { ...payload, requestId, text, target, cwd };
}

function permissionMode(value) {
  if (value === 'plan') return 'plan';
  if (value === 'full') return 'bypassPermissions';
  return 'acceptEdits';
}

function hookSettings(workspaceRoot) {
  const scriptPath = fileURLToPath(import.meta.url);
  return JSON.stringify({
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
    },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash|Edit|Write|NotebookEdit|Read|Glob|Grep',
          hooks: [
            {
              type: 'command',
              command: process.execPath,
              args: [scriptPath, '--workspace-hook', workspaceRoot],
            },
          ],
        },
      ],
    },
  });
}

function cliArgs(payload, sessionId) {
  const hasWorkspace = payload.mode === 'execute' && payload.workspaceAvailability === 'bound';
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--include-hook-events',
    '--setting-sources',
    '',
  ];
  if (hasWorkspace) {
    args.push('--permission-mode', permissionMode(payload.permissionMode));
    args.push('--settings', hookSettings(payload.cwd));
    const systemPrompt = nonEmpty(payload.systemPromptAppend);
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
    const skillPluginDir = nonEmpty(payload.skillPluginDir);
    if (skillPluginDir) args.push('--plugin-dir', skillPluginDir);
  } else {
    args.push('--permission-mode', 'plan', '--tools', '');
  }
  if (payload.mode === 'enhance') {
    args.push('--no-session-persistence', '--system-prompt', payload.systemPrompt);
  } else if (nonEmpty(payload.nativeSessionId)) {
    args.push('--resume', payload.nativeSessionId);
  } else {
    args.push('--session-id', sessionId);
  }
  args.push(payload.text);
  return args;
}

function summarizeToolInput(input) {
  if (!isRecord(input)) return undefined;
  for (const key of ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'query']) {
    const value = nonEmpty(input[key]);
    if (value) return clampText(value);
  }
  return Object.keys(input).length ? clampText(input) : undefined;
}

function usageProjection(frame, durationMs) {
  const usage = isRecord(frame.usage) ? frame.usage : {};
  const cacheCreation = finiteCount(usage.cache_creation_input_tokens);
  const cacheRead = finiteCount(usage.cache_read_input_tokens);
  const input = finiteCount(usage.input_tokens);
  const output = finiteCount(usage.output_tokens);
  const turns = finiteCount(frame.num_turns);
  const capturedAt = new Date().toISOString();
  return {
    scope: {
      kind: 'subscription-run-diagnostic',
      engineId: ENGINE_ID,
      accountId: ACCOUNT_ID,
      modelId: MODEL_ID,
    },
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheCreation !== undefined ? { cacheWrite: cacheCreation } : {}),
    ...(turns !== undefined ? { turns } : {}),
    inputAccounting: 'excludes-cache',
    outputAccounting: 'includes-reasoning',
    durationMs,
    usageSource: {
      kind: 'adapter',
      capturedAt,
      reference: CLAUDE_CLI_SOURCE_URL,
    },
    cost: {
      kind: 'unavailable',
      reason: '订阅内 · 无 API 成本',
    },
  };
}

function responseProvenance(target, runId) {
  return { ...target, runId, adapter: CLAUDE_ADAPTER };
}

function executionTargetDigest(target) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        accountId: target.accountId,
        billingMode: target.billingMode,
        engineId: target.engineId,
        modelId: target.modelId,
        modelSource: target.modelSource,
      }),
    )
    .digest('hex');
}

function consumeAssistantMessage(frame, state) {
  const content = Array.isArray(frame.message?.content) ? frame.message.content : [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && !state.partialTextSeen) {
      const text = nonEmpty(block.text);
      if (text) {
        state.text += text;
        emit(messageDeltaLine({ delta: text, channel: 'assistant' }));
      }
    } else if (block.type === 'thinking' && !state.partialThinkingSeen) {
      const thinking = nonEmpty(block.thinking);
      if (thinking) {
        state.reasoning += thinking;
        emit(messageDeltaLine({ delta: thinking, channel: 'reasoning' }));
      }
    } else if (block.type === 'tool_use') {
      const id = nonEmpty(block.id) ?? randomUUID();
      if (!state.tools.has(id)) {
        const toolName = nonEmpty(block.name) ?? 'ClaudeTool';
        state.tools.set(id, toolName);
        emit(
          toolLine({
            status: 'started',
            toolCallId: id,
            toolName,
            detail: summarizeToolInput(block.input),
          }),
        );
      }
    }
  }
}

function consumeToolResults(frame, state) {
  const content = Array.isArray(frame.message?.content) ? frame.message.content : [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_result') continue;
    const id = nonEmpty(block.tool_use_id);
    if (!id) continue;
    emit(
      toolLine({
        status: block.is_error === true ? 'failed' : 'completed',
        toolCallId: id,
        toolName: state.tools.get(id) ?? 'ClaudeTool',
        detail: clampText(block.content),
      }),
    );
    state.tools.delete(id);
  }
}

function consumeStreamEvent(frame, state) {
  const event = frame.event;
  if (!isRecord(event) || event.type !== 'content_block_delta' || !isRecord(event.delta)) return;
  if (event.delta.type === 'text_delta') {
    const delta = nonEmpty(event.delta.text);
    if (!delta) return;
    state.partialTextSeen = true;
    state.text += delta;
    emit(messageDeltaLine({ delta, channel: 'assistant' }));
  } else if (event.delta.type === 'thinking_delta') {
    const delta = nonEmpty(event.delta.thinking);
    if (!delta) return;
    state.partialThinkingSeen = true;
    state.reasoning += delta;
    emit(messageDeltaLine({ delta, channel: 'reasoning' }));
  }
}

async function runClaude(payloadValue) {
  const payload = await validatePayload(payloadValue);
  const binary = await resolveClaudeExecutable();
  if (!binary) throw hostError('Claude CLI is not installed.', 'host-unavailable');
  const sessionId = nonEmpty(payload.nativeSessionId) ?? randomUUID();
  const runId = nonEmpty(payload.rootRunId) ?? payload.requestId;
  const identity = responseProvenance(payload.target, runId);
  emit(
    executionPreparedLine({
      prepareId: randomUUID(),
      runId,
      identity,
      targetDigest: executionTargetDigest(payload.target),
      adapter: CLAUDE_ADAPTER,
    }),
  );

  const startedAt = Date.now();
  const child = spawn(binary, cliArgs(payload, sessionId), {
    cwd: payload.cwd,
    env: claudeChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeChild = child;
  const state = {
    started: false,
    text: '',
    reasoning: '',
    partialTextSeen: false,
    partialThinkingSeen: false,
    tools: new Map(),
    result: undefined,
    protocolError: undefined,
    stderr: '',
  };
  const stdout = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  stdout.on('line', (line) => {
    if (!line.trim()) return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      state.protocolError = hostError('Claude CLI emitted malformed stream-json.', 'protocol');
      child.kill('SIGTERM');
      return;
    }
    if (frame.type === 'system' && frame.subtype === 'init') {
      if (!state.started) {
        state.started = true;
        emit(startedLine({ sessionId: nonEmpty(frame.session_id) ?? sessionId }));
      }
    } else if (frame.type === 'stream_event') {
      consumeStreamEvent(frame, state);
    } else if (frame.type === 'assistant') {
      consumeAssistantMessage(frame, state);
    } else if (frame.type === 'user') {
      consumeToolResults(frame, state);
    } else if (frame.type === 'result') {
      state.result = frame;
    }
  });
  child.stderr.on('data', (chunk) => {
    if (state.stderr.length < MAX_CAPTURE_BYTES) state.stderr += chunk.toString('utf8');
  });
  const exit = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  activeChild = undefined;
  if (state.protocolError) throw state.protocolError;
  if (terminating || exit.signal === 'SIGINT' || exit.signal === 'SIGTERM') {
    throw hostError('Claude request stopped.', 'aborted');
  }
  const result = state.result;
  if (exit.code !== 0 || !isRecord(result) || result.is_error === true) {
    throw hostError(
      nonEmpty(result?.result) ?? nonEmpty(state.stderr) ?? 'Claude CLI did not complete the task.',
      'upstream',
    );
  }
  if (!state.started) emit(startedLine({ sessionId: nonEmpty(result.session_id) ?? sessionId }));
  const text = nonEmpty(result.result) ?? state.text;
  emit(messageEndLine({ text, stopReason: nonEmpty(result.stop_reason) ?? result.subtype }));
  const durationMs = Math.max(0, Date.now() - startedAt);
  emit(
    resultLine({
      text,
      ...(state.reasoning ? { reasoning: state.reasoning } : {}),
      ...(payload.mode === 'execute'
        ? { sessionId: nonEmpty(result.session_id) ?? sessionId }
        : {}),
      provenance: identity,
      usage: usageProjection(result, durationMs),
    }),
  );
}

async function readStdinJson() {
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of input) {
    if (!line.trim()) continue;
    input.close();
    return JSON.parse(line);
  }
  throw hostError('Claude host stdin closed before a request arrived.', 'protocol');
}

async function runWorkspaceHook(workspaceRoot) {
  const guard = createClaudeWorkspaceGuard(workspaceRoot);
  const input = await readStdinJson();
  const output = await guard(input);
  if (isRecord(output) && Object.keys(output).length) process.stdout.write(JSON.stringify(output));
}

async function shutdown() {
  if (terminating) return;
  terminating = true;
  const child = activeChild;
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 2_000);
  timer.unref();
}

async function main() {
  if (process.argv[2] === '--workspace-hook') {
    await runWorkspaceHook(process.argv[3]);
    return;
  }
  emit(readyLine());
  const payload = await readStdinJson();
  if (payload?.mode === 'status') {
    emit(resultLine(await inspectClaudeCli()));
    return;
  }
  await runClaude(payload);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

main().catch((error) => {
  if (process.argv[2] === '--workspace-hook') {
    process.stderr.write(safeError(error));
    process.exitCode = 2;
    return;
  }
  emit(errorLine({ code: nonEmpty(error?.code) ?? 'upstream', message: safeError(error) }));
  process.exitCode = 1;
});
