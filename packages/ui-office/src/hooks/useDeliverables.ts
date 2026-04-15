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
  artifact: DeliverableArtifact;
  contributingEmployees: ReadonlyArray<{
    employeeId: string;
    employeeName: string;
    roleSlug: RoleSlug;
  }>;
  createdAt: number;
}

export function useDeliverables(): Deliverable[] {
  const { eventBus } = useOffisimRuntime();
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);

  useEffect(() => {
    // Clear stale deliverables when eventBus changes (runtime reinit)
    setDeliverables([]);
    const off = eventBus.on('deliverable.created', (e: RuntimeEvent<DeliverableCreatedPayload>) => {
      const { deliverableId, threadId, title, contributingEmployees, createdAt } = e.payload;
      const artifact = resolveDeliverableArtifact(e.payload);
      setDeliverables((prev) => [
        ...prev.filter(
          (existing) =>
            !(
              existing.threadId === threadId &&
              existing.artifact.kind === artifact.kind &&
              existing.artifact.fileName === artifact.fileName &&
              existing.artifact.content === artifact.content
            ),
        ),
        {
          id: deliverableId,
          threadId,
          title: getDeliverableDisplayTitle(title, artifact),
          content: artifact.content,
          artifact,
          contributingEmployees,
          createdAt,
        },
      ]);
    });
    return off;
  }, [eventBus]);

  return deliverables;
}
