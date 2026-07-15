import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import type { AgentRunRepository } from '@offisim/core/browser';
import type { ProjectRepository } from '@offisim/core/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getRepos } from '../repos.js';
import {
  type InterruptedRunCard,
  buildInterruptedRunCard,
  reconcileInterruptedRuns,
  resolveAgentRunProjectId,
} from './reconcile-interrupted-runs.js';

const hydratedByCompany = new Set<string>();
const cardsByCompany = new Map<string, InterruptedRunCard[]>();

function cacheCards(companyId: string, cards: InterruptedRunCard[]): InterruptedRunCard[] {
  cardsByCompany.set(companyId, cards);
  return cards;
}

function removeCard(companyId: string, runId: string): InterruptedRunCard[] {
  const next = (cardsByCompany.get(companyId) ?? []).filter((card) => card.runId !== runId);
  cardsByCompany.set(companyId, next);
  return next;
}

/**
 * Monotonic scope token for recovery loads. A slower request may finish after a
 * company switch or refetch, but only the latest token may publish state/cache.
 */
export class RecoveryLoadGeneration {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  invalidate(): void {
    this.current += 1;
  }

  commit(generation: number, operation: () => void): boolean {
    if (generation !== this.current) return false;
    operation();
    return true;
  }
}

export async function loadInterruptedRunRecoveryCards(input: {
  repo: AgentRunRepository;
  projects?: ProjectRepository;
  companyId: string;
  now: () => string;
  skipReconcile?: boolean;
  liveRootRunIds?: ReadonlySet<string>;
}): Promise<InterruptedRunCard[]> {
  return (await loadInterruptedRunRecovery(input)).cards;
}

export interface InterruptedRunRecoveryLoad {
  cards: InterruptedRunCard[];
  /** False when at least one root failed reconciliation; callers must retry. */
  complete: boolean;
}

export async function loadInterruptedRunRecovery(input: {
  repo: AgentRunRepository;
  projects?: ProjectRepository;
  companyId: string;
  now: () => string;
  skipReconcile?: boolean;
  liveRootRunIds?: ReadonlySet<string>;
}): Promise<InterruptedRunRecoveryLoad> {
  const result = input.skipReconcile
    ? { cards: [], failedRootRunIds: [] }
    : await reconcileInterruptedRuns(input);
  const merged = new Map<string, InterruptedRunCard>(
    result.cards.map((card) => [card.runId, card]),
  );
  const interrupted = await input.repo.findByStatus(input.companyId, ['interrupted']);
  const projectIds = [
    ...new Set(interrupted.map((row) => resolveAgentRunProjectId(row)).filter(Boolean)),
  ] as string[];
  const projectsById = new Map(
    await Promise.all(
      projectIds.map(
        async (projectId) => [projectId, await input.projects?.findById(projectId)] as const,
      ),
    ),
  );
  const workspaceExistsByProject = new Map(
    await Promise.all(
      projectIds.map(
        async (projectId) => [projectId, await checkWorkspaceExists(projectId)] as const,
      ),
    ),
  );
  for (const row of interrupted) {
    const current = merged.get(row.run_id);
    const projectId = resolveAgentRunProjectId(row);
    const project = projectId ? projectsById.get(projectId) : null;
    merged.set(
      row.run_id,
      buildInterruptedRunCard(
        row,
        current?.cancelledChildRunIds ?? [],
        current?.partialUsageJson ?? row.usage_json,
        {
          resolvedWorkspaceRoot: project?.workspace_root ?? null,
          workspaceExists: projectId ? (workspaceExistsByProject.get(projectId) ?? null) : null,
        },
      ),
    );
  }
  return {
    cards: [...merged.values()],
    complete: result.failedRootRunIds.length === 0,
  };
}

async function checkWorkspaceExists(projectId: string | null): Promise<boolean | null> {
  if (!projectId) return null;
  try {
    return await invokeCommand('project_exists', { path: '.', cwd: null, projectId });
  } catch {
    return null;
  }
}

