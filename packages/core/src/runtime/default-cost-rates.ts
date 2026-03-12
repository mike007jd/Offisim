/**
 * Default cost rates for common LLM providers and models.
 *
 * Costs are expressed in USD per million tokens (MTok).
 * These rates serve as initial seed data for the `model_cost_rates` table.
 * Users can override rates via the UI or direct DB edits.
 */
export const DEFAULT_COST_RATES: Array<{
  provider: string;
  model_pattern: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
}> = [
  // OpenAI
  {
    provider: 'openai',
    model_pattern: 'gpt-4o',
    input_cost_per_mtok: 2.5,
    output_cost_per_mtok: 10,
  },
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
];
