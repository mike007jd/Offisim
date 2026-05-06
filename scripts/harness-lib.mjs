import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REQUIRED_BUILD_ARTIFACTS = [
  'packages/asset-schema/dist/index.js',
  'packages/shared-types/dist/index.js',
  'packages/install-core/dist/index.js',
  'packages/db-local/dist/index.js',
  'packages/core/dist/index.js',
  'packages/core/dist/testing/chaos-runner.js',
  'packages/core/dist/testing/context-budget-runner.js',
  'packages/core/dist/testing/model-bench-runner.js',
  'packages/core/dist/testing/resume-runner.js',
  'packages/core/dist/testing/soak-runner.js',
  'packages/core/dist/testing/streaming-tool-runner.js',
  'packages/core/dist/testing/vcr-corpus.js',
];
const RUNTIME_BUILD_PACKAGES = [
  '@offisim/asset-schema',
  '@offisim/shared-types',
  '@offisim/install-core',
  '@offisim/db-local',
  '@offisim/core',
];

function rootPath(...parts) {
  return resolve(ROOT, ...parts);
}

function pathExists(path) {
  return existsSync(rootPath(path));
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonObject(value, label) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label}: ${message}`);
  }
}

function normalizeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function buildSemanticFailure(category, message, source = 'provider') {
  return {
    source,
    category,
    statusCode: null,
    message,
  };
}

function validateHarnessContent(content, options, source = 'provider') {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) {
    return buildSemanticFailure(
      `${source}.empty-content`,
      'Provider returned an empty content string.',
      source,
    );
  }

  if (options.messageCase === 'json') {
    const stripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(stripped);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return buildSemanticFailure(
          `${source}.invalid-json`,
          'Provider JSON response was not an object.',
          source,
        );
      }
      for (const key of ['status', 'runTag', 'provider', 'summary']) {
        if (typeof parsed[key] !== 'string' || !parsed[key].trim()) {
          return buildSemanticFailure(
            `${source}.invalid-json`,
            `Provider JSON response is missing string key "${key}".`,
            source,
          );
        }
      }
    } catch (error) {
      return buildSemanticFailure(
        `${source}.invalid-json`,
        `Provider did not return strict JSON: ${normalizeErrorMessage(error)}`,
        source,
      );
    }
  }

  return null;
}

function getErrorStatusCode(error) {
  if (!error || typeof error !== 'object') return undefined;
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

export function classifyHarnessFailure(error) {
  const message = normalizeErrorMessage(error);
  const statusCode = getErrorStatusCode(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('unknown execution lane') ||
    normalized.includes('not implemented yet') ||
    normalized.includes('requires provider') ||
    normalized.includes('invalid --') ||
    normalized.includes('unsupported --') ||
    normalized.includes('execution lane "') ||
    normalized.includes('does not yet expose offisim tool calls') ||
    normalized.includes('api key is required')
  ) {
    return {
      source: 'configuration',
      category: 'configuration.invalid',
      statusCode: statusCode ?? null,
      message,
    };
  }

  if (normalized.includes('queued requests')) {
    return {
      source: 'offisim-runtime',
      category: 'runtime.queue-depth',
      statusCode: statusCode ?? null,
      message,
    };
  }

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return {
      source: 'offisim-runtime',
      category: 'runtime.timeout',
      statusCode: statusCode ?? null,
      message,
    };
  }

  if (normalized.includes('abort') || normalized.includes('cancel')) {
    return {
      source: 'offisim-runtime',
      category: 'runtime.cancellation',
      statusCode: statusCode ?? null,
      message,
    };
  }

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    normalized.includes('authentication') ||
    normalized.includes('invalid x-api-key') ||
    normalized.includes('invalid api key') ||
    normalized.includes('unauthorized')
  ) {
    return {
      source: 'provider',
      category: 'provider.authentication',
      statusCode: statusCode ?? null,
      message,
    };
  }

  if (
    statusCode === 402 ||
    statusCode === 429 ||
    normalized.includes('rate limit') ||
    normalized.includes('quota') ||
    normalized.includes('out of credits') ||
    normalized.includes('billing')
  ) {
    return {
      source: 'provider',
      category: 'provider.quota',
      statusCode: statusCode ?? null,
      message,
    };
  }

  if (
    (normalized.includes('tool') && normalized.includes('not support')) ||
    normalized.includes('protocol') ||
    normalized.includes('anthropic-version') ||
    normalized.includes('count_tokens')
  ) {
    return {
      source: 'provider',
      category: 'provider.protocol',
      statusCode: statusCode ?? null,
      message,
    };
  }

  if (typeof statusCode === 'number') {
    return {
      source: 'provider',
      category: 'provider.upstream',
      statusCode,
      message,
    };
  }

  return {
    source: 'offisim-runtime',
    category: 'runtime.unknown',
    statusCode: null,
    message,
  };
}

export function parseArgs(argv) {
  const result = { _: [], header: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) {
      result._.push(raw);
      continue;
    }
    const flag = raw.slice(2);
    if (flag === 'stream') {
      result.stream = true;
      continue;
    }
    if (flag === 'no-stream') {
      result.stream = false;
      continue;
    }
    if (flag === 'force-build') {
      result.forceBuild = true;
      continue;
    }
    const eqIndex = flag.indexOf('=');
    const key = eqIndex >= 0 ? flag.slice(0, eqIndex) : flag;
    const inlineValue = eqIndex >= 0 ? flag.slice(eqIndex + 1) : undefined;
    const next = argv[i + 1];
    let value = inlineValue;
    if (value == null) {
      if (next && !next.startsWith('--')) {
        i += 1;
        value = next;
      } else {
        value = 'true';
      }
    }
    if (key === 'header') {
      result.header.push(value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          signal
            ? `${command} ${args.join(' ')} exited via signal ${signal}`
            : `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`,
        ),
      );
    });
    child.on('error', rejectPromise);
  });
}

function clearIncrementalState() {
  for (const pkg of ['asset-schema', 'shared-types', 'install-core', 'db-local', 'core']) {
    rmSync(rootPath('packages', pkg, 'tsconfig.tsbuildinfo'), { force: true });
  }
}

export async function ensureRuntimeBuild(options = {}) {
  const force = Boolean(options.force);
  const hasArtifacts = REQUIRED_BUILD_ARTIFACTS.every(pathExists);
  if (!force && hasArtifacts) return;
  clearIncrementalState();
  for (const pkg of RUNTIME_BUILD_PACKAGES) {
    await run('pnpm', ['--filter', pkg, 'build']);
  }
}

async function loadRuntimeModules(forceBuild = false) {
  await ensureRuntimeBuild({ force: forceBuild });
  const coreUrl = pathToFileURL(rootPath('packages/core/dist/index.js')).href;
  const requireFromCore = createRequire(rootPath('packages/core/dist/index.js'));
  const langchainMessagesUrl = pathToFileURL(
    requireFromCore.resolve('@langchain/core/messages'),
  ).href;
  const [{ HumanMessage }, core] = await Promise.all([
    import(langchainMessagesUrl),
    import(coreUrl),
  ]);
  return { HumanMessage, core };
}

function createRuntimePolicy(options) {
  const provider = options.provider;
  const model = options.model;
  const temperature = options.temperature;
  const maxTokens = options.maxTokens;
  return {
    executionMode: 'desktop-trusted',
    modelPolicy: {
      default: {
        profileName: 'harness-default',
        provider,
        model,
        temperature,
        maxTokens,
      },
    },
    summarization: {
      enabled: false,
      triggerTokens: 65536,
      keepRecentMessages: 12,
    },
    memory: {
      enabled: false,
      injectionEnabled: false,
      maxFacts: 0,
      factConfidenceThreshold: 1,
    },
    toolSearch: {
      enabled: false,
    },
    toolPermissions: {
      enabled: true,
      defaultBehavior: 'allow',
      rules: [],
    },
    gitAutoCommit: false,
  };
}

function buildHeaders(options) {
  const headers = {};
  if (trimString(options.headersJson)) {
    Object.assign(headers, parseJsonObject(options.headersJson, 'headersJson'));
  }
  for (const raw of options.header ?? []) {
    const index = raw.indexOf(':');
    if (index <= 0) {
      throw new Error(`Invalid --header value "${raw}". Use KEY:VALUE.`);
    }
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (!key) {
      throw new Error(`Invalid --header value "${raw}". Header name is empty.`);
    }
    headers[key] = value;
  }
  if (
    trimString(options.baseUrl).includes('openrouter.ai') &&
    !('HTTP-Referer' in headers) &&
    !('X-Title' in headers)
  ) {
    headers['HTTP-Referer'] = 'https://offisim.local/harness';
    headers['X-Title'] = 'Offisim Harness';
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function resolveCommonOptions(args) {
  const provider = trimString(args.provider || process.env.HARNESS_PROVIDER) || 'anthropic';
  const executionLane =
    trimString(args['execution-lane'] || process.env.HARNESS_EXECUTION_LANE) || 'gateway';
  const model =
    trimString(args.model || process.env.HARNESS_MODEL) ||
    (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4.1-mini');
  const baseUrl = trimString(args['base-url'] || process.env.HARNESS_BASE_URL) || undefined;
  const apiKey = trimString(args['api-key'] || process.env.HARNESS_API_KEY) || '';
  const temperature = parseNumber(args.temperature ?? process.env.HARNESS_TEMPERATURE, 0.2);
  const maxTokens = parseNumber(args['max-tokens'] ?? process.env.HARNESS_MAX_TOKENS, 512);
  const timeoutMs = parseNumber(args['timeout-ms'] ?? process.env.HARNESS_TIMEOUT_MS, 120000);
  const stream = parseBoolean(args.stream ?? process.env.HARNESS_STREAM, true);
  const message =
    trimString(args.message || process.env.HARNESS_MESSAGE) ||
    'Reply with a single short sentence confirming the harness path is working.';
  const headersJson = trimString(args['headers-json'] || process.env.HARNESS_HEADERS_JSON);
  const employeeName =
    trimString(args['employee-name'] || process.env.HARNESS_EMPLOYEE_NAME) || 'Harness Engineer';
  const employeeRole =
    trimString(args['employee-role'] || process.env.HARNESS_EMPLOYEE_ROLE) || 'engineer';
  const companyName =
    trimString(args['company-name'] || process.env.HARNESS_COMPANY_NAME) || 'Harness Company';
  const providerVariantId =
    trimString(args['provider-variant'] || process.env.HARNESS_PROVIDER_VARIANT) || undefined;
  const allowExperimentalOpenAiCompat = parseBoolean(
    args['allow-experimental-openai-compat'] ??
      process.env.HARNESS_ALLOW_EXPERIMENTAL_OPENAI_COMPAT,
  );
  const pathToClaudeCodeExecutable =
    trimString(args['claude-code-executable'] || process.env.HARNESS_CLAUDE_CODE_EXECUTABLE) ||
    undefined;
  const forceBuild = Boolean(args.forceBuild ?? parseBoolean(process.env.HARNESS_FORCE_BUILD));
  return {
    provider,
    executionLane,
    model,
    apiKey,
    baseUrl,
    temperature,
    maxTokens,
    timeoutMs,
    stream,
    message,
    headersJson,
    header: args.header ?? [],
    employeeName,
    employeeRole,
    companyName,
    providerVariantId,
    allowExperimentalOpenAiCompat,
    pathToClaudeCodeExecutable,
    forceBuild,
  };
}

export async function createGatewayHarness(options) {
  const { core } = await loadRuntimeModules(options.forceBuild);
  const gateway = core.createExecutionAdapter({
    provider: options.provider,
    executionLane: options.executionLane,
    apiKey: options.apiKey,
    providerVariantId: options.providerVariantId,
    allowExperimentalOpenAiCompat: options.allowExperimentalOpenAiCompat,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    ...(buildHeaders(options) ? { defaultHeaders: buildHeaders(options) } : {}),
    cwd: ROOT,
    ...(options.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }
      : {}),
  });
  return gateway;
}

export async function runGatewayRequest(options, gatewayOverride) {
  const request = {
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    messages: [{ role: 'user', content: options.message }],
  };
  const startedAt = performance.now();
  let gateway = gatewayOverride;
  try {
    gateway ??= await createGatewayHarness(options);
    if (!options.stream) {
      const response = await gateway.chat(request);
      const semanticFailure = validateHarnessContent(response.content, options, 'provider');
      if (semanticFailure) {
        return {
          ok: false,
          content: response.content,
          toolCalls: response.toolCalls,
          usage: response.usage,
          error: semanticFailure.message,
          failure: semanticFailure,
          latencyMs: Number((performance.now() - startedAt).toFixed(1)),
        };
      }
      return {
        ok: true,
        content: response.content,
        toolCalls: response.toolCalls,
        usage: response.usage,
        latencyMs: Number((performance.now() - startedAt).toFixed(1)),
      };
    }
    let content = '';
    let usage;
    const toolCalls = [];
    for await (const chunk of gateway.chatStream(request)) {
      if (chunk.content) content += chunk.content;
      if (chunk.toolCalls?.length) toolCalls.push(...chunk.toolCalls);
      if (chunk.usage) usage = chunk.usage;
    }
    const semanticFailure = validateHarnessContent(content, options, 'provider');
    if (semanticFailure) {
      return {
        ok: false,
        content,
        toolCalls,
        usage: usage ?? null,
        error: semanticFailure.message,
        failure: semanticFailure,
        latencyMs: Number((performance.now() - startedAt).toFixed(1)),
      };
    }
    return {
      ok: true,
      content,
      toolCalls,
      usage: usage ?? null,
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
    };
  } catch (error) {
    const failure = classifyHarnessFailure(error);
    return {
      ok: false,
      error: failure.message,
      failure,
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
    };
  } finally {
    if (!gatewayOverride) {
      gateway?.dispose();
    }
  }
}

export async function createRuntimeHarness(options) {
  const { HumanMessage, core } = await loadRuntimeModules(options.forceBuild);
  const eventBus = new core.InMemoryEventBus();
  const repos = core.createMemoryRepositories();
  const companyId = crypto.randomUUID();
  const threadId = `harness-thread-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await repos.companies.create({
    company_id: companyId,
    name: options.companyName,
    status: 'active',
    template_id: null,
    template_label: 'Harness',
    workspace_root: null,
    default_model_policy_json: null,
    created_at: now,
    updated_at: now,
  });
  await repos.threads.create({
    thread_id: threadId,
    company_id: companyId,
    entry_mode: 'direct_chat',
    root_task_id: null,
    status: 'queued',
  });
  const createdEmployee = await repos.employees.create({
    company_id: companyId,
    source_asset_id: null,
    source_package_id: null,
    name: options.employeeName,
    role_slug: options.employeeRole,
    persona_json: JSON.stringify({
      expertise: 'Backend harness testing, boundary analysis, and concise technical reporting.',
      style: 'direct and pragmatic',
      customInstructions:
        'When the request is simple, reply in one or two sentences and avoid unnecessary formatting.',
    }),
    config_json: JSON.stringify({}),
  });

  const runtimePolicy = createRuntimePolicy(options);
  const gateway = await createGatewayHarness(options);
  const modelResolver = new core.ModelResolver(runtimePolicy, {
    provider: options.provider,
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  });
  const checkpointer = core.createMemoryCheckpointSaver();
  const graph = core.buildOffisimGraph({ checkpointer });
  const runtimeCtx = core.createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver,
    toolExecutor: new core.MockToolExecutor(),
    companyId,
    threadId,
    runtimePolicy,
  });
  const orch = new core.OrchestrationService(graph, runtimeCtx, {
    checkpointSaver: checkpointer,
  });

  return {
    HumanMessage,
    companyId,
    threadId,
    employeeId: createdEmployee.employee_id,
    employeeName: options.employeeName,
    employeeRole: options.employeeRole,
    gateway,
    orch,
    runtimeCtx,
    repos,
    dispose() {
      gateway.dispose();
    },
  };
}

