/**
 * Historical pi `StreamFn` thin wrapper.
 *
 * The active desktop runtime now uses the official Pi Agent Host. This wrapper
 * remains for legacy harness code that still calls the trimmed `@offisim/pi-ai`
 * stream helper with an injected fetch.
 */

import type { StreamFn } from '@offisim/pi-agent';
import { streamSimple } from '@offisim/pi-ai';

/** Placeholder key sent to legacy provider SDK clients. */
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
