import type { EmployeeStatePayload, RuntimeEvent } from '@aics/shared-types';
import { useEffect, useState } from 'react';
import { useAicsRuntime } from './aics-runtime-context';

export interface AgentState {
  name: string;
  role: string;
  state: string;
  taskRunId?: string;
}

/**
 * Subscribes to employee.state.changed events and maintains current state
 * per employee. Seeds initial state from hardcoded Phase 3 employees.
 */
export function useAgentStates(): Map<string, AgentState> {
  const { eventBus } = useAicsRuntime();
  const [agents, setAgents] = useState<Map<string, AgentState>>(() => {
    const m = new Map<string, AgentState>();
    m.set('emp-alice', { name: 'Alice', role: 'engineering_manager', state: 'idle' });
    m.set('emp-bob', { name: 'Bob', role: 'developer', state: 'idle' });
    m.set('emp-carol', { name: 'Carol', role: 'designer', state: 'idle' });
    return m;
  });

  useEffect(() => {
    const unsub = eventBus.on('employee.state.', (event: RuntimeEvent<EmployeeStatePayload>) => {
      const { employeeId, next, taskRunId } = event.payload;
      setAgents((prev) => {
        const next2 = new Map(prev);
        const existing = next2.get(employeeId);
        if (existing) {
          next2.set(employeeId, { ...existing, state: next, taskRunId });
        }
        return next2;
      });
    });
    return unsub;
  }, [eventBus]);

  return agents;
}
