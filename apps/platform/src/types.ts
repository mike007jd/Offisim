import type { InteractionMode } from '@offisim/shared-types';
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

/** Hono env bindings for all platform routes */
export interface PlatformEnv {
  Variables: {
    db: PlatformDb;
    requestId: string;
    userId?: string;
    userEmail?: string;
    authLinkConflict?: boolean;
    creatorId?: string;
    resumeCoordinator?: PlatformResumeCoordinator;
    sessionStore?: PlatformSessionStore;
  };
}
