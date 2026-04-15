import type { DeliverableCreatedPayload, RoleSlug, RuntimeEvent } from '@offisim/shared-types';
import { useEffect, useState } from 'react';
import { stripLegacySpeakerPrefix } from '../lib/legacy-speaker-prefix';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context';

export interface Deliverable {
  id: string;
  threadId: string;
  title: string;
  content: string;
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
      const { deliverableId, threadId, title, content, contributingEmployees, createdAt } =
        e.payload;
      setDeliverables((prev) => [
        ...prev,
        {
          id: deliverableId,
          threadId,
          title: stripLegacySpeakerPrefix(title),
          content: stripLegacySpeakerPrefix(content),
          contributingEmployees,
          createdAt,
        },
      ]);
    });
    return off;
  }, [eventBus]);

  return deliverables;
}
