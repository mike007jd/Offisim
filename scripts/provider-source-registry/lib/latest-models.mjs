import { fetchOpenRouterModelsPayload } from './openrouter-source.mjs';

/**
 * Default-drift detection — the automatic half of the freshness mechanism.
 *
 * Hand-pinned `defaultModel` ids in official-fixtures rot as providers ship new
 * versions. This module answers "is our pinned default behind?" automatically,
 * grounded in a live, keyless source (OpenRouter `/api/v1/models`, which carries
 * a `created` timestamp per leaf id and covers every vendor we ship).
 *
 * It does NOT auto-rewrite defaults (id forms differ across surfaces, previews
 * and plan/price constraints need a human). It produces a drift report that the
 * refresh writes into diff-report.json and that `provider:check` surfaces as a
 * warning — so "a newer model exists" becomes loud instead of silent, on every
 * `pnpm provider:refresh` / `pnpm provider:latest`.
 */

/** Lowercase + strip every non-alphanumeric so native ids and OpenRouter ids
 *  for the same model collapse to one key:
 *    "claude-opus-4-8"  → "claudeopus48"
 *    "claude-opus-4.8"  → "claudeopus48"
 *    "MiniMax-M3"       → "minimaxm3"  ==  "minimax-m3" */
export function normId(id) {
  return String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '');
}

/**
 * Map an official-fixtures `vendor` to its OpenRouter namespace + the regex that
 * isolates its current product line. `skip` means there is no reliable keyless
 * signal (local weights / user-defined / router-of-routers) — reported, not
 * drift-checked.
 */
export const VENDOR_OPENROUTER_FAMILY = {
  anthropic: { namespace: 'anthropic', line: /^claude-/u },
  openai: { namespace: 'openai', line: /^gpt-5/u },
  google: { namespace: 'google', line: /^gemini-3/u },
  deepseek: { namespace: 'deepseek', line: /^deepseek-v/u },
  kimi: { namespace: 'moonshotai', line: /^kimi-k2/u },
  minimax: { namespace: 'minimax', line: /^minimax-m/u },
  zai: { namespace: 'z-ai', line: /^glm-/u },
  // Local weights (LM Studio/Ollama) and the OpenRouter router itself are
  // version-tracked elsewhere; a cloud "qwen3.7-max" is not a thing you run
  // locally, so flagging local Qwen against it would be a false positive.
  lmstudio: { skip: 'local-weights' },
  qwen: { skip: 'local-weights' },
  openrouter: { skip: 'router' },
  custom: { skip: 'user-defined' },
};

// Variants that are not "the default flagship line" — excluded when picking the
// newest-in-family so drift never points at a preview / modality / free mirror.
const NON_DEFAULT_VARIANT =
  /preview|image|embed|tts|audio|realtime|guard|moderation|exp\b|distill|terminus|:free|-fast\b|-her\b/u;

function tailOf(openRouterId) {
  const id = String(openRouterId);
  const slash = id.indexOf('/');
  return slash >= 0 ? id.slice(slash + 1) : id;
}

/**
 * @param {{ officialFixtures: any, openRouterData: Array<{id:string, created?:number}> }} args
 * @returns {{ generatedFrom: string, providers: Array<object>, summary: object }}
 */
export function detectDefaultDrift({ openRouterData, officialFixtures }) {
  const fixtures = officialFixtures ?? {};
  const byNamespace = new Map();
  for (const model of openRouterData ?? []) {
    if (!model || typeof model.id !== 'string') continue;
    const ns = model.id.includes('/') ? model.id.split('/')[0] : '';
    if (!byNamespace.has(ns)) byNamespace.set(ns, []);
    byNamespace.get(ns).push({
      id: model.id,
      tail: tailOf(model.id),
      created: typeof model.created === 'number' ? model.created : 0,
    });
  }

  const providers = [];
  const providerEntries = Object.entries(fixtures.providers ?? {});
  for (const [providerId, provider] of providerEntries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!provider || typeof provider !== 'object') continue;
    const defaultModel = provider.defaultModel;
    if (!defaultModel) continue;
    const family = VENDOR_OPENROUTER_FAMILY[provider.vendor];

    if (!family || family.skip) {
      providers.push({
        providerId,
        vendor: provider.vendor,
        defaultModel,
        status: 'manual',
        reason: family?.skip ?? 'no-family-mapping',
      });
      continue;
    }

    const pool = (byNamespace.get(family.namespace) ?? []).filter((m) => family.line.test(m.tail));
    const candidates = pool.filter((m) => !NON_DEFAULT_VARIANT.test(m.tail));
    if (candidates.length === 0) {
      providers.push({
        providerId,
        vendor: provider.vendor,
        defaultModel,
        status: 'no-live-data',
        reason: `no ${family.namespace} ${family.line} models on OpenRouter`,
      });
      continue;
    }

    const pinnedNorm = normId(defaultModel);
    // candidates ⊆ pool, so searching the full pool covers every candidate too.
    const pinnedTwin = pool.find((m) => normId(m.tail) === pinnedNorm) ?? null;
    const newest = candidates.slice().sort((a, b) => b.created - a.created)[0];
    // Compare at day granularity so same-day tier variants (e.g. gpt-5.5 vs
    // gpt-5.5-pro, claude-opus-4.8 vs -fast) don't read as a newer version.
    const day = (created) => Math.floor((created || 0) / 86_400);

    if (!pinnedTwin) {
      providers.push({
        providerId,
        vendor: provider.vendor,
        defaultModel,
        status: 'unverifiable',
        reason:
          'pinned default not found on OpenRouter (native-only id or retired) — verify manually',
        latestLeafId: newest.id,
        latestCreated: newest.created
          ? new Date(newest.created * 1000).toISOString().slice(0, 10)
          : null,
      });
      continue;
    }

    const behind =
      day(newest.created) > day(pinnedTwin.created) && normId(newest.tail) !== pinnedNorm;
    providers.push({
      providerId,
      vendor: provider.vendor,
      defaultModel,
      status: behind ? 'behind' : 'current',
      pinnedCreated: pinnedTwin.created
        ? new Date(pinnedTwin.created * 1000).toISOString().slice(0, 10)
        : null,
      latestLeafId: newest.id,
      latestCreated: newest.created
        ? new Date(newest.created * 1000).toISOString().slice(0, 10)
        : null,
      ...(behind
        ? { reason: `newer in-family leaf "${newest.id}" shipped after pinned default` }
        : {}),
    });
  }

  const counts = { behind: 0, current: 0, manual: 0, unverifiable: 0 };
  for (const p of providers) {
    if (p.status in counts) counts[p.status] += 1;
  }
  return {
    generatedFrom: 'openrouter-live',
    providers,
    summary: { providerCount: providers.length, ...counts },
  };
}

/** Fetch the keyless OpenRouter model list. */
export async function fetchOpenRouterModels(options = {}) {
  const payload = await fetchOpenRouterModelsPayload({
    ...options,
    errorLabel: 'OpenRouter models',
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}