function extractLatestAssistantText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || typeof message._getType !== 'function') continue;
    if (message._getType() === 'ai' && typeof message.content === 'string' && message.content) {
      return message.content;
    }
  }
  return '';
}

export async function runRuntimeRequest(options, runtimeOverride) {
  const startedAt = performance.now();
  let runtime = runtimeOverride;
  try {
    runtime ??= await createRuntimeHarness(options);
    const result = await runtime.orch.execute({
      entryMode: options.entryMode ?? 'direct_chat',
      messages: [new runtime.HumanMessage(options.message)],
      targetEmployeeId: runtime.employeeId,
      threadId: runtime.threadId,
    });
    const content = extractLatestAssistantText(result.messages);
    const semanticFailure = validateHarnessContent(content, options, 'offisim-runtime');
    if (semanticFailure) {
      return {
        ok: false,
        content,
        messageCount: Array.isArray(result.messages) ? result.messages.length : 0,
        error: semanticFailure.message,
        failure: semanticFailure,
        latencyMs: Number((performance.now() - startedAt).toFixed(1)),
        threadId: runtime.threadId,
        employeeId: runtime.employeeId,
      };
    }
    return {
      ok: true,
      content,
      messageCount: Array.isArray(result.messages) ? result.messages.length : 0,
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
      threadId: runtime.threadId,
      employeeId: runtime.employeeId,
    };
  } catch (error) {
    const failure = classifyHarnessFailure(error);
    return {
      ok: false,
      error: failure.message,
      failure,
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
      threadId: runtime?.threadId ?? null,
      employeeId: runtime?.employeeId ?? null,
    };
  } finally {
    if (!runtimeOverride) {
      runtime?.dispose();
    }
  }
}

