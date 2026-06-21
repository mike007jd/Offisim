import type { PlatformDb } from './db.js';

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
  };
}