export function useInterruptedRunRecovery(companyId: string | null): {
  cards: InterruptedRunCard[];
  resume: (runId: string) => Promise<void>;
  discard: (runId: string) => Promise<void>;
  refetch: () => Promise<void>;
};
export function useInterruptedRunRecovery(
  companyId: string | null,
  options: { skipReconcile?: boolean },
): {
  cards: InterruptedRunCard[];
  resume: (runId: string) => Promise<void>;
  discard: (runId: string) => Promise<void>;
  refetch: () => Promise<void>;
};
export function useInterruptedRunRecovery(
  companyId: string | null,
  options: { skipReconcile?: boolean } = {},
): {
  cards: InterruptedRunCard[];
  resume: (runId: string) => Promise<void>;
  discard: (runId: string) => Promise<void>;
  refetch: () => Promise<void>;
} {
  const skipReconcile = options.skipReconcile === true;
  const [loadGeneration] = useState(() => new RecoveryLoadGeneration());
  const currentCompanyIdRef = useRef(companyId);
  currentCompanyIdRef.current = companyId;
  const [cards, setCards] = useState<InterruptedRunCard[]>(() =>
    companyId && !skipReconcile ? (cardsByCompany.get(companyId) ?? []) : [],
  );

  const load = useCallback(
    async (force = false) => {
      const generation = loadGeneration.begin();
      const scopeCompanyId = companyId;
      if (!scopeCompanyId) {
        loadGeneration.commit(generation, () => setCards([]));
        return;
      }
      if (!skipReconcile && !force && hydratedByCompany.has(scopeCompanyId)) {
        loadGeneration.commit(generation, () => {
          setCards(cardsByCompany.get(scopeCompanyId) ?? []);
        });
        return;
      }
      try {
        const repos = await getRepos();
        const liveRootRunIds = skipReconcile
          ? new Set<string>()
          : await conversationRunController.hydrateRuntimeState(scopeCompanyId);
        const recovery = await loadInterruptedRunRecovery({
          repo: repos.agentRuns,
          projects: repos.projects,
          companyId: scopeCompanyId,
          now: () => new Date().toISOString(),
          skipReconcile,
          liveRootRunIds,
        });
        loadGeneration.commit(generation, () => {
          if (!skipReconcile && recovery.complete) hydratedByCompany.add(scopeCompanyId);
          else hydratedByCompany.delete(scopeCompanyId);
          setCards(cacheCards(scopeCompanyId, recovery.cards));
        });
      } catch (err) {
        loadGeneration.commit(generation, () => {
          hydratedByCompany.delete(scopeCompanyId);
          console.warn('[useInterruptedRunRecovery] recovery hydration failed', {
            companyId: scopeCompanyId,
            err,
          });
        });
      }
    },
    [companyId, loadGeneration, skipReconcile],
  );

  useEffect(() => {
    void load(false);
    return () => loadGeneration.invalidate();
  }, [load, loadGeneration]);

  const discard = useCallback(
    async (runId: string) => {
      const scopeCompanyId = companyId;
      if (!scopeCompanyId) return;
      const card = cards.find((candidate) => candidate.runId === runId);
      if (!card || card.companyId !== scopeCompanyId) {
        throw new Error('Interrupted run no longer belongs to the active company.');
      }
      loadGeneration.invalidate();
      const repos = await getRepos();
      const updated = await repos.agentRuns.updateStatusForCompany(
        scopeCompanyId,
        runId,
        'cancelled',
        {
          finishedAt: new Date().toISOString(),
        },
      );
      if (!updated) {
        throw new Error('Interrupted run no longer belongs to the active company.');
      }
      const nextCards = removeCard(scopeCompanyId, runId);
      if (currentCompanyIdRef.current === scopeCompanyId) setCards(nextCards);
    },
    [cards, companyId, loadGeneration],
  );

  const resume = useCallback(
    async (runId: string) => {
      const scopeCompanyId = companyId;
      if (!scopeCompanyId) return;
      const card = cards.find((candidate) => candidate.runId === runId);
      if (!card || card.companyId !== scopeCompanyId) {
        throw new Error('Interrupted run no longer belongs to the active company.');
      }
      loadGeneration.invalidate();
      await conversationRunController.resumeInterrupted(scopeCompanyId, runId);
      const nextCards = removeCard(scopeCompanyId, runId);
      if (currentCompanyIdRef.current === scopeCompanyId) setCards(nextCards);
    },
    [cards, companyId, loadGeneration],
  );

  const refetch = useCallback(async () => {
    if (!companyId) return;
    hydratedByCompany.delete(companyId);
    await load(true);
  }, [companyId, load]);

  const scopedCards = companyId ? cards.filter((card) => card.companyId === companyId) : [];
  return { cards: scopedCards, resume, discard, refetch };
}
