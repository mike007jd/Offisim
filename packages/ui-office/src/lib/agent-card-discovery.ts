import type { A2AAgentCard } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import type { ExternalBrandVariant } from './brand-registry';

const AGENT_CARD_PATH = '/.well-known/agent-card.json';
const MAX_BODY_BYTES = 20 * 1024;
const DISCOVERY_TIMEOUT_MS = 10_000;

export type AgentCardDiscoveryErrorClass =
  | 'network'
  | 'cors'
  | 'invalid-json'
  | 'schema'
  | 'incompatible-protocol';

export class AgentCardDiscoveryError extends Error {
  readonly class: AgentCardDiscoveryErrorClass;
  readonly cause?: unknown;
  readonly status?: number;

  constructor(
    errorClass: AgentCardDiscoveryErrorClass,
    message: string,
    extra?: { cause?: unknown; status?: number },
  ) {
    super(message);
    this.name = 'AgentCardDiscoveryError';
    this.class = errorClass;
    this.cause = extra?.cause;
    this.status = extra?.status;
  }
}

export interface DiscoverAgentCardOptions {
  token?: string;
  agentId?: string;
  signal?: AbortSignal;
}

export async function discoverAgentCard(
  url: string,
  opts: DiscoverAgentCardOptions = {},
): Promise<A2AAgentCard> {
  const baseUrl = validateExternalAgentBaseUrl(url);
  const cardUrl = new URL(AGENT_CARD_PATH, baseUrl);
  const signal = timeoutSignal(opts.signal, DISCOVERY_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(cardUrl, { headers, signal, redirect: 'manual' });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Browsers surface DNS failure, connection refused, and CORS blocks as the
    // same opaque `TypeError: Failed to fetch` — JS cannot read the cause
    // directly. Probe reachability with mode:'no-cors' (no headers to avoid
    // preflight). An opaque response means the endpoint is reachable and the
    // original failure was CORS; another throw means the endpoint really is
    // unreachable.
    if (/\b(cors|origin)\b/i.test(msg)) {
      throw new AgentCardDiscoveryError(
        'cors',
        'Remote server did not allow the browser to read the agent card. Ask the owner to add Access-Control-Allow-Origin for this origin.',
        { cause: err },
      );
    }
    let reachable = false;
    try {
      await fetch(cardUrl, { method: 'GET', mode: 'no-cors', signal });
      reachable = true;
    } catch (probeErr) {
      if ((probeErr as { name?: string })?.name === 'AbortError') {
        throw probeErr;
      }
      reachable = false;
    }
    if (reachable) {
      throw new AgentCardDiscoveryError(
        'cors',
        'Remote server did not allow the browser to read the agent card. Ask the owner to add Access-Control-Allow-Origin for this origin.',
        { cause: err },
      );
    }
    throw new AgentCardDiscoveryError('network', `Network error: ${msg}`, { cause: err });
  }

  if (res.status >= 300 && res.status < 400) {
    throw new AgentCardDiscoveryError(
      'network',
      'Agent card redirects are not followed. Use the final HTTPS endpoint directly.',
      { status: res.status },
    );
  }

  if (!res.ok) {
    throw new AgentCardDiscoveryError(
      'network',
      `Agent card fetch failed: ${res.status} ${res.statusText}`,
      { status: res.status },
    );
  }

  const text = await readResponseTextWithLimit(res, MAX_BODY_BYTES);
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new AgentCardDiscoveryError(
      'schema',
      `Agent card body is too large (limit ${MAX_BODY_BYTES} bytes).`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new AgentCardDiscoveryError('invalid-json', 'Response body is not valid JSON.', {
      cause: err,
    });
  }

  const card = parsed as Partial<A2AAgentCard> | null;
  if (!card || typeof card !== 'object') {
    throw new AgentCardDiscoveryError('schema', 'Agent card is not a JSON object.');
  }
  if (typeof card.name !== 'string' || card.name.length === 0) {
    throw new AgentCardDiscoveryError('schema', 'Agent card is missing required `name`.');
  }
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) {
    throw new AgentCardDiscoveryError(
      'schema',
      'Agent card is missing required `supportedInterfaces[]`.',
    );
  }
  const hasJsonRpc = card.supportedInterfaces.some(
    (iface) => iface && typeof iface === 'object' && iface.protocolBinding === 'JSONRPC',
  );
  if (!hasJsonRpc) {
    throw new AgentCardDiscoveryError(
      'incompatible-protocol',
      'Agent advertises no JSON-RPC binding. Offisim only speaks JSON-RPC over HTTP.',
    );
  }
  for (const iface of card.supportedInterfaces) {
    if (!iface || typeof iface !== 'object' || iface.protocolBinding !== 'JSONRPC') continue;
    const endpoint = validateExternalAgentBaseUrl(iface.url);
    if (endpoint.origin !== baseUrl.origin) {
      throw new AgentCardDiscoveryError(
        'schema',
        'Agent card JSON-RPC endpoint must stay on the configured agent origin.',
      );
    }
  }

  return card as A2AAgentCard;
}

