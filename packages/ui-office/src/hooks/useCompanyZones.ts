import { useEffect, useState } from 'react';
import type { Zone } from '@aics/shared-types';
import { SYSTEM_ZONE_TEMPLATES, templateToZone } from '@aics/shared-types';
import { hydrateZone } from '@aics/core/browser';
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';
import { useCompany } from '../components/company/CompanyContext.js';

/**
 * Load zones for the active company from the database.
 * Falls back to SYSTEM_ZONE_TEMPLATES if no zones are persisted yet.
 */
export function useCompanyZones(): { zones: Zone[]; loading: boolean } {
  const { repos } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repos || !activeCompanyId) {
      setZones([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    repos.zones
      .findByCompany(activeCompanyId)
      .then((rows) => {
        if (rows.length > 0) {
          setZones(rows.map((r) => hydrateZone(r)));
        } else {
          // Fallback: use templates as Zone objects (company not yet zone-seeded)
          setZones(
            SYSTEM_ZONE_TEMPLATES.map((t) => templateToZone(t, activeCompanyId)),
          );
        }
        setLoading(false);
      })
      .catch(() => {
        setZones([]);
        setLoading(false);
      });
  }, [repos, activeCompanyId]);

  return { zones, loading };
}
