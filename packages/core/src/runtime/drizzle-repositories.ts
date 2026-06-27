import type * as schema from '@offisim/db-local/dist/schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EventBus } from '../events/event-bus.js';
import { createAgentEventsDrizzleRepos } from './repos/agent-events/drizzle.js';
import { createAgentRunsDrizzleRepos } from './repos/agent-runs/drizzle.js';
import { createCollaborationDrizzleRepos } from './repos/collaboration/drizzle.js';
import { createConversationsDrizzleRepos } from './repos/conversations/drizzle.js';
import { createDeliverablesDrizzleRepos } from './repos/deliverables/drizzle.js';
import { createEmployeesDrizzleRepos } from './repos/employees/drizzle.js';
import { createFilesDrizzleRepos } from './repos/files/drizzle.js';
import { createInstallDrizzleRepos } from './repos/install/drizzle.js';
import { createLlmDrizzleRepos } from './repos/llm/drizzle.js';
import { createLoopDrizzleRepos } from './repos/loops/drizzle.js';
import { createMemorySystemDrizzleRepos } from './repos/memory-system/drizzle.js';
import { createMissionDrizzleRepos } from './repos/mission/drizzle.js';
import { createOrchestrationDrizzleRepos } from './repos/orchestration/drizzle.js';
import { createPermissionsDrizzleRepos } from './repos/permissions/drizzle.js';
import { createPiMessagesDrizzleRepo } from './repos/pi-messages/drizzle.js';
import { createProjectsDrizzleRepos } from './repos/projects/drizzle.js';
import { createSkillsDrizzleRepos } from './repos/skills/drizzle.js';
import { createWorkspaceDrizzleRepos } from './repos/workspace/drizzle.js';
import type { RuntimeRepositories } from './repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

// Wraps a synchronous callback in a better-sqlite3 transaction. All repo
// .run() calls inside fn() participate in the same transaction. db.transaction(fn)
// for better-sqlite3 executes fn synchronously and returns T.
function makeTransact(db: Db) {
  return <T>(fn: () => T): T => {
    const result = db.transaction(fn) as unknown as T;
    if (result instanceof Promise) {
      throw new Error(
        'transact() callback must be synchronous — received Promise. Do not use async repo methods inside transact().',
      );
    }
    return result;
  };
}

// Drizzle Node uses better-sqlite3, which is a single-threaded sync driver.
// It cannot hold a SQLite transaction open across `await` boundaries — if we
// tried, every microtask would either bail with SQLITE_BUSY or commit early.
// So on Node we expose `asyncTransact` as a passthrough that simply awaits
// fn(); callers needing atomic multi-write semantics must use the sync
// `transact()` API on this backend. The portable callers (skill install,
// install materializer) target the Tauri backend where asyncTransact is real.
function makeAsyncTransact() {
  return async <T>(fn: (txRepos?: RuntimeRepositories) => Promise<T>): Promise<T> => fn();
}

export function createDrizzleRepositories(db: Db, _eventBus?: EventBus): RuntimeRepositories {
  return {
    ...createOrchestrationDrizzleRepos(db),
    ...createEmployeesDrizzleRepos(db),
    ...createConversationsDrizzleRepos(db),
    ...createLlmDrizzleRepos(db),
    ...createInstallDrizzleRepos(db),
    ...createPermissionsDrizzleRepos(db),
    ...createMemorySystemDrizzleRepos(db),
    ...createFilesDrizzleRepos(db),
    ...createWorkspaceDrizzleRepos(db),
    ...createProjectsDrizzleRepos(db),
    ...createAgentEventsDrizzleRepos(db),
    ...createAgentRunsDrizzleRepos(db),
    ...createDeliverablesDrizzleRepos(db),
    ...createSkillsDrizzleRepos(db),
    ...createMissionDrizzleRepos(db),
    ...createLoopDrizzleRepos(db),
    ...createCollaborationDrizzleRepos(db),
    piMessages: createPiMessagesDrizzleRepo(db),
    transact: makeTransact(db),
    asyncTransact: makeAsyncTransact(),
  };
}
