/**
 * The pi `StreamFn` thin wrapper — the credential seam at the agent boundary.
 *
 * It calls pi-ai's `streamSimple` with the Offisim transport `fetch` injected
 * (and a placeholder `apiKey`). The real credential is attached by the Rust
 * `llm_fetch` command inside that fetch, so it never crosses the JS boundary.
 * Budget compaction is handled by the loop's `transformContext` hook (see
 * `pi-budget.ts`), not here — this wrapper only does transport wiring.
 */

import { streamSimple } from '@offisim/pi-ai';
import type { StreamFn } from '@offisim/pi-agent';

/** Placeholder key sent to the provider SDK; the Rust transport replaces it. */
export const TAURI_MANAGED_API_KEY = 'offisim-tauri-managed';

export interface PiStreamDeps {
  /** Transport fetch (e.g. `createTauriLlmFetch(profile)`), injected from the host. */
  readonly fetch: typeof fetch;
  /** Override the placeholder API key if a provider rejects the default sentinel. */
  readonly apiKeyPlaceholder?: string;
}

export function createPiStreamFn(deps: PiStreamDeps): StreamFn {
  const apiKey = deps.apiKeyPlaceholder ?? TAURI_MANAGED_API_KEY;
  return (model, context, options) =>
    streamSimple(model, context, {
      ...options,
      apiKey,
      fetch: deps.fetch,
    });
}
