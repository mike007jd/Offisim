import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import {
  errorLine,
  messageDeltaLine,
  messageEndLine,
  readyLine,
  resultLine,
  startedLine,
  toolLine,
} from './pi-agent-host-wire.mjs';

const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const TRUNCATED_SUFFIX = '\n[truncated by Offisim Pi host output cap]';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function emit(line) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function normalizePiErrorMessage(message) {
  if (/No API key found for the selected model/i.test(message)) {
    return 'Pi Agent is not logged in or has no available model. Sign in through Pi Agent, then refresh status and retry.';
  }
  return message;
}

function fail(error) {
  const code =
    typeof error === 'object' && error && typeof error.code === 'string'
      ? error.code
      : 'pi-agent-host';
  const rawMessage = error instanceof Error ? error.message : String(error ?? 'Unknown Pi error');
  const message = normalizePiErrorMessage(rawMessage);
  emit(errorLine({ code, message }));
  process.exit(1);
}

function clampText(value, maxBytes = MAX_TEXT_BYTES) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const suffixBytes = Buffer.byteLength(TRUNCATED_SUFFIX, 'utf8');
  const keepBytes = Math.max(0, maxBytes - suffixBytes);
  return Buffer.from(text, 'utf8').subarray(0, keepBytes).toString('utf8') + TRUNCATED_SUFFIX;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part?.type === 'text') return part.text ?? '';
      if (part?.type === 'thinking') return '';
      if (part?.type === 'toolCall') return '';
      return '';
    })
    .join('');
}

function thinkingText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part?.type === 'thinking') return part.thinking ?? part.text ?? '';
      return '';
    })
    .join('');
}

function messageText(message) {
  if (!message || typeof message !== 'object') return '';
  return contentText(message.content);
}

function messageThinking(message) {
  if (!message || typeof message !== 'object') return '';
  return thinkingText(message.content);
}

function modelSummary(model) {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name ?? model.id,
    api: model.api,
    reasoning: Boolean(model.reasoning),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    input: Array.isArray(model.input) ? model.input : [],
  };
}

function createPiRegistries(agentDir) {
  const authPath = agentDir ? join(agentDir, 'auth.json') : undefined;
  const modelsPath = agentDir ? join(agentDir, 'models.json') : undefined;
  if (authPath) mkdirSync(dirname(authPath), { recursive: true });
  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  return { agentDir, authPath, modelsPath, authStorage, modelRegistry };
}

function safeObjectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

function stripJsoncComments(value) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index + 1 < value.length && !/[\r\n]/u.test(value[index + 1])) {
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < value.length && !(value[index] === '*' && value[index + 1] === '/')) {
        if (/[\r\n]/u.test(value[index])) output += value[index];
        index += 1;
      }
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function stripJsoncTrailingCommas(value) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ',') {
      let cursor = index + 1;
      while (cursor < value.length && /\s/u.test(value[cursor])) {
        cursor += 1;
      }
      if (value[cursor] === '}' || value[cursor] === ']') {
        continue;
      }
    }
    output += char;
  }
  return output;
}

function parseJsonc(value) {
  return JSON.parse(stripJsoncTrailingCommas(stripJsoncComments(value)));
}

function modelsConfigSummary(modelsPath, modelRegistry) {
  const path = asNonEmptyString(modelsPath);
  if (!path) {
    return {
      exists: false,
      providerCount: 0,
      modelCount: 0,
      overrideCount: 0,
      providers: [],
    };
  }
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      providerCount: 0,
      modelCount: 0,
      overrideCount: 0,
      providers: [],
    };
  }
  const registryError =
    modelRegistry && typeof modelRegistry.getError === 'function'
      ? modelRegistry.getError()
      : undefined;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = parseJsonc(raw);
    const providerEntries =
      parsed?.providers && typeof parsed.providers === 'object'
        ? Object.entries(parsed.providers)
        : [];
    let modelCount = 0;
    let overrideCount = 0;
    for (const [, providerConfig] of providerEntries) {
      if (Array.isArray(providerConfig?.models)) {
        modelCount += providerConfig.models.length;
      }
      overrideCount += safeObjectKeys(providerConfig?.modelOverrides).length;
    }
    return {
      path,
      exists: true,
      providerCount: providerEntries.length,
      modelCount,
      overrideCount,
      providers: providerEntries.map(([provider]) => provider).sort(),
      ...(registryError ? { parseError: registryError } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Invalid models.json');
    return {
      path,
      exists: true,
      providerCount: 0,
      modelCount: 0,
      overrideCount: 0,
      providers: [],
      parseError: registryError ?? message,
    };
  }
}

function selectedModel(modelRegistry, override) {
  const raw = asNonEmptyString(override);
  if (!raw) return undefined;
  const [provider, ...rest] = raw.includes('/') ? raw.split('/') : [];
  if (provider && rest.length > 0) {
    return modelRegistry.find(provider, rest.join('/'));
  }
  return modelRegistry.getAll().find((model) => model.id === raw);
}

function lastAssistantMessage(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index];
  }
  return undefined;
}

