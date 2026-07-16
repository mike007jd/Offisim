import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import { query } from '@anthropic-ai/claude-agent-sdk';
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
  uiRequestLine,
} from './pi-agent-host-wire.mjs';
import { executionTargetDigest } from './pi-execution-provenance.mjs';

const CLAUDE_AGENT_SDK_VERSION = '0.3.211';
const CLAUDE_ADAPTER = Object.freeze({
  id: 'claude-agent-sdk',
  version: CLAUDE_AGENT_SDK_VERSION,
});
const MODEL_SOURCE_URL = 'https://code.claude.com/docs/en/agent-sdk/typescript';
const USAGE_SOURCE_URL = 'https://code.claude.com/docs/en/agent-sdk/typescript';
const MAX_TEXT_CHARS = 4_000_000;
const MAX_REASONING_CHARS = 2_000_000;
const MAX_DETAIL_CHARS = 2_000;
const EXECUTION_ACK_TIMEOUT_MS = 15_000;

let activeAbortController;
let activeQuery;
let activeInputClose;
let hostTerminating = false;
let uiSequence = 0;
let pendingExecutionAck;
const pendingUiRequests = new Map();

function emit(line) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clampText(value, max = MAX_DETAIL_CHARS) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function redact(value) {
  const home = nonEmpty(process.env.HOME);
  let text = clampText(value);
  if (home) text = text.split(home).join('~');
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-ant|sk-proj|sk-or-v1)-[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\b(?:ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)\s*=\s*\S+/gi, '$1=[redacted]');
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown Claude error');
  return redact(message || 'Claude Code did not complete the request.');
}

function fail(error) {
  if (hostTerminating) return;
  hostTerminating = true;
  rejectPending(new Error('Claude host stopped before the pending response completed.'));
  emit(errorLine({ code: nonEmpty(error?.code) ?? 'upstream', message: safeError(error) }));
  void shutdown(true).finally(() => process.exit(1));
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
  const candidates = [];
  const override = nonEmpty(process.env.OFFISIM_CLAUDE_EXECUTABLE);
  if (override) candidates.push(override);
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
  throw Object.assign(
    new Error(
      'Claude Code is not installed. Install it, then run `claude auth login` in Terminal.',
    ),
    { code: 'host-unavailable' },
  );
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
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => !blocked.has(key) && value !== undefined),
  );
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'offisim/1.0.0-rc.1';
  return env;
}

function accountId(account) {
  const material = [
    nonEmpty(account?.email),
    nonEmpty(account?.organization),
    nonEmpty(account?.subscriptionType),
    nonEmpty(account?.apiProvider),
  ]
    .filter(Boolean)
    .join('\0');
  if (!material) return undefined;
  const fingerprint = createHash('sha256').update(material).digest('hex').slice(0, 20);
  return `claude:subscription:${fingerprint}`;
}

function requireSubscriptionAccount(account) {
  const id = accountId(account);
  const subscriptionType = nonEmpty(account?.subscriptionType);
  if (!id || !subscriptionType || account?.apiProvider !== 'firstParty') {
    throw Object.assign(
      new Error(
        'Claude Code is not using a Claude subscription. Run `claude auth login` and select your Claude.ai account.',
      ),
      { code: 'subscription-unavailable' },
    );
  }
  return { id, subscriptionType };
}

function unavailableCapability(reason) {
  return { status: 'unavailable', reason };
}

function availableCapability() {
  return { status: 'available' };
}

function unavailableStatus(reason, checkedAt = new Date().toISOString()) {
  return {
    accounts: [
      {
        engineId: 'claude',
        accountId: 'claude-subscription-unavailable',
        billingMode: 'subscription',
        displayName: 'Claude subscription',
        status: 'unavailable',
        statusReason: reason,
        capabilities: {
          execute: unavailableCapability(reason),
          models: unavailableCapability('Claude native models are unavailable.'),
          usage: unavailableCapability('Claude plan Usage is unavailable.'),
          cost: unavailableCapability('Subscription usage is not converted into API cost.'),
        },
        usage: null,
      },
    ],
    models: [],
    checkedAt,
  };
}

