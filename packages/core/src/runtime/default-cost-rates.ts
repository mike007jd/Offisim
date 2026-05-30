import type { ModelCostRateRepository, SettingsRepository } from './repositories.js';

/**
 * Default cost rates for common LLM providers and models.
 *
 * Costs are expressed in USD per million tokens (MTok).
 * These rates are seeded into the `model_cost_rates` table once at runtime
 * bootstrap via {@link seedDefaultCostRates}; without that seed the cost UI
 * silently reports $0 / 'unknown' out of the box because the table is empty.
 * Users can override rates via the UI or direct DB edits.
 */
export const DEFAULT_COST_RATES: Array<{
  provider: string;
  model_pattern: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
}> = [
  // OpenAI
  // `gpt-4o*` covers the exact `gpt-4o` id (and any suffix) with the same rate,
  // so no separate exact row is needed — matchCostRate scores by pattern length
  // and the longer `gpt-4o-mini*` still wins for the mini variant.
  {
    provider: 'openai',
    model_pattern: 'gpt-4o*',
    input_cost_per_mtok: 2.5,
    output_cost_per_mtok: 10,
  },
  {
    provider: 'openai',
    model_pattern: 'gpt-4o-mini*',
    input_cost_per_mtok: 0.15,
    output_cost_per_mtok: 0.6,
  },
  {
    provider: 'openai',
    model_pattern: 'gpt-4-turbo*',
    input_cost_per_mtok: 10,
    output_cost_per_mtok: 30,
  },
  // Anthropic
  {
    provider: 'anthropic',
    model_pattern: 'claude-3-opus*',
    input_cost_per_mtok: 15,
    output_cost_per_mtok: 75,
  },
  {
    provider: 'anthropic',
    model_pattern: 'claude-3.5-sonnet*',
    input_cost_per_mtok: 3,
    output_cost_per_mtok: 15,
  },
  {
    provider: 'anthropic',
    model_pattern: 'claude-sonnet-4*',
    input_cost_per_mtok: 3,
    output_cost_per_mtok: 15,
  },
  {
    provider: 'anthropic',
    model_pattern: 'claude-3-haiku*',
    input_cost_per_mtok: 0.25,
    output_cost_per_mtok: 1.25,
  },
  // Google (via openai-compat)
  {
    provider: 'openai-compat',
    model_pattern: 'gemini-2.5-flash*',
    input_cost_per_mtok: 0.15,
    output_cost_per_mtok: 0.6,
  },
  {
    provider: 'openai-compat',
    model_pattern: 'gemini-2.5-pro*',
    input_cost_per_mtok: 1.25,
    output_cost_per_mtok: 10,
  },
  {
    provider: 'openai-compat',
    model_pattern: 'gemini-2.0-flash*',
    input_cost_per_mtok: 0.1,
    output_cost_per_mtok: 0.4,
  },
  // MiniMax — Offisim's default provider. Public M2.7 list price (2026):
  // $0.279 / MTok input, $1.20 / MTok output. MiniMax reaches the runtime via
  // the CORS-friendly Anthropic-compatible transport on desktop but may be
  // tagged 'openai-compat' elsewhere, so it is seeded under both LlmProvider
  // tags. The `MiniMax*` pattern is disjoint from claude-*/gpt-*/gemini-*, so
  // the duplicate carries no collision risk and guarantees a match regardless
  // of which provider string the call was recorded under.
  {
    provider: 'anthropic',
    model_pattern: 'MiniMax*',
    input_cost_per_mtok: 0.279,
    output_cost_per_mtok: 1.2,
  },
  {
    provider: 'openai-compat',
    model_pattern: 'MiniMax*',
    input_cost_per_mtok: 0.279,
    output_cost_per_mtok: 1.2,
  },
];

const COST_RATES_SEED_MARKER = 'cost_rates_seed_v1_done';
// Stable sentinel so re-running upsert hits the
// (provider, model_pattern, effective_from) conflict target and updates in
// place rather than inserting a duplicate generation.
const SEED_EFFECTIVE_FROM = '1970-01-01T00:00:00.000Z';

/**
 * One-time idempotent seed of {@link DEFAULT_COST_RATES} into the
 * `model_cost_rates` table. Guarded by a `settings.cost_rates_seed_v1_done`
 * marker (the same pattern as the skills migration) so subsequent boots are a
 * cheap no-op, and `upsert` keeps it safe even if the marker is cleared. Call
 * once during runtime bootstrap; rows are open-ended (`effective_until: null`)
 * so the cost UI's `effective_until IS NULL` filter picks them up.
 */
export async function seedDefaultCostRates(deps: {
  costRates: ModelCostRateRepository;
  settings: SettingsRepository;
}): Promise<void> {
  if ((await deps.settings.get(COST_RATES_SEED_MARKER)) === 'true') return;
  for (const rate of DEFAULT_COST_RATES) {
    await deps.costRates.upsert({
      provider: rate.provider,
      model_pattern: rate.model_pattern,
      input_cost_per_mtok: rate.input_cost_per_mtok,
      output_cost_per_mtok: rate.output_cost_per_mtok,
      effective_from: SEED_EFFECTIVE_FROM,
      effective_until: null,
    });
  }
  await deps.settings.set(COST_RATES_SEED_MARKER, 'true');
}