function piStatus(payload) {
  const { agentDir, authPath, modelsPath, authStorage, modelRegistry } = createPiRegistries(
    asNonEmptyString(payload.agentDir),
  );
  const providers = Array.from(
    new Set(modelRegistry.getAll().map((model) => model.provider)),
  ).sort();
  const providerStatus = providers.map((provider) => ({
    provider,
    displayName: modelRegistry.getProviderDisplayName(provider),
    auth: modelRegistry.getProviderAuthStatus(provider),
  }));
  emit(
    resultLine({
      ok: true,
      authProviders: authStorage.list().sort(),
      providerStatus,
      availableModels: modelRegistry.getAvailable().map(modelSummary),
      allModelCount: modelRegistry.getAll().length,
      paths: {
        agentDir,
        authPath,
        modelsPath,
      },
      modelsConfig: modelsConfigSummary(modelsPath, modelRegistry),
      checkedAt: new Date().toISOString(),
    }),
  );
}

async function runPrompt(payload) {
  const cwd = asNonEmptyString(payload.cwd) ?? process.cwd();
  const text = asNonEmptyString(payload.text);
  if (!text) {
    throw Object.assign(new Error('Pi Agent requests must include text.'), {
      code: 'invalid-request',
    });
  }

  const agentDir = asNonEmptyString(payload.agentDir);
  const { authStorage, modelRegistry } = createPiRegistries(agentDir);
  const sessionDir = asNonEmptyString(payload.sessionDir);
  if (sessionDir) mkdirSync(sessionDir, { recursive: true });
  const sessionManager =
    payload.resume === true
      ? SessionManager.continueRecent(cwd, sessionDir)
      : SessionManager.continueRecent(cwd, sessionDir);
  const model = selectedModel(modelRegistry, payload.model);
  if (payload.model && !model) {
    throw Object.assign(new Error(`Pi model override was not found: ${payload.model}`), {
      code: 'model-not-found',
    });
  }

  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    sessionManager,
    ...(model ? { model } : {}),
  });

  let latestText = '';
  let activeReasoningText = '';
  let latestReasoningText = '';
  let emittedReasoning = false;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'agent_start') {
      emit(
        startedLine({
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
          model: session.model ? modelSummary(session.model) : undefined,
          modelFallbackMessage,
        }),
      );
      return;
    }
    if (event.type === 'message_update') {
      const streamEvent = event.assistantMessageEvent;
      if (streamEvent?.type === 'text_delta' && streamEvent.delta) {
        emit(messageDeltaLine({ channel: 'content', delta: clampText(streamEvent.delta) }));
      }
      if (streamEvent?.type === 'thinking_delta' && streamEvent.delta) {
        activeReasoningText += streamEvent.delta;
        emittedReasoning = true;
        emit(messageDeltaLine({ channel: 'reasoning', delta: clampText(streamEvent.delta) }));
      }
      return;
    }
    if (event.type === 'message_end') {
      if (event.message?.role === 'assistant') {
        const reasoningText = clampText(messageThinking(event.message) || activeReasoningText);
        if (reasoningText && !activeReasoningText.trim()) {
          emittedReasoning = true;
          emit(messageDeltaLine({ channel: 'reasoning', delta: reasoningText }));
        }
        latestReasoningText = reasoningText;
        activeReasoningText = '';
        latestText = clampText(messageText(event.message));
        emit(
          messageEndLine({
            text: latestText,
            stopReason: event.message.stopReason,
            errorMessage: event.message.errorMessage,
          }),
        );
      }
      return;
    }
    if (event.type === 'tool_execution_start') {
      emit(
        toolLine({
          status: 'started',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          detail: event.args ? clampText(JSON.stringify(event.args), 4096) : undefined,
        }),
      );
      return;
    }
    if (event.type === 'tool_execution_update') {
      emit(
        toolLine({
          status: 'running',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          detail: event.partialResult
            ? clampText(JSON.stringify(event.partialResult), 4096)
            : undefined,
        }),
      );
      return;
    }
    if (event.type === 'tool_execution_end') {
      emit(
        toolLine({
          status: event.isError ? 'failed' : 'completed',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          detail: event.result ? clampText(JSON.stringify(event.result), 4096) : undefined,
        }),
      );
    }
  });

  try {
    await session.prompt(text);
    const fallbackReasoning = clampText(messageThinking(lastAssistantMessage(session)));
    const finalReasoning = clampText(latestReasoningText || fallbackReasoning);
    if (fallbackReasoning && !emittedReasoning) {
      emit(messageDeltaLine({ channel: 'reasoning', delta: fallbackReasoning }));
    }
    // Fall back to the streamed messageEnd text when the SDK returns an empty
    // final string — `??` would keep the empty string (only null/undefined are
    // nullish), surfacing a blank result line.
    const finalText = clampText(session.getLastAssistantText() || latestText);
    emit(
      resultLine({
        ok: true,
        text: finalText,
        reasoning: finalReasoning || undefined,
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
        model: session.model ? modelSummary(session.model) : undefined,
      }),
    );
  } finally {
    unsubscribe();
    session.dispose();
  }
}

async function main() {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  // Protocol handshake first: lets the Rust host detect a stale bundled host
  // before it processes any event line.
  emit(readyLine());
  if (payload.mode === 'status') {
    piStatus(payload);
    return;
  }
  await runPrompt(payload);
}

main().catch(fail);
