import { getTauriDb } from '@/lib/tauri-db.js';
import { globToRegex } from '@offisim/core/browser';
import { isTauriRuntime } from './adapters.js';
import type { RunCost } from './types.js';

// LLM run-cost pricing engine: reads llm_calls + model_cost_rates and rolls them
// up into the RunCost view-model surfaced by useRunCost. Split out of queries.ts
// so the query module holds query plumbing, not a pricing engine.

interface LlmUsageRow {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  usage_raw_json: string | null;
  recording_mode: string | null;
}

interface CostRateRow {
  provider: string;
  model_pattern: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
}

function matchesModelPattern(pattern: string, model: string): boolean {
  // Shared escape-then-translate rule (avoids drift across the renderer/core
  // glob copies). See @offisim/core's glob-match.
  return globToRegex(pattern).test(model);
}

function findCostRate(rates: CostRateRow[], provider: string, model: string): CostRateRow | null {
  const matches = rates.filter(
    (rate) =>
      rate.provider.toLowerCase() === provider.toLowerCase() &&
      matchesModelPattern(rate.model_pattern, model),
  );
  matches.sort((a, b) => b.model_pattern.length - a.model_pattern.length);
  return matches[0] ?? null;
}

function estimateCallCost(call: LlmUsageRow, rates: CostRateRow[]): number {
  const rate = findCostRate(rates, call.provider, call.model);
  if (!rate) return 0;
  // The 0.1x cache-read / 1.25x cache-write multipliers are vendor-specific:
  // correct for the cache-aware vendor, a known approximation elsewhere. On the
  // compat lane (including the default provider) the cache-token columns are not
  // populated upstream, so these terms are 0 and the approximation stays latent
  // rather than active mispricing.
  const inputCost =
    (call.input_tokens / 1_000_000) * rate.input_cost_per_mtok +
    (call.cache_read_input_tokens / 1_000_000) * rate.input_cost_per_mtok * 0.1 +
    (call.cache_creation_input_tokens / 1_000_000) * rate.input_cost_per_mtok * 1.25;
  const outputCost = (call.output_tokens / 1_000_000) * rate.output_cost_per_mtok;
  return inputCost + outputCost;
}

function formatCostLabel(cost: number): string {
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export async function loadRunCost(): Promise<RunCost> {
  if (!isTauriRuntime()) return { tokens: 0, costLabel: '$0.00', live: false };
  try {
    const db = await getTauriDb();
    const [calls, rates] = await Promise.all([
      db.select<LlmUsageRow[]>(
        `SELECT provider,
                model,
                input_tokens,
                output_tokens,
                cache_read_input_tokens,
                cache_creation_input_tokens,
                usage_raw_json,
                recording_mode
           FROM llm_calls`,
      ),
      db.select<CostRateRow[]>(
        `SELECT provider,
                model_pattern,
                input_cost_per_mtok,
                output_cost_per_mtok
           FROM model_cost_rates
          WHERE effective_until IS NULL OR effective_until > datetime('now')`,
      ),
    ]);
    const tokens = calls.reduce(
      (sum, call) =>
        sum +
        call.input_tokens +
        call.output_tokens +
        call.cache_read_input_tokens +
        call.cache_creation_input_tokens,
      0,
    );
    const cost = calls.reduce((sum, call) => sum + estimateCallCost(call, rates), 0);
    const hasUnknownUsage = calls.some(
      (call) =>
        call.recording_mode === 'usage-unknown' ||
        (!call.usage_raw_json &&
          call.input_tokens +
            call.output_tokens +
            call.cache_read_input_tokens +
            call.cache_creation_input_tokens ===
            0),
    );
    const costLabel =
      hasUnknownUsage && tokens === 0
        ? 'Usage unknown'
        : hasUnknownUsage
          ? `${formatCostLabel(cost)}+`
          : formatCostLabel(cost);
    return { tokens, costLabel, live: calls.length > 0 };
  } catch {
    // A missing/renamed cost table or column should degrade to a non-live zero
    // cost, not surface as a hard query error in the cost UI.
    return { tokens: 0, costLabel: '$0.00', live: false };
  }
}
