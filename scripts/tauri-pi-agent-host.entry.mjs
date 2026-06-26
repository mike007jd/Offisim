import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  isToolCallEventType,
} from '@earendil-works/pi-coding-agent';
import {
  errorLine,
  messageDeltaLine,
  messageEndLine,
  readyLine,
  resultLine,
  startedLine,
  toolLine,
  uiRequestLine,
} from './pi-agent-host-wire.mjs';
import {
  evaluateAskBashCommand,
  evaluateAutoBashCommand,
  normalizePermissionMode,
  toolAllowlistForMode,
} from './pi-agent-permission-modes.mts';
import { createChildSupervisor, createDelegationLimits } from './pi-child-supervisor.mjs';
import { createDelegationExtensionFactory } from './pi-delegation-extension.mjs';
import { createMissionBridgeExtensionFactory } from './pi-mission-bridge-extension.mjs';
import { createPublishArtifactExtensionFactory } from './pi-publish-artifact-extension.mjs';

/**
 * Pi thinking levels (reasoning effort), least → most. The renderer already
 * constrains its picker to this closed set; the host re-validates request input
 * before it reaches the SDK so an unknown string degrades to `undefined` (Pi
 * falls back to its own default) rather than being silently clamped to `off`. A
 * valid-but-unsupported level is left for Pi to clamp to the model's nearest
 * capability inside `createAgentSession`.
 */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function normalizeThinkingLevel(value) {
  return typeof value === 'string' && THINKING_LEVELS.includes(value) ? value : undefined;
}

// Ask mode pauses a tool call and asks the user through Pi's extension UI
// (`ctx.ui.confirm`). Pi's TUI would render that dialog itself; the host is
// headless, so we inject a custom `uiContext` (via `session.bindExtensions`) that
// forwards every blocking prompt to the renderer as a `uiRequest` line and parks
// the promise until a matching `uiResponse` line lands on stdin. The request id is
// minted by the uiContext (not the tool-call id), so any Pi UI primitive —
// confirm / select / input / editor — routes the same way. Mirrors Pi RPC's
// `extension_ui_request` / `extension_ui_response` while staying on
// `createAgentSession` (no persistent RPC sidecar).
let uiRequestSeq = 0;
const pendingUiRequests = new Map(); // request id -> settle(responseObject)

function requestUiResponse(method, fields, opts) {
  uiRequestSeq += 1;
  const id = `ui-${uiRequestSeq}`;
  emit(uiRequestLine({ id, method, ...fields }));
  return new Promise((resolve) => {
    const settle = (response) => {
      if (!pendingUiRequests.delete(id)) return;
      resolve(response);
    };
    pendingUiRequests.set(id, settle);
    // ExtensionUIDialogOptions: a parked prompt can be cancelled by an abort
    // signal or a timeout. Either way the primitive resolves to its "no answer"
    // value (false / undefined) so the agent loop never hangs.
    const signal = opts?.signal;
    if (signal?.aborted) settle({ id, cancelled: true });
    else if (signal)
      signal.addEventListener('abort', () => settle({ id, cancelled: true }), { once: true });
    const timeout = typeof opts?.timeout === 'number' ? opts.timeout : 0;
    if (timeout > 0) setTimeout(() => settle({ id, cancelled: true }), timeout).unref?.();
  });
}

function resolveUiResponse(response) {
  if (!response || typeof response.id !== 'string') return;
  const settle = pendingUiRequests.get(response.id);
  if (settle) settle(response);
}

/** stdin EOF / abort — unblock every parked prompt as cancelled so the loop unwinds. */
function rejectAllUiRequests() {
  for (const settle of [...pendingUiRequests.values()]) settle({ cancelled: true });
  pendingUiRequests.clear();
}

