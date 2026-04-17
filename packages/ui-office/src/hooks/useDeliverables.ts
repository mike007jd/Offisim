import type { DeliverableCreatedPayload, RoleSlug, RuntimeEvent } from '@offisim/shared-types';
import { useEffect, useState } from 'react';
import {
  type DeliverableArtifact,
  getDeliverableDisplayTitle,
  resolveDeliverableArtifact,
} from '../lib/deliverable-artifacts';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context';

export interface Deliverable {
  id: string;
  threadId: string;
  title: string;
  content: string;
  contentSize: number;
  artifact: DeliverableArtifact;
  contributingEmployees: ReadonlyArray<{
    employeeId: string;
    employeeName: string;
    sourceKind?: 'employee' | 'department';
    roleSlug: RoleSlug;
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

export function useDeliverables(): Deliverable[] {
  const { eventBus, listRecentDeliverables } = useOffisimRuntime();
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);

  useEffect(() => {
    setDeliverables([]);
    let cancelled = false;

    // Subscribe BEFORE awaiting hydrate so live events that arrive mid-hydrate
    // are captured. `upsertDeliverable` dedups by id regardless of order.
    const off = eventBus.on('deliverable.created', (e: RuntimeEvent<DeliverableCreatedPayload>) => {
      const { deliverableId, threadId, title, contributingEmployees, createdAt } = e.payload;
      const artifact = resolveDeliverableArtifact(e.payload);
      const row: Deliverable = {
        id: deliverableId,
        threadId,
        title: getDeliverableDisplayTitle(title, artifact),
        content: artifact.content,
        contentSize: artifact.content.length,
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

  return deliverables;
}