function modelRows(models, account, checkedAt) {
  return (Array.isArray(models) ? models : [])
    .map((model) => {
      const selector = nonEmpty(model?.value);
      const modelId = nonEmpty(model?.resolvedModel) ?? selector;
      if (!selector || !modelId) return undefined;
      const efforts = Array.isArray(model.supportedEffortLevels)
        ? model.supportedEffortLevels
            .filter((value) => typeof value === 'string' && value.trim())
            .map((id) => ({ id }))
        : [];
      return {
        engineId: 'claude',
        accountId: account.id,
        billingMode: 'subscription',
        modelId,
        displayName: nonEmpty(model.displayName) ?? modelId,
        runtimeModelRef: `claude:${selector}`,
        availability: 'available',
        ...(efforts.length ? { defaultReasoningEffort: 'high', reasoningEfforts: efforts } : {}),
        capabilities: {
          textInput: true,
          imageInput: true,
          tools: true,
          reasoning: model.supportsEffort === true || model.supportsAdaptiveThinking === true,
        },
        source: { kind: 'native', sourceUrl: MODEL_SOURCE_URL, checkedAt },
      };
    })
    .filter(Boolean);
}

function statusProjection(initialization, checkedAt = new Date().toISOString()) {
  const account = requireSubscriptionAccount(initialization?.account);
  const models = modelRows(initialization?.models, account, checkedAt);
  if (!models.length) {
    throw Object.assign(new Error('Claude Code did not report any native models.'), {
      code: 'model-catalog-unavailable',
    });
  }
  const usageReason = 'Run a Claude task to refresh provider-native plan Usage.';
  return {
    accounts: [
      {
        engineId: 'claude',
        accountId: account.id,
        billingMode: 'subscription',
        displayName: account.subscriptionType,
        status: 'available',
        capabilities: {
          execute: availableCapability(),
          models: availableCapability(),
          usage: unavailableCapability(usageReason),
          cost: unavailableCapability('Subscription usage is not converted into API cost.'),
        },
        usage: null,
      },
    ],
    models,
    checkedAt,
  };
}

function idlePromptStream() {
  return (async function* waitForever() {
    await new Promise(() => undefined);
  })();
}

function baseOptions(executablePath, cwd) {
  return {
    pathToClaudeCodeExecutable: executablePath,
    cwd,
    env: claudeChildEnv(),
    settingSources: [],
    tools: [],
    permissionMode: 'dontAsk',
    persistSession: false,
  };
}

async function runStatus() {
  const checkedAt = new Date().toISOString();
  let sdkQuery;
  try {
    const executablePath = await resolveClaudeExecutable();
    sdkQuery = query({
      prompt: idlePromptStream(),
      options: baseOptions(executablePath, process.cwd()),
    });
    const initialization = await sdkQuery.initializationResult();
    emit(resultLine(statusProjection(initialization, checkedAt)));
  } catch (error) {
    emit(resultLine(unavailableStatus(safeError(error), checkedAt)));
  } finally {
    sdkQuery?.close();
  }
}

function validatePayload(payload) {
  if (!isRecord(payload))
    throw Object.assign(new Error('Claude request must be an object.'), {
      code: 'invalid-request',
    });
  const mode = nonEmpty(payload.mode);
  if (!['execute', 'enhance'].includes(mode)) {
    throw Object.assign(new Error(`Unsupported Claude request mode: ${mode ?? '(missing)'}.`), {
      code: 'invalid-request',
    });
  }
  for (const field of ['requestId', 'text', 'runtimeModelRef']) {
    if (!nonEmpty(payload[field])) {
      throw Object.assign(new Error(`${field} is required for Claude.`), {
        code: 'invalid-request',
      });
    }
  }
  if (!isRecord(payload.expectedTarget)) {
    throw Object.assign(new Error('expectedTarget is required for Claude.'), {
      code: 'invalid-request',
    });
  }
  if (mode === 'execute' && !nonEmpty(payload.rootRunId)) {
    throw Object.assign(new Error('rootRunId is required for Claude work.'), {
      code: 'invalid-request',
    });
  }
  return mode;
}

function selectedModel(initialization, runtimeModelRef) {
  const selector = nonEmpty(runtimeModelRef)?.startsWith('claude:')
    ? nonEmpty(runtimeModelRef).slice('claude:'.length)
    : undefined;
  if (!selector) {
    throw Object.assign(new Error('The Claude runtime model selector is invalid.'), {
      code: 'execution-target-mismatch',
    });
  }
  const row = initialization.models?.find((candidate) => candidate.value === selector);
  const modelId = nonEmpty(row?.resolvedModel) ?? nonEmpty(row?.value);
  if (!row || !modelId) {
    throw Object.assign(new Error('The selected Claude native model is unavailable.'), {
      code: 'execution-target-mismatch',
    });
  }
  return { row, selector, modelId };
}

