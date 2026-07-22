import { OPENROUTER_API_BASE_URL, openRouterPricingFor } from './openrouter-pricing-registry.mjs';

const OPENROUTER_GENERATION_URL = `${OPENROUTER_API_BASE_URL}/generation`;
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([0, 150, 400, 950]);
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveCount(value) {
  const number = finiteNonNegative(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function executionSpeedMode(value) {
  return value === 'fast' || value === 'standard' ? value : undefined;
}

function assistantMessages(messages) {
  return Array.isArray(messages) ? messages.filter((message) => message?.role === 'assistant') : [];
}

function adapterTokens(message) {
  const usage = message?.usage;
  if (!usage || typeof usage !== 'object') return {};
  return {
    ...(positiveCount(usage.input) !== undefined ? { input: usage.input } : {}),
    ...(positiveCount(usage.output) !== undefined ? { output: usage.output } : {}),
    ...(positiveCount(usage.cacheRead) !== undefined ? { cacheRead: usage.cacheRead } : {}),
    ...(positiveCount(usage.cacheWrite) !== undefined ? { cacheWrite: usage.cacheWrite } : {}),
  };
}

function providerTokens(data, fallback) {
  const prompt = finiteNonNegative(data?.native_tokens_prompt);
  const cached = finiteNonNegative(data?.native_tokens_cached);
  const completion = finiteNonNegative(data?.native_tokens_completion);
  const reasoning = finiteNonNegative(data?.native_tokens_reasoning);
  const input =
    prompt !== undefined && cached !== undefined ? Math.max(0, prompt - cached) : fallback.input;
  return {
    ...(input !== undefined ? { input } : {}),
    ...(completion !== undefined
      ? { output: completion }
      : fallback.output !== undefined
        ? { output: fallback.output }
        : {}),
    ...(cached !== undefined
      ? { cacheRead: cached }
      : fallback.cacheRead !== undefined
        ? { cacheRead: fallback.cacheRead }
        : {}),
    ...(fallback.cacheWrite !== undefined ? { cacheWrite: fallback.cacheWrite } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

function aggregateOptionalNumbers(contributions, key) {
  const values = contributions
    .map((contribution) => finiteNonNegative(contribution.tokens[key]))
    .filter((value) => value !== undefined);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function estimateContributionCost(tokens, modelId) {
  const pricing = openRouterPricingFor(modelId);
  if (!pricing) {
    return {
      kind: 'unavailable',
      reason: `No verified pricing source exists for ${modelId}.`,
    };
  }

  const buckets = [
    ['input', pricing.inputPerMillion],
    ['output', pricing.outputPerMillion],
    ['cacheRead', pricing.cacheReadPerMillion],
    ['cacheWrite', pricing.cacheWritePerMillion],
  ];
  let amountUsd = 0;
  const missing = [];
  for (const [key, rate] of buckets) {
    const count = tokens[key];
    if (count === undefined || count === 0) continue;
    if (finiteNonNegative(rate) === undefined) {
      missing.push(key);
      continue;
    }
    amountUsd += (count * rate) / 1_000_000;
  }
  if (missing.length > 0) {
    return {
      kind: 'unavailable',
      reason: `Verified pricing is missing for ${missing.join(', ')}.`,
      knownAmountUsd: amountUsd,
    };
  }
  return {
    kind: 'estimate',
    amountUsd,
    sourceUrl: pricing.sourceUrl,
    checkedAt: pricing.checkedAt,
  };
}

function shouldRetryStatus(status) {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenRouterGeneration({
  responseId,
  expectedModelId,
  headers,
  fetchImpl,
  sleepImpl,
  retryDelaysMs,
  requestTimeoutMs,
}) {
  const url = `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(responseId)}`;
  for (let index = 0; index < retryDelaysMs.length; index += 1) {
    const delay = retryDelaysMs[index];
    if (delay > 0) await sleepImpl(delay);
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        url,
        { method: 'GET', headers },
        requestTimeoutMs,
      );
      if (!response.ok) {
        if (shouldRetryStatus(response.status) && index + 1 < retryDelaysMs.length) continue;
        return undefined;
      }
      const body = await response.json();
      const data = body?.data;
      if (!data || data.id !== responseId) return undefined;
      if (typeof data.model !== 'string' || data.model !== expectedModelId) return undefined;
      return data;
    } catch {
      if (index + 1 >= retryDelaysMs.length) return undefined;
    }
  }
  return undefined;
}

function isOpenRouterApiModel(model) {
  if (!model || typeof model !== 'object') return false;
  if (model.api !== 'openai-completions') return false;
  if (typeof model.baseUrl !== 'string') return false;
  return model.baseUrl.replace(/\/$/u, '') === OPENROUTER_API_BASE_URL;
}

async function openRouterRequestHeaders(modelRegistry, model) {
  if (!modelRegistry?.getApiKeyAndHeaders) return undefined;
  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth?.ok) return undefined;
  const headers = { ...(auth.headers ?? {}) };
  if (typeof auth.apiKey === 'string' && auth.apiKey.length > 0) {
    headers.Authorization = `Bearer ${auth.apiKey}`;
  }
  const hasAuthorization = Object.keys(headers).some(
    (name) => name.toLowerCase() === 'authorization' && String(headers[name]).trim().length > 0,
  );
  return hasAuthorization ? headers : undefined;
}

function aggregateCost(contributions, capturedAt) {
  const unavailable = contributions.filter(
    (contribution) => contribution.cost.kind === 'unavailable',
  );
  const known = contributions.filter((contribution) => contribution.cost.kind !== 'unavailable');
  const partialKnownAmounts = unavailable
    .map((contribution) => finiteNonNegative(contribution.cost.knownAmountUsd))
    .filter((amount) => amount !== undefined);
  const knownAmountUsd =
    known.reduce((sum, contribution) => sum + contribution.cost.amountUsd, 0) +
    partialKnownAmounts.reduce((sum, amount) => sum + amount, 0);
  if (unavailable.length > 0) {
    return {
      kind: 'unavailable',
      reason:
        unavailable.length === contributions.length
          ? unavailable[0].cost.reason
          : 'Some assistant turns have no verified cost.',
      ...(known.length > 0 || partialKnownAmounts.length > 0 ? { knownAmountUsd } : {}),
      knownContributions: known.length,
      totalContributions: contributions.length,
    };
  }
  const estimated = contributions.filter((contribution) => contribution.cost.kind === 'estimate');
  if (estimated.length > 0) {
    return {
      kind: 'estimate',
      amountUsd: knownAmountUsd,
      sourceUrl: estimated[0].cost.sourceUrl,
      checkedAt: estimated[0].cost.checkedAt,
    };
  }
  return {
    kind: 'actual',
    amountUsd: knownAmountUsd,
    source: 'OpenRouter generation metadata',
    capturedAt,
  };
}

/**
 * Resolve one API run's audit-safe token and cost truth. Provider metadata wins;
 * a verified catalog estimate is the fallback. Accounting failure never throws.
 */
export async function resolveApiRunUsage({
  messages,
  provenance,
  model,
  modelRegistry,
  fetchImpl = globalThis.fetch,
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  const turns = assistantMessages(messages);
  if (
    turns.length === 0 ||
    provenance?.billingMode !== 'api' ||
    typeof provenance.engineId !== 'string' ||
    typeof provenance.accountId !== 'string' ||
    typeof provenance.modelId !== 'string' ||
    provenance.modelId !== model?.id
  ) {
    return undefined;
  }

  const capturedAt = now().toISOString();
  let headers;
  if (isOpenRouterApiModel(model) && typeof fetchImpl === 'function') {
    try {
      headers = await openRouterRequestHeaders(modelRegistry, model);
    } catch {
      headers = undefined;
    }
  }

  const contributions = await Promise.all(
    turns.map(async (message) => {
      const fallback = adapterTokens(message);
      const responseId =
        typeof message.responseId === 'string' && message.responseId.trim()
          ? message.responseId.trim()
          : undefined;
      let providerData;
      if (headers && responseId) {
        providerData = await fetchOpenRouterGeneration({
          responseId,
          expectedModelId: provenance.modelId,
          headers,
          fetchImpl,
          sleepImpl,
          retryDelaysMs,
          requestTimeoutMs,
        });
      }
      const tokens = providerData ? providerTokens(providerData, fallback) : fallback;
      const actualCost = finiteNonNegative(providerData?.total_cost);
      return {
        tokens,
        speed: executionSpeedMode(providerData?.speed ?? message?.usage?.speed),
        usageSource: providerData ? 'provider' : 'adapter',
        reference: providerData ? responseId : undefined,
        cost:
          actualCost !== undefined
            ? {
                kind: 'actual',
                amountUsd: actualCost,
                source: 'OpenRouter generation metadata',
                capturedAt,
              }
            : estimateContributionCost(tokens, provenance.modelId),
      };
    }),
  );

  const input = aggregateOptionalNumbers(contributions, 'input');
  const output = aggregateOptionalNumbers(contributions, 'output');
  const cacheRead = aggregateOptionalNumbers(contributions, 'cacheRead');
  const cacheWrite = aggregateOptionalNumbers(contributions, 'cacheWrite');
  const reasoning = aggregateOptionalNumbers(contributions, 'reasoning');
  const references = contributions
    .map((contribution) => contribution.reference)
    .filter(Boolean)
    .join(',');
  const executionSpeed =
    contributions.length > 0 &&
    contributions.every(
      (contribution) =>
        contribution.speed !== undefined && contribution.speed === contributions[0]?.speed,
    )
      ? {
          mode: contributions[0].speed,
          source: {
            kind: 'engine-usage',
            capturedAt,
            reference: references || 'pi-model-runtime-usage',
          },
        }
      : undefined;
  return {
    scope: {
      kind: 'api-run',
      engineId: provenance.engineId,
      accountId: provenance.accountId,
      modelId: provenance.modelId,
    },
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    turns: turns.length,
    inputAccounting: 'excludes-cache',
    outputAccounting: 'includes-reasoning',
    usageSource: {
      kind: contributions.every((contribution) => contribution.usageSource === 'provider')
        ? 'provider'
        : 'adapter',
      capturedAt,
      ...(references ? { reference: references } : {}),
    },
    ...(executionSpeed ? { executionSpeed } : {}),
    cost: aggregateCost(contributions, capturedAt),
  };
}
