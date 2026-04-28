import type { PlatformDb } from './db.js';

export interface PlatformResumeCoordinator {
  resume(conversationId: string): Promise<{ state: unknown; lastCheckpointTs: number } | null>;
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
  };
}
