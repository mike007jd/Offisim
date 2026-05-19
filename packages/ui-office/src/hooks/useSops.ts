import type { SopTemplateRow } from '@offisim/core/browser';
import { useCallback, useEffect, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context';

export interface SopTemplate {
  sopTemplateId: string;
  companyId: string;
  name: string;
  description: string;
  definitionJson: string;
  sourceThreadId: string | null;
  sourceUrl: string | null;
  version: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stepCount: number;
}

function toSopTemplate(row: SopTemplateRow): SopTemplate {
  let stepCount = 0;
  try {
    const def = JSON.parse(row.definition_json) as { steps?: unknown[] };
    stepCount = Array.isArray(def.steps) ? def.steps.length : 0;
  } catch {
    // malformed JSON — stepCount stays 0
  }
  return {
    sopTemplateId: row.sop_template_id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    definitionJson: row.definition_json,
    sourceThreadId: row.source_thread_id,
    sourceUrl: row.source_url,
    version: row.version,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stepCount,
  };
}

export interface UseSopsResult {
  sops: SopTemplate[];
  loading: boolean;
  error: string | null;
  deleteSop: (sopTemplateId: string) => Promise<void>;
  refreshSops: () => Promise<void>;
}

export function useSops(): UseSopsResult {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const [sops, setSops] = useState<SopTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSops = useCallback(async () => {
    if (!repos || !activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await repos.sopTemplates.findByCompany(activeCompanyId);
      setSops(rows.map(toSopTemplate));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SOPs.');
    } finally {
      setLoading(false);
    }
  }, [repos, activeCompanyId]);

  // Initial load
  useEffect(() => {
    void refreshSops();
  }, [refreshSops]);

  // Subscribe to sop.* events to auto-refresh after save/delete
  useEffect(() => {
    const off = eventBus.on('sop.', () => {
      void refreshSops();
    });
    return off;
  }, [eventBus, refreshSops]);

  const deleteSop = useCallback(
    async (sopTemplateId: string) => {
      if (!repos) return;
      await repos.sopTemplates.delete(sopTemplateId);
      setSops((prev) => prev.filter((s) => s.sopTemplateId !== sopTemplateId));
    },
    [repos],
  );

  return { sops, loading, error, deleteSop, refreshSops };
}
