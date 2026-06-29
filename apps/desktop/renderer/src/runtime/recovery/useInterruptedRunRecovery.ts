import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDesktopAgentRuntime } from '../desktop-agent-runtime.js';
import { getRepos } from '../repos.js';
import {
  type InterruptedRunCard,
  buildInterruptedRunCard,
  reconcileInterruptedRuns,
  resolveAgentRunProjectId,
} from './reconcile-interrupted-runs.js';
import type { AgentRunRepository } from '@offisim/core/browser';
import type { ProjectRepository } from '@offisim/core/browser';

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

export async function loadInterruptedRunRecoveryCards(input: {
  repo: AgentRunRepository;
  projects?: ProjectRepository;
  companyId: string;
  now: () => string;
  skipReconcile?: boolean;
}): Promise<InterruptedRunCard[]> {
  const result = input.skipReconcile
    ? { cards: [] }
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
      projectIds.map(async (projectId) => [projectId, await input.projects?.findById(projectId)] as const),
    ),
  );
  const workspaceExistsByProject = new Map(
    await Promise.all(
      projectIds.map(async (projectId) => [projectId, await checkWorkspaceExists(projectId)] as const),
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
  return [...merged.values()];
}

async function checkWorkspaceExists(projectId: string | null): Promise<boolean | null> {
  if (!projectId) return null;
  try {
    return await invoke<boolean>('project_exists', { path: '.', cwd: null, projectId });
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
  const [cards, setCards] = useState<InterruptedRunCard[]>(() =>
    companyId && !skipReconcile ? (cardsByCompany.get(companyId) ?? []) : [],
  );

  const load = useCallback(
    async (force = false) => {
      if (!companyId) {
        setCards([]);
        return;
      }
      if (!skipReconcile && !force && hydratedByCompany.has(companyId)) {
        setCards(cardsByCompany.get(companyId) ?? []);
        return;
      }
      try {
        const repos = await getRepos();
        if (!repos.agentRuns) {
          cacheCards(companyId, []);
          setCards([]);
          return;
        }
        const loadedCards = await loadInterruptedRunRecoveryCards({
          repo: repos.agentRuns,
          projects: repos.projects,
          companyId,
          now: () => new Date().toISOString(),
          skipReconcile,
        });
        if (!skipReconcile) hydratedByCompany.add(companyId);
        setCards(cacheCards(companyId, loadedCards));
      } catch (err) {
        hydratedByCompany.delete(companyId);
        console.warn('[useInterruptedRunRecovery] recovery hydration failed', { companyId, err });
      }
    },
    [companyId, skipReconcile],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const discard = useCallback(
    async (runId: string) => {
      if (!companyId) return;
      const repos = await getRepos();
      if (!repos.agentRuns) return;
      await repos.agentRuns.updateStatus(runId, 'cancelled', {
        finishedAt: new Date().toISOString(),
      });
      setCards(removeCard(companyId, runId));
    },
    [companyId],
  );

  const resume = useCallback(
    async (runId: string) => {
      if (!companyId) return;
      const runtime = await getDesktopAgentRuntime(companyId);
      await runtime.resume(runId);
      setCards(removeCard(companyId, runId));
    },
    [companyId],
  );

  const refetch = useCallback(async () => {
    if (!companyId) return;
    hydratedByCompany.delete(companyId);
    await load(true);
  }, [companyId, load]);

  return { cards, resume, discard, refetch };
}
