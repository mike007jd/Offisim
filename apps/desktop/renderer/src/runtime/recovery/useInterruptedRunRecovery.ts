import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import {
  type TaskWorkspaceResumeCompatibility,
  type TaskWorkspaceResumeCompatibilityArgs,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import type { AgentRunRepository } from '@offisim/core/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveRunReattachResult } from '../desktop-agent-runtime.js';
import { getRepos } from '../repos.js';
import {
  type InterruptedRunCard,
  type ReconcileInterruptedRunsInput,
  buildInterruptedRunCard,
  reconcileInterruptedRuns,
  resolveAgentRunResumeCompatibilityArgs,
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

type CancelInterruptedRun = (args: {
  historyId: string | null;
  companyId: string;
  projectId: string;
  threadId: string;
  rootRunId: string;
}) => Promise<void>;

export async function discardInterruptedRunRecoveryCard(
  cards: readonly InterruptedRunCard[],
  companyId: string,
  runId: string,
  cancelInterruptedRun: CancelInterruptedRun = (args) =>
    invokeCommand('task_workspace_interrupted_run_cancel', args),
): Promise<InterruptedRunCard[]> {
  const card = cards.find((candidate) => candidate.runId === runId);
  if (!card || card.companyId !== companyId) {
    throw new Error('Interrupted run no longer belongs to the active company.');
  }
  const projectId = card.projectId?.trim();
  const binding = card.workspaceBinding;
  if (!projectId || !card.threadId.trim() || !card.runId.trim()) {
    throw new Error('Interrupted run scope is incomplete and cannot be discarded safely.');
  }
  const historyId =
    binding?.historyId.trim() &&
    binding.companyId === companyId &&
    binding.projectId === projectId &&
    binding.threadId === card.threadId &&
    binding.turnId === card.runId
      ? binding.historyId.trim()
      : null;
  await cancelInterruptedRun({
    historyId,
    companyId,
    projectId,
    threadId: card.threadId,
    rootRunId: card.runId,
  });
  return cards.filter((candidate) => candidate.runId !== runId);
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
  companyId: string;
  now: () => string;
  skipReconcile?: boolean;
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
  companyId: string;
  now: () => string;
  skipReconcile?: boolean;
  checkResumeCompatibility?: (
    args: TaskWorkspaceResumeCompatibilityArgs,
  ) => Promise<TaskWorkspaceResumeCompatibility>;
  bootstrapLiveRuns?: (companyId: string) => Promise<LiveRunReattachResult>;
  onRootInterrupted?: ReconcileInterruptedRunsInput['onRootInterrupted'];
}): Promise<InterruptedRunRecoveryLoad> {
  let bootstrap: LiveRunReattachResult | null = null;
  let bootstrapFailed = false;
  if (input.bootstrapLiveRuns) {
    try {
      bootstrap = await input.bootstrapLiveRuns(input.companyId);
    } catch (error) {
      bootstrapFailed = true;
      console.warn('[useInterruptedRunRecovery] live-run bootstrap failed', {
        companyId: input.companyId,
        error,
      });
    }
  }
  const result =
    input.skipReconcile || bootstrapFailed
      ? { cards: [], failedRootRunIds: bootstrapFailed ? ['live-bootstrap'] : [] }
      : await reconcileInterruptedRuns({
          ...input,
          preserveRootRunIds: bootstrap?.protectedRootRunIds,
          candidateRootRunIds: bootstrap?.confirmedMissingRootRunIds,
        });
  const merged = new Map<string, InterruptedRunCard>(
    result.cards.map((card) => [card.runId, card]),
  );
  const interrupted = await input.repo.findByStatus(input.companyId, ['interrupted']);
  const checkCompatibility = input.checkResumeCompatibility ?? checkResumeCompatibility;
  const compatibilityChecks = await Promise.all(
    interrupted.map(async (row) => {
      const args = resolveAgentRunResumeCompatibilityArgs(row);
      if (!args) {
        return {
          runId: row.run_id,
          compatibility: {
            status: 'missing',
            reason: 'workspace_history_missing',
          } satisfies TaskWorkspaceResumeCompatibility,
          retryableFailure: false,
        };
      }
      try {
        return {
          runId: row.run_id,
          compatibility: await checkCompatibility(args),
          retryableFailure: false,
        };
      } catch {
        return {
          runId: row.run_id,
          compatibility: {
            status: 'missing',
            reason: 'workspace_compatibility_unavailable',
          } satisfies TaskWorkspaceResumeCompatibility,
          retryableFailure: true,
        };
      }
    }),
  );
  const compatibilityByRun = new Map(
    compatibilityChecks.map(({ runId, compatibility }) => [runId, compatibility]),
  );
  for (const row of interrupted) {
    const current = merged.get(row.run_id);
    merged.set(
      row.run_id,
      buildInterruptedRunCard(
        row,
        current?.cancelledChildRunIds ?? [],
        current?.partialUsageJson ?? row.usage_json,
        {
          resumeCompatibility: compatibilityByRun.get(row.run_id),
        },
      ),
    );
  }
  return {
    cards: [...merged.values()],
    complete:
      result.failedRootRunIds.length === 0 &&
      bootstrap?.complete !== false &&
      compatibilityChecks.every((check) => !check.retryableFailure),
  };
}

async function checkResumeCompatibility(
  args: TaskWorkspaceResumeCompatibilityArgs,
): Promise<TaskWorkspaceResumeCompatibility> {
  return invokeCommand('task_workspace_resume_compatibility', args);
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
  const loadRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cards, setCards] = useState<InterruptedRunCard[]>(() =>
    companyId && !skipReconcile ? (cardsByCompany.get(companyId) ?? []) : [],
  );

  const load = useCallback(
    async (force = false) => {
      const generation = loadGeneration.begin();
      const scopeCompanyId = companyId;
      if (!scopeCompanyId) {
        loadGeneration.commit(generation, () => {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
          setCards([]);
        });
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
        const recovery = await loadInterruptedRunRecovery({
          repo: repos.agentRuns,
          companyId: scopeCompanyId,
          now: () => new Date().toISOString(),
          skipReconcile,
          bootstrapLiveRuns: (id) => conversationRunController.bootstrapLiveRuns(id),
          onRootInterrupted: async (root, finishedAt) => {
            let competitiveDraft: { groupId?: unknown; attemptId?: unknown } | null = null;
            try {
              const context = root.runtime_context_json
                ? (JSON.parse(root.runtime_context_json) as Record<string, unknown>)
                : null;
              competitiveDraft =
                context?.competitiveDraft && typeof context.competitiveDraft === 'object'
                  ? (context.competitiveDraft as { groupId?: unknown; attemptId?: unknown })
                  : null;
            } catch {
              competitiveDraft = null;
            }
            const groupId =
              typeof competitiveDraft?.groupId === 'string'
                ? competitiveDraft.groupId.trim()
                : '';
            const attemptId =
              typeof competitiveDraft?.attemptId === 'string'
                ? competitiveDraft.attemptId.trim()
                : '';
            if (!groupId || !attemptId) return;
            await repos.asyncTransact(async (transactionRepos) => {
              const tx = transactionRepos ?? repos;
              const attempt = await tx.competitiveDraftAttempts.findById(attemptId);
              if (!attempt || attempt.group_id !== groupId || attempt.run_id !== root.run_id) {
                throw new Error('Interrupted competitive draft does not match its durable attempt.');
              }
              await tx.competitiveDraftAttempts.update(attemptId, {
                status: 'failed',
                result_summary_json: JSON.stringify({
                  summary: 'The app stopped before this proposal completed.',
                }),
                finished_at: finishedAt,
              });
              const attempts = await tx.competitiveDraftAttempts.listByGroup(groupId);
              const converged = attempts.map((row) =>
                row.attempt_id === attemptId ? { ...row, status: 'failed' as const } : row,
              );
              if (converged.every((row) => row.status !== 'planned' && row.status !== 'running')) {
                const allFailed = converged.every(
                  (row) => row.status === 'failed' || row.status === 'cancelled',
                );
                await tx.competitiveDraftGroups.updateStatus(
                  groupId,
                  allFailed ? 'failed' : 'reviewing',
                  { updatedAt: finishedAt },
                );
              }
            });
          },
        });
        loadGeneration.commit(generation, () => {
          if (recovery.complete) {
            if (!skipReconcile) hydratedByCompany.add(scopeCompanyId);
            else hydratedByCompany.delete(scopeCompanyId);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          } else {
            hydratedByCompany.delete(scopeCompanyId);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              if (currentCompanyIdRef.current === scopeCompanyId) {
                void loadRef.current(true);
              }
            }, 5_000);
          }
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
  loadRef.current = load;

  useEffect(() => {
    void load(false);
    return () => {
      loadGeneration.invalidate();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, [load, loadGeneration]);

  const discard = useCallback(
    async (runId: string) => {
      const scopeCompanyId = companyId;
      if (!scopeCompanyId) return;
      loadGeneration.invalidate();
      const nextCards = await discardInterruptedRunRecoveryCard(
        cardsByCompany.get(scopeCompanyId) ?? cards,
        scopeCompanyId,
        runId,
      );
      cacheCards(scopeCompanyId, nextCards);
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
      if (card.classification !== 'resumable') {
        throw new Error(
          card.classificationReasons.join(' ') ||
            'Interrupted run is incompatible with the current workspace.',
        );
      }
      loadGeneration.invalidate();
      try {
        await conversationRunController.resumeInterruptedRun(scopeCompanyId, runId);
      } catch (error) {
        // The folder can change after card hydration. Re-run backend identity
        // compatibility so the retained card immediately becomes incompatible
        // instead of remaining a stale "resumable" action.
        await load(true);
        throw error;
      }
      const nextCards = removeCard(scopeCompanyId, runId);
      if (currentCompanyIdRef.current === scopeCompanyId) setCards(nextCards);
    },
    [cards, companyId, load, loadGeneration],
  );

  const refetch = useCallback(async () => {
    if (!companyId) return;
    hydratedByCompany.delete(companyId);
    await load(true);
  }, [companyId, load]);

  const scopedCards = companyId ? cards.filter((card) => card.companyId === companyId) : [];
  return { cards: scopedCards, resume, discard, refetch };
}
