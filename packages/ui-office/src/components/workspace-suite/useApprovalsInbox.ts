import type { InteractionActiveRow, InteractionHistoryRow } from '@offisim/core/browser';
import type { InteractionKind, InteractionRequest } from '@offisim/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';

/** Pending approval queue entry, derived from `active_thread_interactions`. */
export interface PendingApproval {
  readonly interactionId: string;
  readonly threadId: string;
  readonly kind: InteractionKind;
  readonly request: InteractionRequest;
  readonly createdAt: string;
}

/** Resolved approval, derived from `interaction_history`. */
export interface ResolvedApproval {
  readonly historyId: string;
  readonly interactionId: string;
  readonly threadId: string;
  readonly kind: InteractionKind;
  readonly status: string;
  readonly selectedOptionId: string | null;
  readonly freeformResponse: string | null;
  readonly request: InteractionRequest;
  readonly resolvedAt: string;
}

export interface ApprovalsInbox {
  readonly pending: readonly PendingApproval[];
  readonly resolved: readonly ResolvedApproval[];
  readonly loading: boolean;
  readonly refresh: () => void;
}

function safeParseRequest(json: string): InteractionRequest | null {
  try {
    const parsed = JSON.parse(json) as InteractionRequest;
    if (parsed && typeof parsed.interactionId === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function pendingFromRow(row: InteractionActiveRow): PendingApproval | null {
  const request = safeParseRequest(row.request_json);
  if (!request) return null;
  return {
    interactionId: row.interaction_id,
    threadId: row.thread_id,
    kind: row.kind,
    request,
    createdAt: row.created_at,
  };
}

function resolvedFromRow(row: InteractionHistoryRow): ResolvedApproval | null {
  const request = safeParseRequest(row.request_json);
  if (!request) return null;
  return {
    historyId: row.history_id,
    interactionId: row.interaction_id,
    threadId: row.thread_id,
    kind: row.kind,
    status: row.status,
    selectedOptionId: row.selected_option_id,
    freeformResponse: row.freeform_response,
    request,
    resolvedAt: row.resolved_at,
  };
}

const HISTORY_PER_THREAD = 25;

/**
 * Cross-thread approvals queue, read-only, fanned out over the company's graph
 * threads. `active_thread_interactions` is keyed per graph thread (no
 * company-wide listing exists), so we enumerate the company's graph threads via
 * `graphThreads.findByCompany` and gather each thread's pending + resolved
 * interactions. No new table, no engine change — pure read consumption.
 *
 * Live refresh: subscribes to `interaction.requested` / `interaction.resolved`
 * event prefixes so the inbox stays current as gates open and close.
 */
export function useApprovalsInbox(companyId: string | null): ApprovalsInbox {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const [pending, setPending] = useState<readonly PendingApproval[]>([]);
  const [resolved, setResolved] = useState<readonly ResolvedApproval[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!repos?.threads || !repos.activeInteractions || !repos.interactionHistory) {
      setPending([]);
      setResolved([]);
      return;
    }
    if (!companyId) {
      setPending([]);
      setResolved([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const threads = await repos.threads.findByCompany(companyId);
        const threadIds = threads.map((t) => t.thread_id);

        const activeRows = await Promise.all(
          threadIds.map((threadId) => repos.activeInteractions.findByThread(threadId)),
        );
        const historyRows = await Promise.all(
          threadIds.map((threadId) =>
            repos.interactionHistory.listByThread(threadId, { limit: HISTORY_PER_THREAD }),
          ),
        );
        if (cancelled) return;

        const nextPending: PendingApproval[] = [];
        for (const row of activeRows) {
          if (!row) continue;
          const entry = pendingFromRow(row);
          if (entry) nextPending.push(entry);
        }
        nextPending.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const nextResolved: ResolvedApproval[] = [];
        for (const rows of historyRows) {
          for (const row of rows) {
            const entry = resolvedFromRow(row);
            if (entry) nextResolved.push(entry);
          }
        }
        nextResolved.sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));

        setPending(nextPending);
        setResolved(nextResolved);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repos, companyId]);

  useEffect(() => {
    const dispose = refresh();
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, [refresh]);

  useEffect(() => {
    const offRequested = eventBus.on('interaction.requested', () => refresh());
    const offResolved = eventBus.on('interaction.resolved', () => refresh());
    return () => {
      offRequested();
      offResolved();
    };
  }, [eventBus, refresh]);

  return { pending, resolved, loading, refresh };
}
