import type { SopDefinition } from '@offisim/shared-types';
import type { SopTemplateRepository, SopTemplateRow } from '../runtime/repositories.js';

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
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch SOP from ${url}: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as Record<string, unknown>;
    if (typeof json.sop_id !== 'string' || typeof json.name !== 'string' || !Array.isArray(json.steps)) {
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
