import { useCallback, useEffect, useState } from 'react';
import type { Zone } from '@offisim/shared-types';
import { SYSTEM_ZONE_TEMPLATES, templateToZone } from '@offisim/shared-types';
import { hydrateZone } from '@offisim/core/browser';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context.js';
import { useCompany } from '../components/company/CompanyContext.js';

/**
 * Load zones for the active company from the database.
 * Falls back to SYSTEM_ZONE_TEMPLATES if no zones are persisted yet.
 */
export function useCompanyZones(): { zones: Zone[]; loading: boolean; refresh: () => void } {
  const { repos } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) {
      setZones([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const rows = await repos.zones.findByCompany(activeCompanyId);
      if (rows.length > 0) {
        setZones(rows.map((r) => hydrateZone(r)));
      } else {
        // Fallback: use templates as Zone objects (company not yet zone-seeded)
        setZones(
          SYSTEM_ZONE_TEMPLATES.map((t) => templateToZone(t, activeCompanyId)),
        );
      }
    } catch {
      setZones([]);
    } finally {
      setLoading(false);
    }
  }, [repos, activeCompanyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { zones, loading, refresh };
}