function validateExecutionTarget(payload, initialization, selected) {
  const account = requireSubscriptionAccount(initialization.account);
  const target = payload.expectedTarget;
  const source = target.modelSource;
  const checkedAt = nonEmpty(source?.checkedAt);
  if (
    target.engineId !== 'claude' ||
    target.billingMode !== 'subscription' ||
    target.accountId !== account.id ||
    target.modelId !== selected.modelId ||
    source?.kind !== 'native' ||
    source?.sourceUrl !== MODEL_SOURCE_URL ||
    !checkedAt ||
    !Number.isFinite(Date.parse(checkedAt))
  ) {
    throw Object.assign(
      new Error('The selected Claude account or exact model changed before execution.'),
      {
        code: 'execution-target-mismatch',
      },
    );
  }
  return {
    identity: {
      engineId: 'claude',
      accountId: account.id,
      billingMode: 'subscription',
      modelId: selected.modelId,
      modelSource: { kind: 'native', sourceUrl: MODEL_SOURCE_URL, checkedAt },
      runId: payload.rootRunId ?? payload.requestId,
      adapter: CLAUDE_ADAPTER,
    },
    account,
  };
}

function waitForExecutionAck(payload, identity) {
  const prepareId = `claude-prepare-${randomUUID()}`;
  const targetDigest = executionTargetDigest(payload.expectedTarget, payload.runtimeModelRef);
  const acknowledged = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingExecutionAck = undefined;
      reject(
        Object.assign(new Error('Claude execution target acknowledgement timed out.'), {
          code: 'execution-target-ack-timeout',
        }),
      );
    }, EXECUTION_ACK_TIMEOUT_MS);
    pendingExecutionAck = {
      requestId: payload.requestId,
      prepareId,
      targetDigest,
      resolve: () => {
        clearTimeout(timer);
        pendingExecutionAck = undefined;
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        pendingExecutionAck = undefined;
        reject(error);
      },
    };
  });
  emit(
    executionPreparedLine({
      prepareId,
      runId: identity.runId,
      identity,
      targetDigest,
      adapter: CLAUDE_ADAPTER,
    }),
  );
  return acknowledged;
}

function resolveExecutionAck(message) {
  if (message?.type !== 'executionTargetAck' || !pendingExecutionAck) return false;
  const pending = pendingExecutionAck;
  if (
    message.requestId !== pending.requestId ||
    message.prepareId !== pending.prepareId ||
    message.targetDigest !== pending.targetDigest
  ) {
    pending.reject(
      Object.assign(new Error('Claude execution target acknowledgement did not match.'), {
        code: 'execution-target-ack-invalid',
      }),
    );
    return true;
  }
  pending.resolve();
  return true;
}

function createPromptStream(text) {
  let releasePrompt;
  let closeInput;
  const promptGate = new Promise((resolve) => {
    releasePrompt = resolve;
  });
  const closeGate = new Promise((resolve) => {
    closeInput = resolve;
  });
  const stream = (async function* promptStream() {
    await promptGate;
    yield {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
    };
    await closeGate;
  })();
  return { stream, releasePrompt, closeInput };
}

function permissionOptions(mode) {
  switch (mode) {
    case 'plan':
      return { permissionMode: 'plan' };
    case 'ask':
      return { permissionMode: 'default' };
    case 'auto':
    case undefined:
      return { permissionMode: 'auto' };
    case 'full':
      return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true };
    default:
      throw Object.assign(new Error(`Unsupported Claude permission mode: ${String(mode)}.`), {
        code: 'invalid-request',
      });
  }
}

function thinkingOptions(level) {
  switch (level) {
    case 'off':
      return { thinking: { type: 'disabled' } };
    case 'minimal':
    case 'low':
      return { effort: 'low' };
    case 'medium':
    case 'high':
    case 'xhigh':
      return { effort: level };
    case undefined:
    case null:
    case '':
      return {};
    default:
      throw Object.assign(new Error(`Unsupported Claude thinking level: ${String(level)}.`), {
        code: 'invalid-request',
      });
  }
}

