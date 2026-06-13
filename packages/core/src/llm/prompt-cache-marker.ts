/**
 * Sentinel appended to the end of an employee system prompt to delimit the
 * cache-volatile tail. The prompt-cache contract: everything BEFORE the marker
 * is stable across turns (cacheable); everything from the marker onward is
 * per-turn volatile. The Anthropic and OpenAI adapters read this marker to place
 * the cache breakpoint / strip the volatile tail for providers without explicit
 * cache controls. Kept as a standalone constant so the transport adapters do not
 * depend on the prompt-assembly layer.
 */
export const PROMPT_CACHE_VOLATILE_MARKER = '<!-- offisim-cache-volatile -->';