// A headless ExtensionUIContext: the four blocking primitives forward to the
// renderer; everything else is a no-op (a faithful copy of Pi's own
// `noOpUIContext`, which the SDK does not export). Injecting this — rather than
// leaving the default no-op in place — flips `ctx.hasUI` to true so extensions
// know their prompts are answerable.
function createForwardingUiContext() {
  return {
    select: async (title, options, opts) => {
      const r = await requestUiResponse('select', { title, options }, opts);
      return r.cancelled ? undefined : r.value;
    },
    confirm: async (title, message, opts) => {
      const r = await requestUiResponse('confirm', { title, message }, opts);
      return r.confirmed === true;
    },
    input: async (title, placeholder, opts) => {
      const r = await requestUiResponse('input', { title, placeholder }, opts);
      return r.cancelled ? undefined : r.value;
    },
    editor: async (title, prefill) => {
      const r = await requestUiResponse('editor', { title, prefill });
      return r.cancelled ? undefined : r.value;
    },
    notify: () => {},
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return undefined;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'UI not available' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}

/**
 * Build the inline Pi extension that enforces a permission mode at tool-call
 * time, or `null` when no runtime gate is needed. Plan is enforced by the static
 * read-only tool allowlist; Full is unrestricted. Auto blocks dangerous bash
 * synchronously; Ask pauses on the destructive-but-recoverable band and asks the
 * user through Pi's `ctx.ui.confirm` (the SDK awaits an async `tool_call` handler
 * before the tool runs). Lives here — not in the pure decision module — because
 * it needs the Pi SDK type guard + the extension UI context.
 */
function buildPermissionGate(mode) {
  if (mode === 'auto') {
    return (pi) => {
      pi.on('tool_call', (event) => {
        if (!isToolCallEventType('bash', event)) return undefined;
        const command = typeof event.input?.command === 'string' ? event.input.command : '';
        const verdict = evaluateAutoBashCommand(command);
        return verdict.block ? { block: true, reason: verdict.reason } : undefined;
      });
    };
  }
  if (mode === 'ask') {
    return (pi) => {
      pi.on('tool_call', async (event, ctx) => {
        if (!isToolCallEventType('bash', event)) return undefined;
        const command = typeof event.input?.command === 'string' ? event.input.command : '';
        const verdict = evaluateAskBashCommand(command);
        if (verdict.action === 'allow') return undefined;
        if (verdict.action === 'deny') return { block: true, reason: verdict.reason };
        // 'ask' → pause through Pi's extension UI and wait for the user's verdict.
        const message = verdict.reason ? `${verdict.reason}\n\n${command}` : command;
        const approved = await ctx.ui.confirm('Approve command?', message);
        return approved
          ? undefined
          : {
              block: true,
              reason: 'Rejected by operator — switch to Full mode to run without asking.',
            };
      });
    };
  }
  return null;
}

const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const TRUNCATED_SUFFIX = '\n[truncated by Offisim Pi host output cap]';

// Fixed-flow guidance (Phase 4): a prompt-template "skill" appended to the root
// agent's system prompt when delegation is available. It shapes the
// manager-as-tools loop into research → plan → implement → review → revise and
// tells the agent when to stop iterating — without a new scheduler or graph
// engine. Bounded by the supervisor's deterministic caps (depth / total / token
// budget); this only guides the order.
const DELEGATION_FLOW_GUIDANCE = [
  '## Working with your team',
  'You can hand bounded subtasks to teammates with the `delegate` tool, then',
  'synthesize their results into your own answer — you keep the conversation with',
  'the user. For a non-trivial goal, structure delegation as a flow and iterate:',
  '1. Research — delegate fact-finding / investigation (access: read).',
  '2. Plan — decide the approach from what you learned.',
  '3. Implement — delegate the concrete work (access: write); run independent',
  '   tasks in parallel (one delegate call, mode "parallel", multiple tasks).',
  '4. Review — delegate a check of the result (access: review); revise if needed.',
  'Iterate only while it moves the goal forward. Stop when the goal is met or the',
  'result is good enough — do not delegate busywork.',
].join('\n');

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
  // Rust gives every threadId its own session directory, so continuing the most
  // recent session here is simply "keep this conversation going". There is no
  // separate resume mode — same thread, same Pi session.
  const sessionManager = SessionManager.continueRecent(cwd, sessionDir);
  const model = selectedModel(modelRegistry, payload.model);
  if (payload.model && !model) {
    throw Object.assign(new Error(`Pi model override was not found: ${payload.model}`), {
      code: 'model-not-found',
    });
  }

  // Per-conversation permission mode (plan / ask / auto / full). Plan restricts
  // the tool set to the read-only built-ins (no gate needed — bash/edit/write are
  // never exposed); Ask pauses for recoverable destructive commands; Auto keeps
  // the full tool set but blocks catastrophic commands; Full leaves the session
  // unrestricted.
  const permissionMode = normalizePermissionMode(payload.permissionMode);
  const tools = toolAllowlistForMode(permissionMode);
  // Per-conversation thinking level (reasoning effort). Forwarded as a native
  // `createAgentSession` option; Pi clamps it to the model's capabilities (a
  // non-reasoning model collapses every level to `off`). Unknown → undefined so
  // Pi uses its settings/default level.
  const thinkingLevel = normalizeThinkingLevel(payload.thinkingLevel);
  const gateFactory = buildPermissionGate(permissionMode);
  // Per-employee persona, forwarded as the session's appended system prompt
  // (Pi's official `appendSystemPrompt` resource-loader option). Build one
  // DefaultResourceLoader whenever there's a permission gate OR a persona, and
  // merge both into it so Pi receives a single loader.
  const systemPromptAppend = asNonEmptyString(payload.systemPromptAppend);
  // Delegation: when the renderer supplies a root run id + thread id + a non-empty
  // company roster, register the `delegate` tool so the root agent can hand bounded
  // subtasks to teammates. Children are built in-process by the supervisor (see
  // Docs/DELEGATION_ARCHITECTURE.md), bounded by deterministic caps (depth /
  // concurrency / total / token budget), and may recursively delegate up to
  // maxDepth. When delegation is on, the fixed-flow guidance is appended too.
  const rootRunId = asNonEmptyString(payload.rootRunId);
  const threadId = asNonEmptyString(payload.threadId);
  const roster = Array.isArray(payload.roster) ? payload.roster : [];
  const delegationEnabled = Boolean(rootRunId && threadId && roster.length > 0);
  // Publish-artifact: register the `publish_artifact` tool whenever the run has a
  // root id + thread id (the scope fields the renderer needs to persist the
  // deliverable row). Independent of having a roster — a soloing agent can still
  // publish an artifact. Excluded from `plan` mode: planning is read-only, so the
  // agent cannot have written a file to publish (a publish there would be a
  // phantom row the renderer's workspace read rejects anyway).
  const publishArtifactEnabled = Boolean(rootRunId && threadId) && permissionMode !== 'plan';
  // Mission bridge (MS-005): register `submit_for_evaluation` + `query_mission_state`
  // only when this run carries a mission context packet (the renderer's
  // MissionRunController injects `missionContextJson` for an attempt). A plain chat
  // never sets it, so existing behavior is unchanged. The bridge needs the run
  // scope (rootRunId + threadId) to stamp its events so the renderer can correlate
  // submissions to the current attempt. Unlike publish_artifact it is allowed in
  // every mode — a mission run may legitimately submit a read-only criterion.
  const missionContextJson = asNonEmptyString(payload.missionContextJson);
  const missionEnabled = Boolean(rootRunId && threadId && missionContextJson);
  let resourceLoader;
  if (
    gateFactory ||
    systemPromptAppend ||
    delegationEnabled ||
    publishArtifactEnabled ||
    missionEnabled
  ) {
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const extensionFactories = [];
    if (gateFactory) extensionFactories.push(gateFactory);
    if (delegationEnabled) {
      // One shared limit budget for this whole user turn's delegation tree
      // (depth / concurrency / total children / per-child timeout).
      const supervisor = createChildSupervisor({
        emit,
        agentDir,
        authStorage,
        modelRegistry,
        cwd,
        settingsManager,
        threadId,
        rootRunId,
        roster,
        resolveModel: (modelId) => selectedModel(modelRegistry, modelId),
        buildPermissionGate,
        limits: createDelegationLimits(),
        depth: 0,
        parentRunId: rootRunId,
      });
      extensionFactories.push(createDelegationExtensionFactory(supervisor));
    }
    if (publishArtifactEnabled) {
      extensionFactories.push(
        createPublishArtifactExtensionFactory({
          emit,
          threadId,
          rootRunId,
          employeeId: asNonEmptyString(payload.employeeId),
          cwd,
        }),
      );
    }
    if (missionEnabled) {
      extensionFactories.push(
        createMissionBridgeExtensionFactory({
          emit,
          threadId,
          rootRunId,
          employeeId: asNonEmptyString(payload.employeeId),
          missionContextJson,
        }),
      );
    }
    // Append the employee persona and, when delegation is on, the fixed-flow
    // guidance — both are generic appended system prompts (Pi's official option).
    const appendSystemPrompt = [];
    if (systemPromptAppend) appendSystemPrompt.push(systemPromptAppend);
    if (delegationEnabled) appendSystemPrompt.push(DELEGATION_FLOW_GUIDANCE);
    resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
      ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt } : {}),
    });
    await resourceLoader.reload();
  }

  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    sessionManager,
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(tools ? { tools } : {}),
    ...(resourceLoader ? { resourceLoader } : {}),
  });

  // Ask mode is the only path that prompts the user mid-run. Bind a forwarding
  // UI context so the gate's `ctx.ui.confirm` routes through our stdin channel;
  // other modes leave Pi's default no-op context in place.
  if (permissionMode === 'ask') {
    await session.bindExtensions({ uiContext: createForwardingUiContext(), mode: 'rpc' });
  }

  let latestText = '';
  let activeReasoningText = '';
  let latestReasoningText = '';
  let emittedReasoning = false;
  // Root session's own token/cost accounting, summed across assistant turns and
  // returned on the result line. The renderer folds this into reconcileRoot — the
  // solo (non-delegation) path otherwise records no root usage at all.
  const rootUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
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
        // Accumulate this turn's usage (field names mirror the child supervisor's
        // exactly; SDK usage.cost is an object → `.total`).
        const u = event.message.usage;
        if (u) {
          rootUsage.input += u.input || 0;
          rootUsage.output += u.output || 0;
          rootUsage.cacheRead += u.cacheRead || 0;
          rootUsage.cacheWrite += u.cacheWrite || 0;
          rootUsage.cost += u.cost?.total || 0;
          rootUsage.turns += 1;
        }
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
        usage: rootUsage,
      }),
    );
  } finally {
    unsubscribe();
    session.dispose();
  }
}

