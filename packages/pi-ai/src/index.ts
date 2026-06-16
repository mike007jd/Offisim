/**
 * Offisim fork of `@earendil-works/pi-ai` (upstream `earendil-works/pi`,
 * MIT, pinned at v0.79.2 / commit f21f3c4). Trimmed to two provider lanes —
 * `anthropic-messages` and `openai-completions` — for the Tauri WebView. See
 * README.md for the fork rationale, removed surface, and the credential seam.
 */

export type { Static, TSchema } from 'typebox';
export { Type } from 'typebox';

export * from './api-registry.js';
export * from './models.js';
export type {
  AnthropicEffort,
  AnthropicOptions,
  AnthropicThinkingDisplay,
} from './providers/anthropic.js';
export { streamAnthropic, streamSimpleAnthropic } from './providers/anthropic.js';
export type { OpenAICompletionsOptions } from './providers/openai-completions.js';
export {
  streamOpenAICompletions,
  streamSimpleOpenAICompletions,
} from './providers/openai-completions.js';
export * from './providers/register-builtins.js';
export * from './stream.js';
export * from './types.js';
export * from './utils/diagnostics.js';
export * from './utils/event-stream.js';
export * from './utils/json-parse.js';
export * from './utils/overflow.js';
export * from './utils/typebox-helpers.js';
export * from './utils/validation.js';
