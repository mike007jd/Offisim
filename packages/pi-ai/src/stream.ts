/**
 * Offisim fork of pi-ai `stream.ts`.
 *
 * The upstream module reads provider API keys from process.env via
 * `withEnvApiKey`. Offisim no longer uses this trimmed provider transport as
 * the desktop runtime; the active path is the official Pi Agent Host, which
 * owns provider auth/model/session state. This legacy fork keeps env-key
 * sourcing removed so old adapter code cannot silently revive process.env
 * credentials.
 */

import './providers/register-builtins.js';

import { getApiProvider } from './api-registry.js';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  ProviderStreamOptions,
  SimpleStreamOptions,
  StreamOptions,
} from './types.js';

function resolveApiProvider(api: Api) {
  const provider = getApiProvider(api);
  if (!provider) {
    throw new Error(`No API provider registered for api: ${api}`);
  }
  return provider;
}

async function drainAndReturn(stream: AssistantMessageEventStream): Promise<AssistantMessage> {
  for await (const _event of stream) {
    // Drain queued provider events so result-only callers do not retain the full stream.
  }
  return stream.result();
}

export function stream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  return provider.stream(model, context, options as StreamOptions);
}

export async function complete<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
  const s = stream(model, context, options);
  return drainAndReturn(s);
}

export function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  return provider.streamSimple(model, context, options);
}

export async function completeSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  const s = streamSimple(model, context, options);
  return drainAndReturn(s);
}