export function buildMessageCase(kind, fallback, index) {
  const runTag = `run-${index + 1}`;
  switch (kind) {
    case 'empty':
      return '';
    case 'unicode':
      return `Return compact JSON with keys english, chinese, arabic, emoji for ${runTag}.`;
    case 'long':
      return [
        fallback,
        '',
        'Also compress the core answer into three bullet points and include the run tag.',
        '',
        Array.from({ length: 8 }, (_, i) => `Context block ${i + 1}: ${runTag}.`).join('\n'),
      ].join('\n');
    case 'json':
      return `Return strict JSON with keys status, runTag, provider and a one-line summary for ${runTag}.`;
    default:
      return `${fallback} (${runTag})`;
  }
}

export function summarizeResults(results) {
  const latencies = results
    .filter((result) => typeof result.latencyMs === 'number')
    .map((result) => result.latencyMs)
    .sort((a, b) => a - b);
  const failuresByMessage = {};
  const failuresByCategory = {};
  for (const result of results) {
    if (result.ok) continue;
    const key = result.error ?? 'unknown';
    failuresByMessage[key] = (failuresByMessage[key] ?? 0) + 1;
    const category = result.failure?.category ?? 'runtime.unknown';
    failuresByCategory[category] = (failuresByCategory[category] ?? 0) + 1;
  }
  const quantile = (q) => {
    if (latencies.length === 0) return null;
    const index = Math.min(
      latencies.length - 1,
      Math.max(0, Math.floor((latencies.length - 1) * q)),
    );
    return latencies[index];
  };
  const average =
    latencies.length === 0
      ? null
      : Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1));
  return {
    requested: results.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    failuresByCategory,
    failuresByMessage,
    latencyMs: {
      min: latencies[0] ?? null,
      p50: quantile(0.5),
      p95: quantile(0.95),
      max: latencies[latencies.length - 1] ?? null,
      avg: average,
    },
  };
}

export async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, tasks.length || 1)) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= tasks.length) return;
        results[index] = await tasks[index]();
      }
    },
  );
  await Promise.all(workers);
  return results;
}
