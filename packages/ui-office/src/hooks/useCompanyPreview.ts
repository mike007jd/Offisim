import type { RuntimeRepositories } from '@offisim/core/browser';
import type { PrefabInstanceRow, ZoneRow } from '@offisim/shared-types';
import { useEffect, useState } from 'react';

interface CompanyPreviewData {
  zones: ZoneRow[];
  prefabs: PrefabInstanceRow[];
}

interface CompanyPreviewState {
  data: CompanyPreviewData | null;
  loading: boolean;
}

export function useCompanyPreview(
  repos: RuntimeRepositories | null,
  companyId: string | null,
): CompanyPreviewState {
  const [state, setState] = useState<CompanyPreviewState>({ data: null, loading: false });

  useEffect(() => {
    if (!repos || !companyId) {
      setState({ data: null, loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    void Promise.all([
      repos.zones.findByCompany(companyId),
      repos.prefabInstances.findByCompany(companyId),
    ])
      .then(([zones, prefabs]) => {
        if (cancelled) return;
        setState({ data: { zones, prefabs }, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ data: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [repos, companyId]);

  return state;
}
