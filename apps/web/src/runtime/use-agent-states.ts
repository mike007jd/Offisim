import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeStatePayload,
  EmployeeUpdatedPayload,
  RuntimeEvent,
} from '@aics/shared-types';
import { useEffect, useState } from 'react';
import { COMPANY_ID } from '../lib/constants';
import { useAicsRuntime } from './aics-runtime-context';

export interface AgentState {
  name: string;
  role: string;
  state: string;
  taskRunId?: string;
}

/**
 * Subscribes to employee events and maintains current state per employee.
 * Loads initial state from repos when available, then dynamically
 * responds to employee.created / employee.updated / employee.deleted events.
 */
export function useAgentStates(): Map<string, AgentState> {
  const { eventBus, repos } = useAicsRuntime();
  const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());

  // Load employees from repos on mount (replaces hardcoded seed)
  useEffect(() => {
    if (!repos) return;
    repos.employees.findByCompany(COMPANY_ID).then((rows) => {
      setAgents((prev) => {
        const next = new Map(prev);
        for (const row of rows) {
          if (!next.has(row.employee_id)) {
            next.set(row.employee_id, {
              name: row.name,
              role: row.role_slug,
              state: 'idle',
            });
          }
        }
        return next;
      });
    });
  }, [repos]);

  useEffect(() => {
    // Employee state changes (runtime activity)
    const unsubState = eventBus.on(
      'employee.state.',
      (event: RuntimeEvent<EmployeeStatePayload>) => {
        const { employeeId, next, taskRunId } = event.payload;
        setAgents((prev) => {
          const next2 = new Map(prev);
          const existing = next2.get(employeeId);
          if (existing) {
            next2.set(employeeId, { ...existing, state: next, taskRunId });
          }
          return next2;
        });
      },
    );

    // Employee created — add new entry with idle state
    const unsubCreated = eventBus.on(
      'employee.created',
      (event: RuntimeEvent<EmployeeCreatedPayload>) => {
        const { employeeId, name, roleSlug } = event.payload;
        setAgents((prev) => {
          const next = new Map(prev);
          next.set(employeeId, { name, role: roleSlug, state: 'idle' });
          return next;
        });
      },
    );

    // Employee updated — update name/role, keep current state
    const unsubUpdated = eventBus.on(
      'employee.updated',
      (event: RuntimeEvent<EmployeeUpdatedPayload>) => {
        const { employeeId, name, roleSlug } = event.payload;
        setAgents((prev) => {
          const next = new Map(prev);
          const existing = next.get(employeeId);
          if (existing) {
            next.set(employeeId, { ...existing, name, role: roleSlug });
          }
          return next;
        });
      },
    );

    // Employee deleted — remove entry
    const unsubDeleted = eventBus.on(
      'employee.deleted',
      (event: RuntimeEvent<EmployeeDeletedPayload>) => {
        const { employeeId } = event.payload;
        setAgents((prev) => {
          const next = new Map(prev);
          next.delete(employeeId);
          return next;
        });
      },
    );

    return () => {
      unsubState();
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
    };
  }, [eventBus]);

  return agents;
}
