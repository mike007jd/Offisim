import { useCallback, useEffect, useState } from 'react';
import { getDesktopAgentRuntime } from '../desktop-agent-runtime.js';
import { getRepos } from '../repos.js';
import {
  type InterruptedRunCard,
  buildInterruptedRunCard,
  reconcileInterruptedRuns,
} from './reconcile-interrupted-runs.js';
import type { AgentRunRepository } from '@offisim/core/browser';

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
  companyId: string;
  now: () => string;
}): Promise<InterruptedRunCard[]> {
  const result = await reconcileInterruptedRuns(input);
  const merged = new Map<string, InterruptedRunCard>(
    result.cards.map((card) => [card.runId, card]),
  );
  const interrupted = await input.repo.findByStatus(input.companyId, ['interrupted']);
  for (const row of interrupted) {
    if (!merged.has(row.run_id)) {
      merged.set(row.run_id, buildInterruptedRunCard(row, [], row.usage_json));
    }
  }
  return [...merged.values()];
}

export function useInterruptedRunRecovery(companyId: string | null): {
  cards: InterruptedRunCard[];
  resume: (runId: string) => Promise<void>;
  discard: (runId: string) => Promise<void>;
  refetch: () => Promise<void>;
} {
  const [cards, setCards] = useState<InterruptedRunCard[]>(() =>
    companyId ? (cardsByCompany.get(companyId) ?? []) : [],
  );

  const load = useCallback(
    async (force = false) => {
      if (!companyId) {
        setCards([]);
        return;
      }
      if (!force && hydratedByCompany.has(companyId)) {
        setCards(cardsByCompany.get(companyId) ?? []);
        return;
      }
      hydratedByCompany.add(companyId);
      try {
        const repos = await getRepos();
        if (!repos.agentRuns) {
          cacheCards(companyId, []);
          setCards([]);
          return;
        }
        const loadedCards = await loadInterruptedRunRecoveryCards({
          repo: repos.agentRuns,
          companyId,
          now: () => new Date().toISOString(),
        });
        setCards(cacheCards(companyId, loadedCards));
      } catch (err) {
        hydratedByCompany.delete(companyId);
        console.warn('[useInterruptedRunRecovery] recovery hydration failed', { companyId, err });
      }
    },
    [companyId],
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
