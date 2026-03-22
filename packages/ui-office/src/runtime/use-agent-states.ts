import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeStatePayload,
  EmployeeUpdatedPayload,
  RuntimeEvent,
} from '@aics/shared-types';
import { useEffect, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useAicsRuntime } from './aics-runtime-context';

export interface AgentState {
  name: string;
  role: string;
  state: string;
  taskRunId?: string;
  workstationId?: string | null;
}

/**
 * Subscribes to employee events and maintains current state per employee.
 * Loads initial state from repos when available, then dynamically
 * responds to employee.created / employee.updated / employee.deleted events.
 */
export function useAgentStates(): Map<string, AgentState> {
  const { eventBus, repos } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());

  // Load employees from repos on mount (replaces hardcoded seed)
  useEffect(() => {
    if (!repos || !activeCompanyId) return;
    repos.employees.findByCompany(activeCompanyId).then((rows) => {
      setAgents((prev) => {
        const next = new Map(prev);
        for (const row of rows) {
          if (!next.has(row.employee_id)) {
            next.set(row.employee_id, {
              name: row.name,
              role: row.role_slug,
              state: 'idle',
              workstationId: row.workstation_id ?? null,
            });
          }
        }
        return next;
      });
    });
  }, [repos, activeCompanyId]);

  useEffect(() => {
    // Employee state changes (runtime activity)
    const unsubState = eventBus.on(
      'employee.state.',
      (event: RuntimeEvent<EmployeeStatePayload>) => {
        const { employeeId, next, taskRunId } = event.payload;
        setAgents((prev) => {
          const existing = prev.get(employeeId);
          // Skip update if state unchanged — prevents unnecessary Map recreation
          if (existing && existing.state === next && existing.taskRunId === taskRunId) return prev;
          if (!existing) return prev;
          const next2 = new Map(prev);
          next2.set(employeeId, { ...existing, state: next, taskRunId });
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
          next.set(employeeId, { name, role: roleSlug, state: 'idle', workstationId: null });
          return next;
        });
      },
    );

    // Workstation assignments — update workstationId when employee is assigned/moved
    const unsubWorkstation = eventBus.on(
      'employee.workstation.',
      (event: RuntimeEvent) => {
        const payload = event.payload as any;
        const employeeId = payload?.employeeId;
        const targetWorkstationId = payload?.targetWorkstationId ?? payload?.workstationId;
        if (!employeeId) return;
        setAgents((prev) => {
          const existing = prev.get(employeeId);
          if (!existing) return prev;
          if (existing.workstationId === targetWorkstationId) return prev;
          const next = new Map(prev);
          next.set(employeeId, { ...existing, workstationId: targetWorkstationId });
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
          const existing = prev.get(employeeId);
          // Skip if unchanged — prevents unnecessary Map recreation
          if (existing && existing.name === name && existing.role === roleSlug) return prev;
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(employeeId, { ...existing, name, role: roleSlug });
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
      unsubWorkstation();
    };
  }, [eventBus]);

  return agents;
}
