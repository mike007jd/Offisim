import { WorkstationAssignmentService } from '@aics/core/browser';
import { useEffect, useState } from 'react';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';

/**
 * Scene integration hook — wires EventBus listeners for selection sync
 * and workstation assignment persistence. No PixiJS dependency.
 *
 * 3D/2D views get employee data independently via useAgentStates().
 */
export function useScene(_reducedMotion = false) {
  const { eventBus, repos } = useAicsRuntime();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  // Listen for scene-initiated selection events and sync to React state.
  // This is the scene→DOM direction of the bidirectional sync bridge.
  useEffect(() => {
    if (!eventBus) return;
    const unsub = eventBus.on('ui.selection.changed', (event) => {
      const payload = event.payload as { entityId: string | null; source: string };
      if (payload.source === 'scene') {
        setSelectedEmployeeId(payload.entityId);
      }
    });
    return unsub;
  }, [eventBus]);

  // Wire drag-drop to WorkstationAssignmentService for persistence.
  // The renderer emits 'employee.workstation.drop-requested' on successful drops;
  // this effect listens and calls the service to persist the assignment to DB.
  useEffect(() => {
    if (!eventBus || !repos) return;
    const service = new WorkstationAssignmentService(repos.employees, eventBus);
    const unsub = eventBus.on(
      'employee.workstation.drop-requested',
      (event) => {
        const payload = event.payload as {
          employeeId: string;
          targetWorkstationId: string | null;
        };
        service
          .assignToWorkstation(payload.employeeId, payload.targetWorkstationId)
          .catch((err) => {
            console.error('[useScene] workstation assignment failed:', err);
          });
      },
    );
    return unsub;
  }, [eventBus, repos]);

  return { selectedEmployeeId };
}
