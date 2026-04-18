import type { A2AAgentCard } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import type { ExternalBrandVariant } from './brand-registry';

const AGENT_CARD_PATH = '/.well-known/agent-card.json';
const MAX_BODY_BYTES = 20 * 1024;

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
  const base = url.trim().replace(/\/$/, '');
  const cardUrl = `${base}${AGENT_CARD_PATH}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(cardUrl, { headers, signal: opts.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/cors|blocked|origin/i.test(msg) || err instanceof TypeError) {
      throw new AgentCardDiscoveryError(
        'cors',
        'Remote server did not allow the browser to read the agent card. Ask the owner to add Access-Control-Allow-Origin for this origin.',
        { cause: err },
      );
    }
    throw new AgentCardDiscoveryError('network', `Network error: ${msg}`, { cause: err });
  }

  if (!res.ok) {
    throw new AgentCardDiscoveryError(
      'network',
      `Agent card fetch failed: ${res.status} ${res.statusText}`,
      { status: res.status },
    );
  }

  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new AgentCardDiscoveryError(
      'schema',
      `Agent card body is too large (${text.length} bytes; limit ${MAX_BODY_BYTES}).`,
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

  return card as A2AAgentCard;
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
