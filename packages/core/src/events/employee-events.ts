/**
 * Employee-related event factories.
 * Extracted from event-factories.ts for domain-scoped modularity.
 */
import type {
  DirectChatCompletedPayload,
  DirectChatStartedPayload,
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeInstalledPayload,
  EmployeeState,
  EmployeeStatePayload,
  EmployeeUpdatedPayload,
  EmployeeVersionCreatedPayload,
  EmployeeWorkstationChangedPayload,
  MemoryAccessedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';

export function employeeStateChanged(
  companyId: string,
  employeeId: string,
  prev: EmployeeState,
  next: EmployeeState,
  threadId?: string,
  taskRunId?: string,
): RuntimeEvent<EmployeeStatePayload> {
  return {
    type: 'employee.state.changed',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, prev, next, taskRunId },
  };
}

export function employeeCreated(
  companyId: string,
  employeeId: string,
  name: string,
  roleSlug: string,
): RuntimeEvent<EmployeeCreatedPayload> {
  return {
    type: 'employee.created',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId, name, roleSlug },
  };
}

export function employeeUpdated(
  companyId: string,
  employeeId: string,
  name: string,
  roleSlug: string,
): RuntimeEvent<EmployeeUpdatedPayload> {
  return {
    type: 'employee.updated',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId, name, roleSlug },
  };
}

export function employeeDeleted(
  companyId: string,
  employeeId: string,
): RuntimeEvent<EmployeeDeletedPayload> {
  return {
    type: 'employee.deleted',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId },
  };
}

export function employeeInstalled(
  companyId: string,
  employeeId: string,
  name: string,
  installTxnId: string,
  packageId: string,
): RuntimeEvent<EmployeeInstalledPayload> {
  return {
    type: 'employee.installed',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId, name, installTxnId, packageId },
  };
}

export function employeeWorkstationChanged(
  companyId: string,
  employeeId: string,
  fromWorkstationId: string | null,
  toWorkstationId: string | null,
): RuntimeEvent<EmployeeWorkstationChangedPayload> {
  return {
    type: 'employee.workstation.changed',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId, fromWorkstationId, toWorkstationId },
  };
}

export function employeeVersionCreated(
  companyId: string,
  employeeId: string,
  versionNum: number,
  changeType: 'create' | 'update' | 'rollback',
): RuntimeEvent<EmployeeVersionCreatedPayload> {
  return {
    type: 'employee.version.created',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId, versionNum, changeType },
  };
}

export function directChatStarted(
  companyId: string,
  employeeId: string,
  employeeName: string,
  threadId: string,
): RuntimeEvent<DirectChatStartedPayload> {
  return {
    type: 'direct.chat.started',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, employeeName, threadId },
  };
}

export function directChatCompleted(
  companyId: string,
  employeeId: string,
  employeeName: string,
  threadId: string,
): RuntimeEvent<DirectChatCompletedPayload> {
  return {
    type: 'direct.chat.completed',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, employeeName, threadId },
  };
}

export function memoryAccessed(
  companyId: string,
  memoryId: string,
  employeeId: string,
  query: string,
  threadId: string,
): RuntimeEvent<MemoryAccessedPayload> {
  return {
    type: 'memory.accessed',
    entityId: memoryId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { memoryId, employeeId, query },
  };
}
