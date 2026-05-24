import type { DeliverableCreatedPayload, RoleSlug, RuntimeEvent } from '@offisim/shared-types';
import { useEffect, useMemo, useState } from 'react';
import {
  type DeliverableArtifact,
  getDeliverableDisplayTitle,
  isDisplayableDeliverable,
  resolveDeliverableArtifact,
} from '../lib/deliverable-artifacts';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context';

export interface Deliverable {
  id: string;
  /** Runtime graph_threads.thread_id (conversationKey shape for chat-driven runs). */
  threadId: string;
  /**
   * Product-layer chat_threads.thread_id; null when the deliverable was
   * produced outside a chat run (background_sync, install_flow). Right-rail
   * consumers filter by this; the dashboard/pitch-hall company-wide views
   * pass `null` to bypass the filter.
   */
  chatThreadId: string | null;
  title: string;
  content: string;
  contentSize: number;
  declaredKind: DeliverableArtifact['kind'] | null;
  artifact: DeliverableArtifact;
  contributingEmployees: ReadonlyArray<{
    employeeId: string;
    employeeName: string;
    sourceKind?: 'employee';
    roleSlug: RoleSlug;
    isExternal: boolean;
    brandKey: string | null;
  }>;
  createdAt: number;
}

function fallbackDedupeKey(d: Pick<Deliverable, 'threadId' | 'artifact'>): string {
  return `${d.threadId}|${d.artifact.kind}|${d.artifact.fileName ?? ''}|${d.artifact.content}`;
}

/**
 * Merge a new deliverable into an existing list with id-first dedup, falling
 * back to the legacy `(threadId + kind + fileName + content)` tuple only when
 * `id` is missing. Newest-first ordering is preserved by `createdAt`.
 */
function upsertDeliverable(list: Deliverable[], next: Deliverable): Deliverable[] {
  const byId = next.id
    ? list.filter((existing) => existing.id !== next.id)
    : list.filter((existing) => fallbackDedupeKey(existing) !== fallbackDedupeKey(next));
  const merged = [...byId, next];
  merged.sort((a, b) => b.createdAt - a.createdAt);
  return merged;
}

/**
 * Subscribe to deliverable events for the active company.
 *
 * @param filterChatThreadId — when a chat thread is active, scope the result
 *   to deliverables that originated from that thread (`chatThreadId` matches).
 *   Pass `null`/`undefined` for company-wide views (Activity Log,
 *   PitchHall in cross-thread mode) to receive every deliverable.
 */
export function useDeliverables(filterChatThreadId?: string | null): Deliverable[] {
  const { eventBus, listRecentDeliverables } = useOffisimRuntimeServices();
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);

  useEffect(() => {
    setDeliverables([]);
    let cancelled = false;

    // Subscribe BEFORE awaiting hydrate so live events that arrive mid-hydrate
    // are captured. `upsertDeliverable` dedups by id regardless of order.
    const off = eventBus.on('deliverable.created', (e: RuntimeEvent<DeliverableCreatedPayload>) => {
      const { deliverableId, threadId, chatThreadId, title, contributingEmployees, createdAt } =
        e.payload;
      const artifact = resolveDeliverableArtifact(e.payload);
      if (!isDisplayableDeliverable(e.payload, artifact)) return;
      const row: Deliverable = {
        id: deliverableId,
        threadId,
        chatThreadId: chatThreadId ?? null,
        title: getDeliverableDisplayTitle(title, artifact),
        content: artifact.content,
        contentSize: artifact.content.length,
        declaredKind: e.payload.kind ?? null,
        artifact,
        contributingEmployees,
        createdAt,
      };
      setDeliverables((prev) => upsertDeliverable(prev, row));
    });

    if (listRecentDeliverables) {
      void listRecentDeliverables({ limit: 100 }).then((history) => {
        if (cancelled) return;
        setDeliverables((prev) => {
          const map = new Map(prev.map((d) => [d.id, d] as const));
          for (const row of history) {
            if (
              !isDisplayableDeliverable(
                {
                  kind: row.declaredKind ?? undefined,
                  fileName: row.artifact.fileName,
                  mimeType: row.artifact.mimeType,
                },
                row.artifact,
              )
            ) {
              continue;
            }
            if (!map.has(row.id)) map.set(row.id, row);
          }
          return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
        });
      });
    }

    return () => {
      cancelled = true;
      off();
    };
  }, [eventBus, listRecentDeliverables]);

  return useMemo(() => {
    if (filterChatThreadId == null) return deliverables;
    return deliverables.filter(
      (d) => d.chatThreadId === filterChatThreadId || d.threadId === filterChatThreadId,
    );
  }, [deliverables, filterChatThreadId]);
}
