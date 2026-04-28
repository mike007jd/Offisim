import type { KanbanOrigin, KanbanState } from '@offisim/shared-types';

export type { KanbanOrigin, KanbanState };

export interface KanbanCard {
  id: string;
  projectId: string;
  companyId: string;
  title: string;
  note: string;
  state: KanbanState;
  origin: KanbanOrigin;
  createdByEmployeeId: string | null;
  assignedEmployeeId: string | null;
  parentCardId: string | null;
  blockedReason: string | null;
  taskRunId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKanbanCardInput {
  title: string;
  note?: string | null;
  origin?: KanbanOrigin;
  assignedEmployeeId?: string | null;
  createdByEmployeeId?: string | null;
}
