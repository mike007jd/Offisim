import type { DeliverableCreatedPayload, RuntimeEvent } from '@aics/shared-types';
import { useEffect, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

export interface Deliverable {
  id: string;
  threadId: string;
  title: string;
  content: string;
  contributingEmployees: ReadonlyArray<{ employeeId: string; employeeName: string }>;
  createdAt: number;
}

export function useDeliverables(): Deliverable[] {
  const { eventBus } = useAicsRuntime();
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);

  useEffect(() => {
    const off = eventBus.on('deliverable.created', (e: RuntimeEvent<DeliverableCreatedPayload>) => {
      const { deliverableId, threadId, title, content, contributingEmployees, createdAt } = e.payload;
      setDeliverables((prev) => [
        ...prev,
        { id: deliverableId, threadId, title, content, contributingEmployees, createdAt },
      ]);
    });
    return off;
  }, [eventBus]);

  return deliverables;
}
