import { reposOrNull } from '@/data/adapters.js';
import {
  type LoopService,
  type LoopServiceRepos,
  type RuntimeRepositories,
  createLoopService,
  generateId,
} from '@offisim/core/browser';
import type { LoopDefinition, LoopRevision } from '@offisim/shared-types';
import { useQuery } from '@tanstack/react-query';

/**
 * Renderer data layer over the Loop domain (PR-07 service). PR-10 needs the read
 * paths (list loops for the `/loop` picker, get a revision to validate "ready" at
 * insert + Send). The single writer of loop_invocations lives in the send-time
 * materializer, not here. Mirrors missions.ts: `reposOrNull()` is the one door to
 * the SQLite-backed repos; browser preview returns empty (loops are a
 * real-backend-only surface). The LoopService model is INJECTED only on save — the
 * read paths and `getRevision` PR-10 uses never compile, so no model is needed.
 */

function loopServiceRepos(repos: RuntimeRepositories): LoopServiceRepos | null {
  const { loopDefinitions, loopRevisions, loopSkillBindings, loopInvocations } = repos;
  if (!loopDefinitions || !loopRevisions || !loopSkillBindings || !loopInvocations) return null;
  return { loopDefinitions, loopRevisions, loopSkillBindings, loopInvocations };
}

/** Build the Loop service over the live repos, or throw if unavailable (desktop-only). */
export function buildLoopService(repos: RuntimeRepositories): LoopService {
  const subset = loopServiceRepos(repos);
  if (!subset) throw new Error('Loop repositories are unavailable in this runtime.');
  return createLoopService(subset, {
    now: () => new Date().toISOString(),
    newId: () => generateId('loop'),
  });
}

export const loopKeys = {
  list: (companyId: string | null) => ['loops', companyId] as const,
  detail: (loopId: string | null) => ['loop', loopId] as const,
  revision: (revisionId: string | null) => ['loop-revision', revisionId] as const,
};

/** All loops for a company — feeds the `/loop` searchable picker. */
export function useLoops(companyId: string | null) {
  return useQuery<LoopDefinition[]>({
    queryKey: loopKeys.list(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const repos = await reposOrNull();
      if (!repos) return [];
      const subset = loopServiceRepos(repos);
      if (!subset) return [];
      return buildLoopService(repos).listLoops(companyId, { limit: 200 });
    },
    enabled: companyId !== null,
  });
}

/** Read a single revision (used to surface a `vN+1 available` badge on a chip). */
export async function getLoopRevision(revisionId: string): Promise<LoopRevision | null> {
  const repos = await reposOrNull();
  if (!repos) return null;
  const subset = loopServiceRepos(repos);
  if (!subset) return null;
  try {
    return await buildLoopService(repos).getRevision(revisionId);
  } catch {
    return null;
  }
}

/** Read a loop definition (for its current revision id — the "newer available" check). */
export async function getLoopDefinition(loopId: string): Promise<LoopDefinition | null> {
  const repos = await reposOrNull();
  if (!repos) return null;
  const subset = loopServiceRepos(repos);
  if (!subset) return null;
  try {
    return await buildLoopService(repos).getLoop(loopId);
  } catch {
    return null;
  }
}