function requestUi(method, fields, signal) {
  uiSequence += 1;
  const id = `claude-ui-${uiSequence}`;
  return new Promise((resolve) => {
    const settle = (response) => {
      if (!pendingUiRequests.delete(id)) return;
      resolve(response);
    };
    pendingUiRequests.set(id, settle);
    emit(uiRequestLine({ id, method, ...fields }));
    if (signal?.aborted) settle({ id, cancelled: true });
    else signal?.addEventListener('abort', () => settle({ id, cancelled: true }), { once: true });
  });
}

function resolveUiResponse(message) {
  const id = nonEmpty(message?.id);
  const settle = id ? pendingUiRequests.get(id) : undefined;
  if (!settle) return false;
  settle(message);
  return true;
}

function structuredQuestions(input) {
  if (
    !Array.isArray(input?.questions) ||
    input.questions.length < 1 ||
    input.questions.length > 4
  ) {
    return undefined;
  }
  const questions = input.questions.map((question, index) => {
    const text = nonEmpty(question?.question);
    const header = nonEmpty(question?.header);
    if (
      !text ||
      !header ||
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 4
    ) {
      return undefined;
    }
    const options = question.options
      .map((option) => ({
        label: nonEmpty(option?.label),
        ...(nonEmpty(option?.description) ? { description: nonEmpty(option.description) } : {}),
      }))
      .filter((option) => option.label);
    if (options.length !== question.options.length) return undefined;
    return {
      id: `claude-question-${index + 1}`,
      header: clampText(header, 12),
      question: clampText(text, 16_384),
      options,
      multiSelect: question.multiSelect === true,
      isOther: true,
      isSecret: false,
    };
  });
  return questions.every(Boolean) ? questions : undefined;
}

function parseStructuredAnswers(rawValue, projected, nativeQuestions) {
  let parsed;
  try {
    parsed = JSON.parse(nonEmpty(rawValue) ?? '');
  } catch {
    return undefined;
  }
  if (!isRecord(parsed?.answers) || Object.keys(parsed.answers).length !== projected.length) {
    return undefined;
  }
  const answers = {};
  for (let index = 0; index < projected.length; index += 1) {
    const projectedQuestion = projected[index];
    const nativeQuestion = nativeQuestions[index];
    const values = parsed.answers[projectedQuestion.id]?.answers;
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      (!projectedQuestion.multiSelect && values.length !== 1) ||
      values.some((value) => !nonEmpty(value))
    ) {
      return undefined;
    }
    answers[nativeQuestion.question] = projectedQuestion.multiSelect
      ? values.map((value) => nonEmpty(value)).join(', ')
      : nonEmpty(values[0]);
  }
  return answers;
}

async function canUseTool(toolName, input, options) {
  if (toolName === 'AskUserQuestion') {
    const questions = structuredQuestions(input);
    if (!questions) {
      return { behavior: 'deny', message: 'Claude produced an unsupported question shape.' };
    }
    const response = await requestUi(
      'requestUserInput',
      {
        title: questions[0].header,
        message: questions.map((question) => question.question).join('\n'),
        params: { questions },
      },
      options.signal,
    );
    if (response.cancelled) {
      return { behavior: 'deny', message: 'The user skipped this question.' };
    }
    const answers = parseStructuredAnswers(response.value, questions, input.questions);
    if (!answers) {
      return { behavior: 'deny', message: 'The user response was incomplete or invalid.' };
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }

  const detail = [nonEmpty(options.title), nonEmpty(options.description), summarizeToolInput(input)]
    .filter(Boolean)
    .join('\n');
  const response = await requestUi(
    'confirm',
    {
      title: nonEmpty(options.title) ?? `Allow ${toolName}?`,
      message: redact(detail || `Claude wants to use ${toolName}.`),
    },
    options.signal,
  );
  if (response.confirmed === true && !response.cancelled) {
    return { behavior: 'allow', updatedInput: input };
  }
  return { behavior: 'deny', message: 'The user rejected this action.' };
}

function summarizeToolInput(input) {
  if (!isRecord(input)) return undefined;
  for (const key of ['description', 'command', 'file_path', 'path', 'query']) {
    const value = nonEmpty(input[key]);
    if (value) return redact(value);
  }
  return undefined;
}

function modelSummary(selected) {
  return {
    provider: 'anthropic',
    id: selected.modelId,
    catalogId: selected.selector,
    name: nonEmpty(selected.row.displayName) ?? selected.modelId,
    api: 'claude-agent-sdk',
    reasoning:
      selected.row.supportsEffort === true || selected.row.supportsAdaptiveThinking === true,
    input: ['text', 'image'],
  };
}

function appendCapped(current, delta, limit) {
  if (!delta || current.length >= limit) return current;
  return current + delta.slice(0, Math.max(0, limit - current.length));
}

function rateLimitLabel(type) {
  switch (type) {
    case 'five_hour':
      return { label: '5-hour limit', kind: 'primary', windowDurationMins: 300 };
    case 'seven_day':
      return { label: 'Weekly limit', kind: 'secondary', windowDurationMins: 10_080 };
    case 'seven_day_opus':
      return { label: 'Weekly Opus limit', kind: 'secondary', windowDurationMins: 10_080 };
    case 'seven_day_sonnet':
      return { label: 'Weekly Sonnet limit', kind: 'secondary', windowDurationMins: 10_080 };
    case 'seven_day_overage_included':
      return { label: 'Weekly included overage', kind: 'secondary', windowDurationMins: 10_080 };
    case 'overage':
      return { label: 'Overage', kind: 'spendControl' };
    default:
      return { label: 'Claude plan limit', kind: 'secondary' };
  }
}

function normalizedPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}