// ── Prompt Enhance (PR-06) ───────────────────────────────────────────────────
//
// A DEDICATED one-shot path, fully isolated from `runPrompt`. Enhance turns a
// user-authored message into a clearer version under a versioned profile system
// prompt. It is NOT a work run: it must NEVER register a tool, NEVER bind a
// project workspace, and NEVER persist anything. The Rust `agent_runtime_enhance`
// command resolves a NEUTRAL cwd (no project) and forwards `mode:'enhance'` here;
// this function shares only the auth/model plumbing (the real Pi model call) with
// the execute path, nothing else.
//
// Isolation, enforced three ways so a regression can't silently re-arm tools:
//   1. `noTools: 'all'`  — the SDK starts with NO tools enabled.
//   2. `tools: []`       — the explicit allowlist enables nothing on top.
//   3. resourceLoader carries ONLY `appendSystemPrompt` (the profile prompt) and
//      ZERO `extensionFactories` — no permission gate, no delegation, no publish,
//      no mission bridge, no `ctx.ui` binding. There is no second stdin channel.
async function runEnhance(payload) {
  const text = asNonEmptyString(payload.text);
  if (!text) {
    throw Object.assign(new Error('Prompt enhance requests must include text.'), {
      code: 'invalid-request',
    });
  }
  const systemPrompt = asNonEmptyString(payload.systemPrompt);
  if (!systemPrompt) {
    throw Object.assign(new Error('Prompt enhance requests must include a profile system prompt.'), {
      code: 'invalid-request',
    });
  }
  // A neutral cwd (Rust passes a non-project dir). Never bind a workspace.
  const cwd = asNonEmptyString(payload.cwd) ?? process.cwd();
  const agentDir = asNonEmptyString(payload.agentDir);
  const { authStorage, modelRegistry } = createPiRegistries(agentDir);
  const model = selectedModel(modelRegistry, payload.model);
  if (payload.model && !model) {
    throw Object.assign(new Error(`Pi model override was not found: ${payload.model}`), {
      code: 'model-not-found',
    });
  }
  const thinkingLevel = normalizeThinkingLevel(payload.thinkingLevel);

  // No SessionManager persistence: a fresh, ephemeral session per enhance with no
  // session directory, so nothing is written to disk and no transcript survives.
  const sessionManager = SessionManager.create(cwd);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  // The profile system prompt is the ONLY appended prompt; NO extension factories.
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    appendSystemPrompt: [systemPrompt],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    sessionManager,
    resourceLoader,
    // Belt-and-suspenders tool suppression — see the isolation note above.
    noTools: 'all',
    tools: [],
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  });

  let latestText = '';
  const unsubscribe = session.subscribe((event) => {
    // Stream content deltas so the renderer can show a live, cancelable preview.
    if (event.type === 'message_update') {
      const streamEvent = event.assistantMessageEvent;
      if (streamEvent?.type === 'text_delta' && streamEvent.delta) {
        emit(messageDeltaLine({ channel: 'content', delta: clampText(streamEvent.delta) }));
      }
      return;
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      latestText = clampText(messageText(event.message));
      return;
    }
    // A tool event here would mean isolation broke. There is no tool registered,
    // so this branch is unreachable; if it ever fires, surface it loudly rather
    // than silently letting a tool run on the enhance path.
    if (
      event.type === 'tool_execution_start' ||
      event.type === 'tool_execution_update' ||
      event.type === 'tool_execution_end'
    ) {
      throw Object.assign(
        new Error('Prompt enhance must not execute tools — isolation breach.'),
        { code: 'enhance-isolation' },
      );
    }
  });

  try {
    await session.prompt(text);
    const enhanced = clampText(session.getLastAssistantText() || latestText);
    emit(
      resultLine({
        ok: true,
        // The enhanced text rides the existing `result` line's `text` field, so no
        // new wire kind and no protocol bump. The renderer distinguishes an enhance
        // result by which Tauri command it invoked (`agent_runtime_enhance`), not by
        // an in-band marker, so no discriminator field is added here.
        text: enhanced,
        sessionId: session.sessionId,
        model: session.model ? modelSummary(session.model) : undefined,
      }),
    );
  } finally {
    unsubscribe();
    session.dispose();
  }
}

