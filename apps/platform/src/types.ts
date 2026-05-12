import type { EventBus, KanbanCardRow } from '@offisim/core';
import type {
  InteractionMode,
  KanbanOrigin,
  KanbanState,
  RuntimeEvent,
} from '@offisim/shared-types';
import type { PlatformDb } from './db.js';

export interface PlatformResumeCoordinator {
  resume(conversationId: string): Promise<{ state: unknown; lastCheckpointTs: number } | null>;
}

export interface PlatformSessionRow {
  id: string;
  mode: InteractionMode;
  status: string;
  topic: string;
  updatedAt: string;
}

export interface PlatformSessionStore {
  getSession(id: string): Promise<PlatformSessionRow | null>;
  setSessionMode(id: string, mode: InteractionMode): Promise<PlatformSessionRow | null>;
}

export interface PlatformKanbanCreateInput {
  title: string;
  note?: string | null;
  state?: KanbanState;
  origin: KanbanOrigin;
  assignedEmployeeId?: string | null;
  createdByEmployeeId?: string | null;
  blockedReason?: string | null;
}

export interface PlatformKanbanUpdateInput {
  title?: string;
  note?: string | null;
  assignedEmployeeId?: string | null;
  blockedReason?: string | null;
}

export interface PlatformKanbanStore {
  listByProject(projectId: string): Promise<KanbanCardRow[]>;
  create(projectId: string, input: PlatformKanbanCreateInput): Promise<KanbanCardRow>;
  update?(id: string, input: PlatformKanbanUpdateInput): Promise<KanbanCardRow | null>;
  transition(
    id: string,
    next: KanbanState,
    blockedReason?: string | null,
  ): Promise<KanbanCardRow | null>;
  countByEmployee(employeeId: string): Promise<number>;
}

export type PlatformKanbanEventBus = Pick<EventBus, 'on'>;
export type PlatformKanbanEvent = RuntimeEvent<{
  kind: 'kanban';
  op: 'created' | 'updated' | 'transitioned' | 'assigned';
  card: KanbanCardRow;
}>;

/** Hono env bindings for all platform routes */
export interface PlatformEnv {
  Variables: {
    db: PlatformDb;
    requestId: string;
    userId?: string;
    userEmail?: string;
    authKind?: 'session' | 'api-token';
    apiTokenScopes?: string[];
    authLinkConflict?: boolean;
    creatorId?: string;
    resumeCoordinator?: PlatformResumeCoordinator;
    sessionStore?: PlatformSessionStore;
    kanbanStore?: PlatformKanbanStore;
    kanbanEventBus?: PlatformKanbanEventBus;
  };
}
