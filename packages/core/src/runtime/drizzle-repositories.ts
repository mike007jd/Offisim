import type * as schema from '@offisim/db-local/dist/schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { EventBus } from '../events/event-bus.js';
import { createAgentEventsDrizzleRepos } from './repos/agent-events/drizzle.js';
import { createConversationsDrizzleRepos } from './repos/conversations/drizzle.js';
import { createDeliverablesDrizzleRepos } from './repos/deliverables/drizzle.js';
import { createEmployeesDrizzleRepos } from './repos/employees/drizzle.js';
import { createFilesDrizzleRepos } from './repos/files/drizzle.js';
import { createInstallDrizzleRepos } from './repos/install/drizzle.js';
import { createKanbanDrizzleRepos } from './repos/kanban/drizzle.js';
import { createLlmDrizzleRepos } from './repos/llm/drizzle.js';
import { createMemorySystemDrizzleRepos } from './repos/memory-system/drizzle.js';
import { createOrchestrationDrizzleRepos } from './repos/orchestration/drizzle.js';
import { createPermissionsDrizzleRepos } from './repos/permissions/drizzle.js';
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

export function createDrizzleRepositories(db: Db, eventBus?: EventBus): RuntimeRepositories {
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
    ...createKanbanDrizzleRepos(db, eventBus),
    ...createAgentEventsDrizzleRepos(db),
    ...createDeliverablesDrizzleRepos(db),
    ...createSkillsDrizzleRepos(db),
    transact: makeTransact(db),
  };
}
