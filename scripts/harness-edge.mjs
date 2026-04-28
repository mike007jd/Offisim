import { performance } from 'node:perf_hooks';
import {
  buildMessageCase,
  classifyHarnessFailure,
  createGatewayHarness,
  createRuntimeHarness,
  parseArgs,
  resolveCommonOptions,
  runGatewayRequest,
  runRuntimeRequest,
  runWithConcurrency,
  summarizeResults,
} from './harness-lib.mjs';

const TOOL_CASE_DEF = {
  name: 'echo_status',
  description: 'Return the supplied status string unchanged.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Short status label to echo back.',
      },
    },
    required: ['status'],
    additionalProperties: false,
  },
};

const DEFAULT_CASES = [
  'unicode',
  'empty-input',
  'long-context',
  'tool-calls',
  'timeout',
  'cancellation',
  'queue-depth',
  'provider-auth',
  'provider-quota',
];

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

function parseInteger(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCaseList(raw) {
  const normalized = trimString(raw);
  if (!normalized || normalized === 'all') return DEFAULT_CASES;
  return normalized
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function matchesExpectedCategory(result, expectedCategory) {
  return result.ok === false && result.failure?.category === expectedCategory;
}

async function runLevelRequest(level, options, runtimeOverride) {
  return level === 'runtime'
    ? runRuntimeRequest(options, runtimeOverride)
    : runGatewayRequest(options);
}

async function collectGatewayResponse(gateway, request, stream) {
  if (!stream) {
    const response = await gateway.chat(request);
    return {
      ok: true,
      content: response.content,
      toolCalls: response.toolCalls,
      usage: response.usage,
    };
  }

  let content = '';
  let usage = null;
  const toolCalls = [];
  for await (const chunk of gateway.chatStream(request)) {
    if (chunk.content) content += chunk.content;
    if (chunk.toolCalls?.length) toolCalls.push(...chunk.toolCalls);
    if (chunk.usage) usage = chunk.usage;
  }
  return {
    ok: true,
    content,
    toolCalls,
    usage,
  };
}

async function runCustomGatewayRequest(options, request) {
  const startedAt = performance.now();
  const gateway = await createGatewayHarness(options);
  try {
    const response = await collectGatewayResponse(gateway, request, options.stream);
    return {
      ...response,
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
    gateway.dispose();
  }
}

async function runMessageCase(caseId, level, options, messageCase) {
  const result = await runLevelRequest(level, {
    ...options,
    message: buildMessageCase(messageCase, options.message, 0),
  });
  return {
    id: caseId,
    level,
    expected: 'accepted-by-harness',
    pass: result.ok || result.failure?.category !== 'configuration.invalid',
    result,
  };
}

async function runToolCallsCase(options) {
  const request = {
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    messages: [
      {
        role: 'user',
        content: 'Call the echo_status tool exactly once with status "edge-tool-ok", then stop.',
      },
    ],
    tools: [TOOL_CASE_DEF],
  };
  const result = await runCustomGatewayRequest(options, request);

  const expected =
    options.executionLane === 'gateway' ? 'successful tool call' : 'configuration.invalid';
  const pass =
    options.executionLane === 'gateway'
      ? result.ok === true && Array.isArray(result.toolCalls) && result.toolCalls.length > 0
      : matchesExpectedCategory(result, 'configuration.invalid');

  return {
    id: 'tool-calls',
    level: 'gateway',
    expected,
    pass,
    result,
  };
}

async function runTimeoutCase(level, options, timeoutMs) {
  const result = await runLevelRequest(level, {
    ...options,
    timeoutMs,
    message: buildMessageCase('long', options.message, 0),
  });
  return {
    id: 'timeout',
    level,
    expected: 'runtime.timeout',
    pass: matchesExpectedCategory(result, 'runtime.timeout'),
    result,
  };
}

async function runCancellationCase(level, options, abortAfterMs) {
  if (level === 'runtime') {
    const runtime = await createRuntimeHarness(options);
    const timer = setTimeout(() => runtime.orch.abortExecution(runtime.threadId), abortAfterMs);
    try {
      const result = await runLevelRequest(
        level,
        {
          ...options,
          message: buildMessageCase('long', options.message, 0),
        },
        runtime,
      );
      return {
        id: 'cancellation',
        level,
        expected: 'runtime.cancellation',
        pass: matchesExpectedCategory(result, 'runtime.cancellation'),
        result,
      };
    } finally {
      clearTimeout(timer);
      runtime.dispose();
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Harness edge cancellation test aborted the request.')),
    abortAfterMs,
  );
  try {
    const result = await runCustomGatewayRequest(options, {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      timeoutMs: options.timeoutMs,
      signal: controller.signal,
      messages: [{ role: 'user', content: buildMessageCase('long', options.message, 0) }],
    });
    return {
      id: 'cancellation',
      level,
      expected: 'runtime.cancellation',
      pass: matchesExpectedCategory(result, 'runtime.cancellation'),
      result,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runQueueDepthCase(options, iterations, concurrency) {
  const runtime = await createRuntimeHarness(options);
  try {
    const tasks = Array.from(
      { length: iterations },
      (_, index) => async () =>
        runRuntimeRequest(
          {
            ...options,
            message: buildMessageCase('long', options.message, index),
          },
          runtime,
        ),
    );
    const results = await runWithConcurrency(tasks, concurrency);
    const summary = summarizeResults(results);
    return {
      id: 'queue-depth',
      level: 'runtime',
      expected: 'runtime.queue-depth',
      pass: (summary.failuresByCategory['runtime.queue-depth'] ?? 0) > 0,
      iterations,
      concurrency,
      summary,
      samples: results.slice(0, Math.min(results.length, 8)),
    };
  } finally {
    runtime.dispose();
  }
}

async function runProviderAuthCase(options, invalidApiKey) {
  const result = await runGatewayRequest({
    ...options,
    apiKey: invalidApiKey,
  });
  return {
    id: 'provider-auth',
    level: 'gateway',
    expected: 'provider.authentication',
    pass: matchesExpectedCategory(result, 'provider.authentication'),
    result,
  };
}

async function runProviderQuotaCase(simulateProviderQuota) {
  if (!simulateProviderQuota) {
    return {
      id: 'provider-quota',
      level: 'gateway',
      expected: 'provider.quota',
      skipped: true,
      reason:
        'No provider-generic live quota repro is configured. Re-run with --simulate-provider-quota to exercise classification output.',
    };
  }

  const failure = classifyHarnessFailure(
    Object.assign(new Error('Synthetic rate limit response for harness verification.'), {
      statusCode: 429,
    }),
  );
  return {
    id: 'provider-quota',
    level: 'gateway',
    expected: 'provider.quota',
    pass: failure.category === 'provider.quota',
    result: {
      ok: false,
      error: failure.message,
      failure,
      simulated: true,
      latencyMs: 0,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = resolveCommonOptions(args);
  const level = trimString(args.level || process.env.HARNESS_LEVEL || 'runtime') || 'runtime';
  const cases = parseCaseList(args.cases || process.env.HARNESS_EDGE_CASES || 'all');
  const timeoutMs = parseInteger(args['edge-timeout-ms'] || process.env.HARNESS_EDGE_TIMEOUT_MS, 5);
  const abortAfterMs = parseInteger(
    args['abort-after-ms'] || process.env.HARNESS_ABORT_AFTER_MS,
    25,
  );
  const queueIterations = parseInteger(
    args['queue-iterations'] || process.env.HARNESS_QUEUE_ITERATIONS,
    6,
  );
  const queueConcurrency = parseInteger(
    args['queue-concurrency'] || process.env.HARNESS_QUEUE_CONCURRENCY,
    5,
  );
  const invalidApiKey =
    trimString(args['invalid-api-key'] || process.env.HARNESS_INVALID_API_KEY) ||
    'harness-invalid-key';
  const simulateProviderQuota = parseBoolean(
    args['simulate-provider-quota'] || process.env.HARNESS_SIMULATE_PROVIDER_QUOTA,
  );
  const failOnSkip = parseBoolean(args['fail-on-skip'] || process.env.HARNESS_FAIL_ON_SKIP);

  if (level !== 'gateway' && level !== 'runtime') {
    throw new Error(`Unsupported --level "${level}". Use gateway or runtime.`);
  }

  const caseRunners = {
    unicode: () => runMessageCase('unicode', level, options, 'unicode'),
    'empty-input': () => runMessageCase('empty-input', level, options, 'empty'),
    'long-context': () => runMessageCase('long-context', level, options, 'long'),
    'tool-calls': () => runToolCallsCase(options),
    timeout: () => runTimeoutCase(level, options, timeoutMs),
    cancellation: () => runCancellationCase(level, options, abortAfterMs),
    'queue-depth': () => runQueueDepthCase(options, queueIterations, queueConcurrency),
    'provider-auth': () => runProviderAuthCase(options, invalidApiKey),
    'provider-quota': () => runProviderQuotaCase(simulateProviderQuota),
  };

  const results = [];
  for (const caseId of cases) {
    const runCase = caseRunners[caseId];
    if (runCase) {
      results.push(await runCase());
      continue;
    }
    results.push({
      id: caseId,
      skipped: true,
      reason: `Unknown edge case "${caseId}".`,
    });
  }

  const summary = {
    requested: results.length,
    passed: results.filter((result) => result.pass === true).length,
    failed: results.filter((result) => result.skipped !== true && result.pass !== true).length,
    skipped: results.filter((result) => result.skipped === true).length,
  };

  console.log(
    JSON.stringify(
      {
        provider: options.provider,
        providerVariantId: options.providerVariantId ?? null,
        executionLane: options.executionLane,
        level,
        model: options.model,
        baseURL: options.baseUrl ?? null,
        cases,
        settings: {
          timeoutMs,
          abortAfterMs,
          queueIterations,
          queueConcurrency,
          simulateProviderQuota,
        },
        summary,
        results,
      },
      null,
      2,
    ),
  );

  if (summary.failed > 0 || (failOnSkip && summary.skipped > 0)) {
    process.exit(1);
  }
}

await main();