// The host is line-delimited on stdin: the FIRST line is the execute/status
// payload, and (in Ask mode) every later line is a `uiResponse` answering a
// `uiRequest` the host emitted mid-run. stdin is read as a stream so the agent
// loop and response delivery run concurrently — the gate's awaited prompt
// resolves when its matching response line lands.
function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  let sawPayload = false;
  // The run settled (status emitted or prompt resolved): readline keeps stdin
  // open as an extension UI response channel, so exit explicitly rather than
  // waiting for EOF.
  const finishHost = () => {
    rl.close();
    process.exit(0);
  };

  rl.on('line', (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!sawPayload) {
      sawPayload = true;
      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch (error) {
        fail(error);
        return;
      }
      // Protocol handshake first: lets the Rust host detect a stale bundled host
      // before it processes any event line.
      emit(readyLine());
      if (payload.mode === 'status') {
        try {
          piStatus(payload);
        } catch (error) {
          fail(error);
          return;
        }
        finishHost();
        return;
      }
      if (payload.mode === 'enhance') {
        // Dedicated one-shot enhance path: no tools, no workspace, no persistence,
        // no extension-UI stdin channel. Single completion → finish.
        runEnhance(payload).then(finishHost, fail);
        return;
      }
      runPrompt(payload).then(finishHost, fail);
      return;
    }
    // Subsequent lines answer a uiRequest: { id, confirmed? | value? | cancelled? }.
    try {
      resolveUiResponse(JSON.parse(trimmed));
    } catch {
      // Ignore malformed response lines rather than crashing the run.
    }
  });

  // Parent closed stdin (process teardown / abort) — release any parked prompts.
  rl.on('close', rejectAllUiRequests);
}

main();
