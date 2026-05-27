import type { RoleSlug } from '../roles.js';
import type { EmployeeState } from '../states.js';

export interface EmployeeStatePayload {
  readonly employeeId: string;
  readonly prev: EmployeeState;
  readonly next: EmployeeState;
  readonly taskRunId?: string;
}

export interface EmployeeCreatedPayload {
  readonly employeeId: string;
  readonly name: string;
  readonly roleSlug: RoleSlug;
}

export interface EmployeeUpdatedPayload {
  readonly employeeId: string;
  readonly name: string;
  readonly roleSlug: RoleSlug;
}

export interface EmployeeDeletedPayload {
  readonly employeeId: string;
}

export interface EmployeeInstalledPayload {
  readonly employeeId: string;
  readonly name: string;
  readonly installTxnId: string;
  readonly packageId: string;
}

export interface EmployeeWorkstationChangedPayload {
  readonly employeeId: string;
  readonly fromWorkstationId: string | null;
  readonly toWorkstationId: string | null;
}

export interface EmployeeWorkstationDropRequestedPayload {
  readonly employeeId: string;
  readonly targetWorkstationId: string;
}

export interface EmployeeVersionCreatedPayload {
  readonly employeeId: string;
  readonly versionNum: number;
  readonly changeType: 'create' | 'update' | 'rollback';
}

export interface BossEmployeeContextEmptyPayload {
  readonly companyId: string;
  readonly employeeCount: number;
  readonly expectedAtLeast: 1;
}

export interface BossRosterDivergencePayload {
  readonly path: 'team-chat' | 'direct-chat' | 'yolo-chat' | 'human-in-loop';
  readonly railEmployeeCount: number;
  readonly assembledRosterCount: number;
  readonly railCompanyId: string;
  readonly bossCompanyId: string;
}
