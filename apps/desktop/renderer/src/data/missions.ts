import { reposOrNull } from '@/data/adapters.js';
import type { MissionRow } from '@offisim/core/browser';
import { useQuery } from '@tanstack/react-query';

/**
 * TanStack Query hooks over the Verified Missions repos (PRD §24). The
 * Missions → Loops migration moved authoring + control to Loops
 * (`data/loops.ts`, surfaces/mission/loops); this module now exposes only the
 * read-side list hook that `LoopRuns` renders over the legacy mission rows.
 * Mirrors the queries.ts convention: `reposOrNull()` is the one door to the
 * SQLite-backed repos, and browser preview returns empty (there is no mission
 * fixture seam — missions are a real-backend-only surface).
 */

const missionKeys = {
  /** All missions for a company (the list view). */
  list: (companyId: string | null) => ['missions', companyId] as const,
};

export function useMissions(companyId: string | null) {
  return useQuery<MissionRow[]>({
    queryKey: missionKeys.list(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const repos = await reposOrNull();
      if (!repos?.missions) return [];
      return repos.missions.listByCompany(companyId, { limit: 100 });
    },
    enabled: companyId !== null,
  });
}
