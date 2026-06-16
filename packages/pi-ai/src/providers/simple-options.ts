import type {
  Api,
  Model,
  SimpleStreamOptions,
  StreamOptions,
  ThinkingBudgets,
  ThinkingLevel,
} from '../types.js';

export function buildBaseOptions(
  _model: Model<Api>,
  options?: SimpleStreamOptions,
  apiKey?: string,
): StreamOptions {
  return {
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    signal: options?.signal,
    apiKey: apiKey || options?.apiKey,
    fetch: options?.fetch,
    transport: options?.transport,
    cacheRetention: options?.cacheRetention,
    sessionId: options?.sessionId,
    headers: options?.headers,
    onPayload: options?.onPayload,
    onResponse: options?.onResponse,
    timeoutMs: options?.timeoutMs,
    websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
    maxRetries: options?.maxRetries,
    maxRetryDelayMs: options?.maxRetryDelayMs,
    metadata: options?.metadata,
  };
}

export function clampReasoning(
  effort: ThinkingLevel | undefined,
): Exclude<ThinkingLevel, 'xhigh'> | undefined {
  return effort === 'xhigh' ? 'high' : effort;
}

export function adjustMaxTokensForThinking(
  // Undefined means no explicit caller cap. Use the model cap and fit thinking inside it.
  baseMaxTokens: number | undefined,
  modelMaxTokens: number,
  reasoningLevel: ThinkingLevel,
  customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
  const defaultBudgets: Required<ThinkingBudgets> = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384,
  };
  const budgets: Required<ThinkingBudgets> = { ...defaultBudgets, ...customBudgets };

  const minOutputTokens = 1024;
  const level = clampReasoning(reasoningLevel);
  if (!level) {
    return { maxTokens: baseMaxTokens ?? modelMaxTokens, thinkingBudget: 0 };
  }
  let thinkingBudget = budgets[level] ?? defaultBudgets.medium;
  const maxTokens =
    baseMaxTokens === undefined
      ? modelMaxTokens
      : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

  if (maxTokens <= thinkingBudget) {
    thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
  }

  return { maxTokens, thinkingBudget };
}