export function validateExternalAgentBaseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch (err) {
    throw new AgentCardDiscoveryError('schema', 'Agent URL must be a valid URL.', { cause: err });
  }
  if (url.protocol !== 'https:') {
    throw new AgentCardDiscoveryError('schema', 'Agent URL must use https.');
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    throw new AgentCardDiscoveryError(
      'schema',
      'Agent URL cannot target localhost or a private network.',
    );
  }
  return url;
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      throw new AgentCardDiscoveryError(
        'schema',
        `Agent card body is too large (limit ${maxBytes} bytes).`,
      );
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new AgentCardDiscoveryError(
        'schema',
        `Agent card body is too large (limit ${maxBytes} bytes).`,
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('agent card body too large');
        throw new AgentCardDiscoveryError(
          'schema',
          `Agent card body is too large (limit ${maxBytes} bytes).`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => {
    window.clearTimeout(timeout);
    controller.abort();
  };
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener(
    'abort',
    () => {
      window.clearTimeout(timeout);
      parent?.removeEventListener('abort', abort);
    },
    { once: true },
  );
  return controller.signal;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.startsWith('::ffff:')) {
    const mapped = parseIpv4(host.slice('::ffff:'.length));
    if (mapped) return isPrivateOrLocalHost(mapped.join('.'));
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) return Number.NaN;
    return Number(part);
  });
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets as [number, number, number, number];
}

const BRAND_ORDER: ReadonlyArray<Exclude<ExternalBrandVariant, 'custom'>> = [
  'hermes',
  'openclaw',
  'codex',
];

export function inferBrandKey(card: A2AAgentCard): ExternalBrandVariant {
  const haystack = `${card.name ?? ''} ${card.provider?.organization ?? ''}`.toLowerCase();
  for (const key of BRAND_ORDER) {
    if (haystack.includes(key)) return key;
  }
  return 'custom';
}

export function defaultRoleForBrand(brand: ExternalBrandVariant): RoleSlug | null {
  switch (brand) {
    case 'hermes':
    case 'codex':
      return 'developer';
    case 'openclaw':
      return 'researcher';
    default:
      return null;
  }
}

export function describeDiscoveryError(err: AgentCardDiscoveryError): string {
  switch (err.class) {
    case 'network':
      return `We could not reach the agent card URL. ${err.message}`;
    case 'cors':
      return 'The remote server blocked the browser from reading the agent card. It needs to return Access-Control-Allow-Origin for this origin.';
    case 'invalid-json':
      return 'The remote server returned something that is not valid JSON.';
    case 'schema':
      return `The returned agent card is missing required fields. ${err.message}`;
    case 'incompatible-protocol':
      return 'This agent does not offer a JSON-RPC binding — Offisim cannot dispatch tasks to it.';
  }
}
