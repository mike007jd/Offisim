const DEFAULT_OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export async function fetchOpenRouterModelsPayload(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const url = options.modelsUrl ?? options.source?.config?.modelsUrl ?? DEFAULT_OPENROUTER_MODELS_URL;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable; pass options.fetchImpl or use fixtureDir');
  }
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('openrouter-live source config must include modelsUrl');
  }
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const label = options.errorLabel ?? 'OpenRouter model catalog';
    throw new Error(`Failed to fetch ${label}: ${response.status}`);
  }
  return response.json();
}