function subscriptionUsage(rateLimits, capturedAt) {
  const limits = [...rateLimits.entries()].map(([type, info]) => {
    const meta = rateLimitLabel(type);
    const used = normalizedPercent(info.utilization);
    const resetAt =
      typeof info.resetsAt === 'number' && Number.isFinite(info.resetsAt)
        ? new Date(info.resetsAt * 1000).toISOString()
        : undefined;
    return {
      limitId: `claude:${type}`,
      label: meta.label,
      windows: [
        {
          kind: meta.kind,
          ...(meta.windowDurationMins ? { windowDurationMins: meta.windowDurationMins } : {}),
          used: used === undefined ? 'Not reported' : `${used}%`,
          remaining: used === undefined ? 'Not reported' : `${Math.max(0, 100 - used)}%`,
          remainingIsDerived: used !== undefined,
          ...(resetAt ? { resetAt } : {}),
          limit: '100%',
        },
      ],
    };
  });
  if (!limits.length) return null;
  return { kind: 'subscription', source: 'native', limits, updatedAt: capturedAt };
}

function diagnosticUsage(payload, selected, result, capturedAt) {
  const usage = isRecord(result?.usage) ? result.usage : {};
  const number = (value) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    scope: {
      kind: 'subscription-run-diagnostic',
      engineId: 'claude',
      accountId: payload.expectedTarget.accountId,
      modelId: selected.modelId,
    },
    ...(number(usage.input_tokens) !== undefined ? { input: number(usage.input_tokens) } : {}),
    ...(number(usage.output_tokens) !== undefined ? { output: number(usage.output_tokens) } : {}),
    ...(number(usage.cache_read_input_tokens) !== undefined
      ? { cacheRead: number(usage.cache_read_input_tokens) }
      : {}),
    ...(number(usage.cache_creation_input_tokens) !== undefined
      ? { cacheWrite: number(usage.cache_creation_input_tokens) }
      : {}),
    ...(number(result?.num_turns) !== undefined ? { turns: number(result.num_turns) } : {}),
    inputAccounting: 'excludes-cache',
    outputAccounting: 'includes-reasoning',
    usageSource: { kind: 'provider', capturedAt, reference: USAGE_SOURCE_URL },
    cost: {
      kind: 'unavailable',
      reason: 'Claude subscription runs are not converted into API cost.',
    },
  };
}

function emitToolStarted(block, startedTools, startedAtByTool) {
  const id = nonEmpty(block?.id);
  const name = nonEmpty(block?.name);
  if (!id || !name || startedTools.has(id)) return;
  startedTools.set(id, name);
  startedAtByTool.set(id, Date.now());
  emit(
    toolLine({
      status: 'started',
      toolCallId: id,
      toolName: name,
      detail: summarizeToolInput(block.input),
    }),
  );
}

function emitToolResults(message, startedTools, startedAtByTool) {
  const blocks = Array.isArray(message?.message?.content) ? message.message.content : [];
  for (const block of blocks) {
    if (block?.type !== 'tool_result') continue;
    const id = nonEmpty(block.tool_use_id);
    if (!id) continue;
    const startedAt = startedAtByTool.get(id);
    emit(
      toolLine({
        status: block.is_error ? 'failed' : 'completed',
        toolCallId: id,
        toolName: startedTools.get(id) ?? 'Claude tool',
        durationMs: startedAt ? Math.max(0, Date.now() - startedAt) : undefined,
      }),
    );
    startedTools.delete(id);
    startedAtByTool.delete(id);
  }
}

