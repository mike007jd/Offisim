import type { SopDefinition } from '@offisim/shared-types';
import type { SopTemplateRepository, SopTemplateRow } from '../runtime/repositories.js';

export const SOP_SYNC_MAX_BODY_BYTES = 256 * 1024;
export const SOP_SYNC_TIMEOUT_MS = 10_000;

export interface SopSyncResult {
  updated: boolean;
  error?: string;
}

/**
 * Syncs SOP templates from remote URLs (e.g. GitHub raw JSON).
 * Designed for lightweight pull-based updates — no push, no auth.
 */
export class SopSyncService {
  constructor(private readonly sopTemplateRepo: SopTemplateRepository) {}

  /**
   * Fetch a remote SOP definition from a URL.
   * Validates basic structure (must have sop_id, name, steps array).
   */
  async fetchRemoteSop(url: string): Promise<SopDefinition> {
    const safeUrl = validateSopSyncUrl(url);
    const response = await fetch(safeUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(SOP_SYNC_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error('SOP sync redirects are not followed; use the final HTTPS URL directly');
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch SOP from ${safeUrl.toString()}: ${response.status} ${response.statusText}`,
      );
    }
    const json = JSON.parse(await readSopSyncTextWithLimit(response)) as Record<string, unknown>;
    if (
      typeof json.sop_id !== 'string' ||
      typeof json.name !== 'string' ||
      !Array.isArray(json.steps)
    ) {
      throw new Error('Invalid SOP definition: missing sop_id, name, or steps');
    }
    return json as unknown as SopDefinition;
  }

  /**
   * Sync a local SOP template from its source_url.
   * Compares definition_json — only updates if content differs.
   */
  async syncFromUrl(sopTemplateId: string): Promise<SopSyncResult> {
    const existing = await this.sopTemplateRepo.findById(sopTemplateId);
    if (!existing) {
      return { updated: false, error: 'SOP template not found' };
    }
    if (!existing.source_url) {
      return { updated: false, error: 'No source URL configured' };
    }

    let remote: SopDefinition;
    try {
      remote = await this.fetchRemoteSop(existing.source_url);
    } catch (err) {
      return { updated: false, error: err instanceof Error ? err.message : String(err) };
    }

    const remoteJson = JSON.stringify(remote);
    let normalizedExisting: string;
    try {
      normalizedExisting = JSON.stringify(JSON.parse(existing.definition_json));
    } catch {
      return { updated: false, error: 'Corrupted local SOP definition_json' };
    }
    if (remoteJson === normalizedExisting) {
      await this.sopTemplateRepo.update(sopTemplateId, {
        last_synced_at: new Date().toISOString(),
      });
      return { updated: false };
    }

    await this.sopTemplateRepo.update(sopTemplateId, {
      name: remote.name,
      description: remote.description,
      definition_json: remoteJson,
      version: remote.sop_id,
      last_synced_at: new Date().toISOString(),
    });

    return { updated: true };
  }

  /**
   * Import a remote SOP by URL into a company.
   * Creates a new local template linked to the remote source.
   */
  async importFromUrl(url: string, companyId: string): Promise<SopTemplateRow> {
    const remote = await this.fetchRemoteSop(url);
    return this.importFromDefinition(remote, url, companyId);
  }

  /**
   * Import an already-fetched SOP definition into a company.
   * Use when the definition was pre-fetched (e.g. during preview).
   */
  async importFromDefinition(
    definition: SopDefinition,
    sourceUrl: string,
    companyId: string,
  ): Promise<SopTemplateRow> {
    const sopTemplateId = `sop_${crypto.randomUUID()}`;
    return this.sopTemplateRepo.create({
      sop_template_id: sopTemplateId,
      company_id: companyId,
      name: definition.name,
      description: definition.description,
      definition_json: JSON.stringify(definition),
      source_thread_id: null,
      source_url: sourceUrl,
      version: definition.sop_id,
      last_synced_at: new Date().toISOString(),
    });
  }
}

export function validateSopSyncUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch (err) {
    throw new Error(`SOP sync URL is invalid: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error('SOP sync URL must use https');
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    throw new Error('SOP sync URL cannot target localhost or a private network');
  }
  return url;
}

export async function readSopSyncTextWithLimit(
  response: Response,
  maxBytes = SOP_SYNC_MAX_BODY_BYTES,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      throw new Error(`SOP sync response exceeds ${maxBytes} bytes`);
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`SOP sync response exceeds ${maxBytes} bytes`);
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
        await reader.cancel('sop sync response too large');
        throw new Error(`SOP sync response exceeds ${maxBytes} bytes`);
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
