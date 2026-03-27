import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeStatePayload,
  EmployeeUpdatedPayload,
  EmployeeWorkstationChangedPayload,
  EmployeeWorkstationDropRequestedPayload,
  RuntimeEvent,
  TaskAssignmentDispatchedPayload,
  TaskSubtaskProgressPayload,
} from '@aics/shared-types';
import { useEffect, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useAicsRuntime } from './aics-runtime-context';

export interface AgentTaskInfo {
  stepLabel: string;
  stepIndex: number;
  totalSteps: number;
}

export interface SubTaskInfo {
  stepIndex: number;
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  startedAt?: number;
}

export interface AgentState {
  name: string;
  role: string;
  state: string;
  taskRunId?: string;
  workstationId?: string | null;
  /** Current task assignment from step dispatcher. */
  currentTask?: AgentTaskInfo | null;
  /** Sub-task progress list for parallel task tracking. */
  subTasks?: SubTaskInfo[];
}

type WorkstationEventPayload =
  | EmployeeWorkstationChangedPayload
  | EmployeeWorkstationDropRequestedPayload;

function buildAgentStateMap(
  companyId: string | null,
  employees: Array<{
    employee_id: string;
    company_id: string;
    name: string;
    role_slug: string;
    workstation_id: string | null;
  }>,
  prev?: Map<string, AgentState>,
): Map<string, AgentState> {
  if (!companyId) return new Map();

  const next = new Map<string, AgentState>();
  for (const row of employees) {
    if (row.company_id !== companyId) continue;
    const previous = prev?.get(row.employee_id);
    next.set(row.employee_id, {
      name: row.name,
      role: row.role_slug ?? 'developer',
      state: previous?.state ?? 'idle',
      taskRunId: previous?.taskRunId,
      workstationId: row.workstation_id ?? previous?.workstationId ?? null,
      currentTask: previous?.currentTask ?? null,
      subTasks: previous?.subTasks,
    });
  }
  return next;
}

/**
 * Subscribes to employee events and maintains current state per employee.
 * Loads initial state from repos when available, then dynamically
 * responds to employee.created / employee.updated / employee.deleted events.
 */
export function useAgentStates(): Map<string, AgentState> {
  const { eventBus, repos, bootstrapState } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const [agents, setAgents] = useState<Map<string, AgentState>>(() =>
    buildAgentStateMap(activeCompanyId, bootstrapState?.reposSnapshot?.employees ?? []),
  );

  useEffect(() => {
    const bootstrapEmployees = bootstrapState?.reposSnapshot?.employees ?? [];
    setAgents((prev) => buildAgentStateMap(activeCompanyId, bootstrapEmployees, prev));

    if (!repos || !activeCompanyId) return;
    repos.employees.findByCompany(activeCompanyId).then((rows) => {
      setAgents((prev) => {
        return buildAgentStateMap(activeCompanyId, rows, prev);
      });
    });
  }, [repos, activeCompanyId, bootstrapState]);

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
          // Clear currentTask and subTasks when employee returns to idle
          const currentTask = next === 'idle' ? null : existing.currentTask;
          const subTasks = next === 'idle' ? undefined : existing.subTasks;
          next2.set(employeeId, { ...existing, state: next, taskRunId, currentTask, subTasks });
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
          next.set(employeeId, {
            name,
            role: roleSlug ?? 'developer',
            state: 'idle',
            workstationId: null,
          });
          return next;
        });
      },
    );

    // Workstation assignments — update workstationId when employee is assigned/moved
    const unsubWorkstation = eventBus.on(
      'employee.workstation.',
      (event: RuntimeEvent<WorkstationEventPayload>) => {
        const { employeeId } = event.payload;
        const targetWorkstationId =
          'toWorkstationId' in event.payload
            ? event.payload.toWorkstationId
            : event.payload.targetWorkstationId;

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

    // Task dispatched — update currentTask info for scene choreography
    const unsubDispatched = eventBus.on(
      'task.assignment.dispatched',
      (event: RuntimeEvent<TaskAssignmentDispatchedPayload>) => {
        const { employeeId, stepLabel, stepIndex, totalSteps } = event.payload;
        setAgents((prev) => {
          const existing = prev.get(employeeId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(employeeId, {
            ...existing,
            currentTask: { stepLabel, stepIndex, totalSteps },
          });
          return next;
        });
      },
    );

    // Subtask progress — build up sub-task list per employee
    const unsubSubtask = eventBus.on(
      'task.subtask.progress',
      (event: RuntimeEvent<TaskSubtaskProgressPayload>) => {
        const { employeeId, stepIndex, label, status } = event.payload;
        setAgents((prev) => {
          const existing = prev.get(employeeId);
          if (!existing) return prev;
          const subTasks = [...(existing.subTasks ?? [])];
          const idx = subTasks.findIndex((s) => s.stepIndex === stepIndex);
          const entry: SubTaskInfo = {
            stepIndex,
            label,
            status,
            startedAt: status === 'running' ? Date.now() : subTasks[idx]?.startedAt,
          };
          if (idx >= 0) {
            subTasks[idx] = entry;
          } else {
            subTasks.push(entry);
          }
          const next = new Map(prev);
          next.set(employeeId, { ...existing, subTasks });
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
      unsubDispatched();
      unsubSubtask();
    };
  }, [eventBus]);

  return agents;
}