async function runClaude(payload) {
  const mode = validatePayload(payload);
  const executablePath = await resolveClaudeExecutable();
  const abortController = new AbortController();
  activeAbortController = abortController;
  const prompt = createPromptStream(payload.text);
  activeInputClose = prompt.closeInput;
  const ephemeral = mode === 'enhance';
  const hasWorkspace = payload.workspaceAvailability === 'bound';
  const sessionId = ephemeral ? undefined : (nonEmpty(payload.nativeSessionId) ?? randomUUID());
  const selector = nonEmpty(payload.runtimeModelRef).slice('claude:'.length);
  const permission = ephemeral
    ? { permissionMode: 'dontAsk' }
    : permissionOptions(nonEmpty(payload.permissionMode));
  const appendSystemPrompt = ephemeral
    ? nonEmpty(payload.systemPrompt)
    : [
        nonEmpty(payload.systemPromptAppend),
        !hasWorkspace
          ? 'No Project folder is currently available. Answer conversationally and do not claim to read or change project files.'
          : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');
  const options = {
    ...baseOptions(executablePath, process.cwd()),
    abortController,
    model: selector,
    includePartialMessages: true,
    persistSession: !ephemeral,
    settingSources: ephemeral ? [] : ['user', 'project', 'local'],
    tools: !ephemeral && hasWorkspace ? { type: 'preset', preset: 'claude_code' } : [],
    skills: !ephemeral && hasWorkspace ? 'all' : [],
    strictMcpConfig: false,
    ...(!ephemeral && hasWorkspace
      ? {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash|Edit|Glob|Grep|NotebookEdit|Read|Write',
                hooks: [createClaudeWorkspaceGuard(process.cwd())],
              },
            ],
          },
          sandbox: {
            enabled: true,
            allowUnsandboxedCommands: false,
          },
        }
      : {}),
    ...permission,
    ...thinkingOptions(nonEmpty(payload.thinkingLevel)),
    ...(appendSystemPrompt
      ? {
          systemPrompt: ephemeral
            ? appendSystemPrompt
            : { type: 'preset', preset: 'claude_code', append: appendSystemPrompt },
        }
      : {}),
    ...(!ephemeral && nonEmpty(payload.nativeSessionId)
      ? { resume: nonEmpty(payload.nativeSessionId) }
      : !ephemeral
        ? { sessionId }
        : {}),
    ...(!ephemeral && hasWorkspace ? { canUseTool } : {}),
  };

  const sdkQuery = query({ prompt: prompt.stream, options });
  activeQuery = sdkQuery;
  const initialization = await sdkQuery.initializationResult();
  const selected = selectedModel(initialization, payload.runtimeModelRef);
  const { identity } = validateExecutionTarget(payload, initialization, selected);
  await waitForExecutionAck(payload, identity);
  emit(
    startedLine({
      sessionId,
      model: modelSummary(selected),
    }),
  );
  prompt.releasePrompt();

  let content = '';
  let reasoning = '';
  let finalResult;
  const rateLimits = new Map();
  const startedTools = new Map();
  const startedAtByTool = new Map();
  try {
    for await (const message of sdkQuery) {
      if (message.type === 'stream_event') {
        const event = message.event;
        if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          emitToolStarted(event.content_block, startedTools, startedAtByTool);
        }
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const delta = clampText(event.delta.text, MAX_TEXT_CHARS - content.length);
          content = appendCapped(content, delta, MAX_TEXT_CHARS);
          if (delta) emit(messageDeltaLine({ delta, channel: 'content' }));
        }
        if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          const delta = clampText(event.delta.thinking, MAX_REASONING_CHARS - reasoning.length);
          reasoning = appendCapped(reasoning, delta, MAX_REASONING_CHARS);
          if (delta) emit(messageDeltaLine({ delta, channel: 'reasoning' }));
        }
        continue;
      }
      if (message.type === 'assistant') {
        for (const block of message.message?.content ?? []) {
          if (block?.type === 'tool_use') emitToolStarted(block, startedTools, startedAtByTool);
        }
        continue;
      }
      if (message.type === 'user') {
        emitToolResults(message, startedTools, startedAtByTool);
        continue;
      }
      if (message.type === 'tool_progress') {
        const id = nonEmpty(message.tool_use_id);
        if (id) {
          emit(
            toolLine({
              status: 'running',
              toolCallId: id,
              toolName: nonEmpty(message.tool_name) ?? 'Claude tool',
              durationMs:
                typeof message.elapsed_time_seconds === 'number'
                  ? Math.max(0, Math.round(message.elapsed_time_seconds * 1000))
                  : undefined,
            }),
          );
        }
        continue;
      }
      if (message.type === 'rate_limit_event' && isRecord(message.rate_limit_info)) {
        const type = nonEmpty(message.rate_limit_info.rateLimitType) ?? 'unknown';
        rateLimits.set(type, message.rate_limit_info);
        continue;
      }
      if (message.type === 'system' && message.subtype === 'permission_denied') {
        emit(
          toolLine({
            status: 'failed',
            toolCallId: message.tool_use_id,
            toolName: message.tool_name,
            detail: redact(message.message),
          }),
        );
        continue;
      }
      if (message.type === 'result') {
        finalResult = message;
        if (message.subtype === 'success' && nonEmpty(message.result)) content = message.result;
        break;
      }
    }
  } finally {
    prompt.closeInput();
    activeInputClose = undefined;
    sdkQuery.close();
    activeQuery = undefined;
    activeAbortController = undefined;
  }

  if (!finalResult) {
    throw Object.assign(new Error('Claude Code ended without a final result.'), {
      code: 'protocol',
    });
  }
  if (finalResult.subtype !== 'success' || finalResult.is_error) {
    throw Object.assign(
      new Error(
        Array.isArray(finalResult.errors) && finalResult.errors.length
          ? finalResult.errors.map(safeError).join('; ')
          : `Claude Code ended with ${finalResult.subtype}.`,
      ),
      { code: 'upstream' },
    );
  }
  const capturedAt = new Date().toISOString();
  const planUsage = subscriptionUsage(rateLimits, capturedAt);
  emit(messageEndLine({ text: content, stopReason: finalResult.stop_reason ?? 'end_turn' }));
  emit(
    resultLine({
      text: content,
      ...(reasoning ? { reasoning } : {}),
      ...(sessionId ? { sessionId } : {}),
      model: modelSummary(selected),
      provenance: identity,
      usage: diagnosticUsage(payload, selected, finalResult, capturedAt),
      budgetUsage: null,
      subscriptionUsage: planUsage,
    }),
  );
}

