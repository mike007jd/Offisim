import type { InteractionMode } from '@offisim/shared-types';
import type { PlatformDb } from './db.js';

interface PlatformResumeCoordinator {
  resume(conversationId: string): Promise<{ state: unknown; lastCheckpointTs: number } | null>;
}

interface PlatformSessionRow {
  id: string;
  mode: InteractionMode;
  status: string;
  topic: string;
  updatedAt: string;
}

interface PlatformSessionStore {
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
    authKind?: 'session' | 'api-token';
    apiTokenScopes?: string[];
    authLinkConflict?: boolean;
    creatorId?: string;
    resumeCoordinator?: PlatformResumeCoordinator;
    sessionStore?: PlatformSessionStore;
  };
}
