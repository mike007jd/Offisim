import type { BuiltinTool } from './types.js';

export const WEB_FETCH_TIMEOUT_MS = 10_000;
export const WEB_FETCH_MAX_BODY_BYTES = 1_000_000;

export function createWebFetchTool(): BuiltinTool {
  return {
    def: {
      name: 'web_fetch',
      description: 'Fetch a URL and return text content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
      maxResultSizeChars: 30_000,
    },
    async execute(args) {
      const url = validateWebFetchUrl(args.url);
      // C/C-02: DNS-rebinding mitigation. On Node we resolve the host once
      // and reject if any returned IP sits inside a private/loopback range;
      // an attacker-controlled DNS that returns a public IP at validation
      // time but a private IP at fetch time is the canonical attack. In
      // browser environments we have no DNS hook, so this is a no-op there
      // and the hostname check is the only guard. fail-open on resolve
      // errors so we don't break the tool on transient DNS hiccups.
      //
      // Acknowledged residual window (core-crosscutting/F10): this guard
      // binds to the hostname, not the IP that fetch() ultimately connects
      // to. fetch() re-resolves the host independently, so a DNS that flips
      // public->private between this lookup and the connect can still slip
      // through. Fully closing it would require pinning the validated IP via
      // a Node-only custom undici dispatcher, which would break this tool's
      // isomorphic (browser + Node) design and pull in a dependency not
      // otherwise needed; it is deliberately left as a best-effort guard.
      await rejectPrivateDnsResolution(url.hostname);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          redirect: 'manual',
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          throw new Error('[WEB_FETCH_REDIRECT_DENIED] Redirects are not followed by web_fetch.');
        }
        const text = await readWebFetchTextWithLimit(response, WEB_FETCH_MAX_BODY_BYTES);
        if (!response.ok)
          throw new Error(`[WEB_FETCH_FAILED] ${response.status} ${text.slice(0, 500)}`);
        return text;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function validateWebFetchUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('[WEB_FETCH_URL_DENIED] A non-empty URL string is required.');
  }
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('[WEB_FETCH_URL_DENIED] Only http and https URLs are allowed.');
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    throw new Error('[WEB_FETCH_URL_DENIED] Local and private-network URLs are not allowed.');
  }
  return url;
}

export async function readWebFetchTextWithLimit(
  response: Response,
  maxBytes = WEB_FETCH_MAX_BODY_BYTES,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      throw new Error(`[WEB_FETCH_BODY_TOO_LARGE] Response exceeds ${maxBytes} bytes.`);
    }
  }

  if (!response.body) {
    return '';
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
        await reader.cancel('web_fetch body too large');
        throw new Error(`[WEB_FETCH_BODY_TOO_LARGE] Response exceeds ${maxBytes} bytes.`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1'
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
  return (
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:') ||
    host === 'metadata.google.internal'
  );
}

async function rejectPrivateDnsResolution(hostname: string): Promise<void> {
  // Browser / non-Node host: there's no DNS API we can call before fetch.
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (typeof proc?.versions?.node !== 'string') return;
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<unknown>;
    const dns = (await dynamicImport('node:dns/promises')) as {
      lookup(host: string, opts: { all: true }): Promise<Array<{ address: string }>>;
    };
    const records = await dns.lookup(hostname, { all: true });
    for (const record of records) {
      if (isPrivateOrLocalHost(record.address)) {
        throw new Error(
          '[WEB_FETCH_URL_DENIED] DNS resolved to a private-network IP — refusing fetch.',
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[WEB_FETCH_URL_DENIED]')) throw err;
    // dns.lookup failure (NXDOMAIN, EAI_AGAIN, etc.): let fetch handle it.
  }
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