function rejectPending(error) {
  pendingExecutionAck?.reject(error);
  pendingExecutionAck = undefined;
  for (const settle of [...pendingUiRequests.values()]) settle({ cancelled: true });
  pendingUiRequests.clear();
}

async function shutdown(abort) {
  rejectPending(new Error('Claude host input channel closed.'));
  activeInputClose?.();
  activeInputClose = undefined;
  if (abort) activeAbortController?.abort();
  activeQuery?.close();
  activeQuery = undefined;
  activeAbortController = undefined;
}

function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  let sawPayload = false;
  let statusRun = false;
  const finish = async () => {
    if (hostTerminating) return;
    hostTerminating = true;
    await shutdown(false);
    rl.close();
    process.exit(0);
  };
  const stopForSignal = () => {
    if (hostTerminating) return;
    hostTerminating = true;
    void shutdown(true).finally(() => {
      rl.close();
      process.exit(143);
    });
  };
  process.once('SIGTERM', stopForSignal);
  process.once('SIGHUP', stopForSignal);

  rl.on('line', (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!sawPayload) {
      sawPayload = true;
      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch (error) {
        fail(Object.assign(error, { code: 'invalid-request' }));
        return;
      }
      emit(readyLine());
      if (payload.mode === 'status') {
        statusRun = true;
        void runStatus().then(finish, fail);
        return;
      }
      void runClaude(payload).then(finish, fail);
      return;
    }
    try {
      const message = JSON.parse(trimmed);
      resolveExecutionAck(message);
      resolveUiResponse(message);
    } catch {
      // Malformed response lines cannot authorize execution or a tool.
    }
  });

  rl.on('close', () => {
    if (statusRun || hostTerminating) return;
    hostTerminating = true;
    void shutdown(true).finally(() => process.exit(1));
  });
}

main();
