// SYNC: This file mirrors packages/core/src/runtime/drizzle-repositories.ts
// but uses `await` on all Drizzle calls (sqlite-proxy returns Promises).
// If you change repository logic in core, update this file too.

import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
import type { TauriDrizzleDb } from './tauri-drizzle';
import { withTauriSqlTransaction } from './tauri-drizzle';
import { createAgentEventsTauriRepos } from './tauri-repos/agent-events';
import { createConversationsTauriRepos } from './tauri-repos/conversations';
import { createDeliverablesTauriRepos } from './tauri-repos/deliverables';
import { createEmployeesTauriRepos } from './tauri-repos/employees';
import { createFilesTauriRepos } from './tauri-repos/files';
import { createInstallTauriRepos } from './tauri-repos/install';
import { createLlmTauriRepos } from './tauri-repos/llm';
import { createMemorySystemTauriRepos } from './tauri-repos/memory-system';
import { createOrchestrationTauriRepos } from './tauri-repos/orchestration';
import { createPermissionsTauriRepos } from './tauri-repos/permissions';
import { createPiMessagesTauriRepos } from './tauri-repos/pi-messages';
import { createProjectsTauriRepos } from './tauri-repos/projects';
import { createSkillsTauriRepos } from './tauri-repos/skills';
import { createWorkspaceTauriRepos } from './tauri-repos/workspace';

/**
 * Create RuntimeRepositories backed by Drizzle sqlite-proxy (async).
 *
 * Mirrors packages/core/src/runtime/drizzle-repositories.ts but uses `await`
 * on all Drizzle calls (sqlite-proxy returns Promises).
 *
 * Unlike the better-sqlite3 runtime, sqlite-proxy cannot safely implement the
 * synchronous `repos.transact(fn)` contract. Callers must use the async
 * `asyncTransact(fn)` path on the Tauri backend.
 */
export function createTauriRepositories(
  db: TauriDrizzleDb,
  _eventBus?: EventBus,
): RuntimeRepositories {
  return {
    ...createOrchestrationTauriRepos(db),
    ...createEmployeesTauriRepos(db),
    ...createConversationsTauriRepos(db),
    ...createLlmTauriRepos(db),
    ...createInstallTauriRepos(db),
    ...createPermissionsTauriRepos(db),
    ...createMemorySystemTauriRepos(db),
    ...createFilesTauriRepos(db),
    ...createWorkspaceTauriRepos(db),
    ...createProjectsTauriRepos(db),
    ...createAgentEventsTauriRepos(db),
    ...createDeliverablesTauriRepos(db),
    ...createSkillsTauriRepos(db),
    ...createPiMessagesTauriRepos(db),
    // Real atomic transactions on desktop: every drizzle .run() inside fn() is
    // queued and committed atomically via `local_db_execute_transaction`. The
    // Rust side validates each statement against the SQL allowlist (E/C1).
    asyncTransact<T>(fn: (txRepos?: RuntimeRepositories) => Promise<T>): Promise<T> {
      if (fn.length === 0) {
        return Promise.reject(
          new Error('Tauri asyncTransact callbacks must accept and use txRepos.'),
        );
      }
      return withTauriSqlTransaction((txDb) => fn(createTauriRepositories(txDb, _eventBus)));
    },
  };
}
