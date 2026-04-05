import { hydrateZone } from '@offisim/core/browser';
import type { Zone } from '@offisim/shared-types';
import { SYSTEM_ZONE_TEMPLATES, templateToZone } from '@offisim/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context.js';

/**
 * Load zones for the active company from the database.
 * Falls back to SYSTEM_ZONE_TEMPLATES if no zones are persisted yet.
 */
export function useCompanyZones(): {
  zones: Zone[];
  loading: boolean;
  isFallback: boolean;
  refresh: () => void;
} {
  const { repos } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) {
      setZones([]);
      setLoading(false);
      setIsFallback(false);
      return;
    }

    setLoading(true);
    try {
      const rows = await repos.zones.findByCompany(activeCompanyId);
      if (rows.length > 0) {
        setZones(rows.map((r) => hydrateZone(r)));
        setIsFallback(false);
      } else {
        // Fallback: use templates as Zone objects (company not yet zone-seeded)
        setZones(SYSTEM_ZONE_TEMPLATES.map((t) => templateToZone(t, activeCompanyId)));
        setIsFallback(true);
      }
    } catch {
      setZones([]);
      setIsFallback(false);
    } finally {
      setLoading(false);
    }
  }, [repos, activeCompanyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { zones, loading, isFallback, refresh };
}
