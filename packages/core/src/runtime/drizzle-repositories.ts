import * as schema from '@offisim/db-local/dist/schema.js';
import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
} from '@offisim/shared-types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createConversationsDrizzleRepos } from './repos/conversations/drizzle.js';
import { createEmployeesDrizzleRepos } from './repos/employees/drizzle.js';
import { createFilesDrizzleRepos } from './repos/files/drizzle.js';
import { createInstallDrizzleRepos } from './repos/install/drizzle.js';
import { createLlmDrizzleRepos } from './repos/llm/drizzle.js';
import { createMemorySystemDrizzleRepos } from './repos/memory-system/drizzle.js';
import { createOrchestrationDrizzleRepos } from './repos/orchestration/drizzle.js';
import { createPermissionsDrizzleRepos } from './repos/permissions/drizzle.js';
import { createWorkspaceDrizzleRepos } from './repos/workspace/drizzle.js';
import type {
  AgentEventRepository,
  AgentEventRow,
  NewAgentEvent,
  NewRecoveryKnowledge,
  ProjectAssignmentRepository,
  ProjectRepository,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
  RuntimeRepositories,
} from './repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export function createDrizzleRepositories(db: Db): RuntimeRepositories {
  const orchestration = createOrchestrationDrizzleRepos(db);
  const employeesFamily = createEmployeesDrizzleRepos(db);
  const conversationsFamily = createConversationsDrizzleRepos(db);
  const llmFamily = createLlmDrizzleRepos(db);
  const installFamily = createInstallDrizzleRepos(db);
  const permissionsFamily = createPermissionsDrizzleRepos(db);
  const memorySystemFamily = createMemorySystemDrizzleRepos(db);
  const filesFamily = createFilesDrizzleRepos(db);
  const workspaceFamily = createWorkspaceDrizzleRepos(db);

  const projects: ProjectRepository = {
    async create(project: NewProject) {
      const ts = now();
      const row: ProjectRow = { ...project, created_at: ts, updated_at: ts };
      db.insert(schema.projects).values(row).run();
      return row;
    },
    async findById(projectId) {
      const rows = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.project_id, projectId))
        .all();
      return (rows[0] as ProjectRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.company_id, companyId))
        .orderBy(desc(schema.projects.updated_at))
        .all() as ProjectRow[];
    },
    async findActiveByCompany(companyId) {
      return db
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.company_id, companyId),
            inArray(schema.projects.status, [...ACTIVE_PROJECT_STATUSES]),
          ),
        )
        .orderBy(desc(schema.projects.updated_at))
        .all() as ProjectRow[];
    },
    async updateStatus(projectId, status: ProjectStatus) {
      db.update(schema.projects)
        .set({ status, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId))
        .run();
    },
    async update(projectId, patch) {
      db.update(schema.projects)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId))
        .run();
    },
    async delete(projectId) {
      db.delete(schema.projects).where(eq(schema.projects.project_id, projectId)).run();
    },
  };

  const projectAssignments: ProjectAssignmentRepository = {
    async assign(assignment: NewProjectAssignment) {
      const row: ProjectAssignmentRow = {
        ...assignment,
        assigned_at: now(),
      };
      db.insert(schema.projectAssignments).values(row).onConflictDoNothing().run();
      // Re-read to return whatever row exists (could be existing if duplicate)
      const rows = db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, assignment.project_id),
            eq(schema.projectAssignments.employee_id, assignment.employee_id),
          ),
        )
        .all();
      return (rows[0] as ProjectAssignmentRow | undefined) ?? row;
    },
    async unassign(projectId, employeeId) {
      db.delete(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        )
        .run();
    },
    async findByProject(projectId) {
      return db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.project_id, projectId))
        .all() as ProjectAssignmentRow[];
    },
    async findByEmployee(employeeId) {
      return db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.employee_id, employeeId))
        .all() as ProjectAssignmentRow[];
    },
    async isAssigned(projectId, employeeId) {
      const rows = db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        )
        .all();
      return rows.length > 0;
    },
  };

  // ---------------------------------------------------------------------------
  // Agent events (event sourcing)
  // ---------------------------------------------------------------------------

  const agentEvents: AgentEventRepository = {
    async append(event: NewAgentEvent) {
      const row: AgentEventRow = {
        ...event,
        created_at: event.created_at ?? now(),
      };
      db.insert(schema.agentEvents).values(row).run();
      return row;
    },
    async findByProject(projectId, opts) {
      let query = db
        .select()
        .from(schema.agentEvents)
        .where(
          opts?.eventType
            ? and(
                eq(schema.agentEvents.project_id, projectId),
                eq(schema.agentEvents.event_type, opts.eventType),
              )
            : eq(schema.agentEvents.project_id, projectId),
        )
        .orderBy(desc(schema.agentEvents.created_at));
      if (opts?.limit) query = query.limit(opts.limit) as typeof query;
      return query.all() as AgentEventRow[];
    },
    async findByThread(threadId, opts) {
      let query = db
        .select()
        .from(schema.agentEvents)
        .where(
          opts?.eventType
            ? and(
                eq(schema.agentEvents.thread_id, threadId),
                eq(schema.agentEvents.event_type, opts.eventType),
              )
            : eq(schema.agentEvents.thread_id, threadId),
        )
        .orderBy(desc(schema.agentEvents.created_at));
      if (opts?.limit) query = query.limit(opts.limit) as typeof query;
      return query.all() as AgentEventRow[];
    },
    async findByAgent(agentName, opts) {
      let query = db
        .select()
        .from(schema.agentEvents)
        .where(
          opts?.eventType
            ? and(
                eq(schema.agentEvents.agent_name, agentName),
                eq(schema.agentEvents.event_type, opts.eventType),
              )
            : eq(schema.agentEvents.agent_name, agentName),
        )
        .orderBy(desc(schema.agentEvents.created_at));
      if (opts?.limit) query = query.limit(opts.limit) as typeof query;
      return query.all() as AgentEventRow[];
    },
    async findCausalChain(eventId) {
      // Walk parent_event_id chain iteratively (SQLite has no recursive CTE in Drizzle)
      const chain: AgentEventRow[] = [];
      let currentId: string | null = eventId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const rows = db
          .select()
          .from(schema.agentEvents)
          .where(eq(schema.agentEvents.event_id, currentId))
          .all() as AgentEventRow[];
        if (rows.length === 0) break;
        const [current] = rows;
        if (!current) break;
        chain.push(current);
        currentId = current.parent_event_id;
      }
      return chain;
    },
    async findRecent(threadId, limit) {
      return db
        .select()
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.thread_id, threadId))
        .orderBy(desc(schema.agentEvents.created_at))
        .limit(limit)
        .all() as AgentEventRow[];
    },
  };

  // ---------------------------------------------------------------------------
  // Recovery knowledge (persistent learning)
  // ---------------------------------------------------------------------------

  const recoveryKnowledge: RecoveryKnowledgeRepository = {
    async upsert(entry: NewRecoveryKnowledge) {
      const existing = db
        .select()
        .from(schema.recoveryKnowledge)
        .where(
          and(
            eq(schema.recoveryKnowledge.symptom, entry.symptom),
            eq(schema.recoveryKnowledge.cause, entry.cause),
          ),
        )
        .all() as RecoveryKnowledgeRow[];
      if (existing.length > 0) {
        const [current] = existing;
        if (!current) {
          throw new Error('Recovery knowledge lookup returned empty result');
        }
        // Update strategy and config if changed
        db.update(schema.recoveryKnowledge)
          .set({ fix_strategy: entry.fix_strategy, fix_config: entry.fix_config ?? null })
          .where(eq(schema.recoveryKnowledge.knowledge_id, current.knowledge_id))
          .run();
        return {
          ...current,
          fix_strategy: entry.fix_strategy,
          fix_config: entry.fix_config ?? null,
        };
      }
      const row: RecoveryKnowledgeRow = {
        ...entry,
        fix_config: entry.fix_config ?? null,
        success_count: 0,
        failure_count: 0,
        last_used_at: null,
        created_at: now(),
      };
      db.insert(schema.recoveryKnowledge).values(row).run();
      return row;
    },
    async findBySymptom(symptom) {
      return db
        .select()
        .from(schema.recoveryKnowledge)
        .where(eq(schema.recoveryKnowledge.symptom, symptom))
        .all() as RecoveryKnowledgeRow[];
    },
    async findBestFix(symptom) {
      const rows = db
        .select()
        .from(schema.recoveryKnowledge)
        .where(eq(schema.recoveryKnowledge.symptom, symptom))
        .all() as RecoveryKnowledgeRow[];
      if (rows.length === 0) return null;
      // Pick the fix with highest success rate; break ties by most recent use
      return (
        rows.sort((a, b) => {
          const rateA =
            a.success_count + a.failure_count > 0
              ? a.success_count / (a.success_count + a.failure_count)
              : 0.5;
          const rateB =
            b.success_count + b.failure_count > 0
              ? b.success_count / (b.success_count + b.failure_count)
              : 0.5;
          if (rateB !== rateA) return rateB - rateA;
          return (b.last_used_at ?? '').localeCompare(a.last_used_at ?? '');
        })[0] ?? null
      );
    },
    async incrementSuccess(knowledgeId) {
      db.update(schema.recoveryKnowledge)
        .set({
          success_count: sql`success_count + 1`,
          last_used_at: now(),
        })
        .where(eq(schema.recoveryKnowledge.knowledge_id, knowledgeId))
        .run();
    },
    async incrementFailure(knowledgeId) {
      db.update(schema.recoveryKnowledge)
        .set({
          failure_count: sql`failure_count + 1`,
          last_used_at: now(),
        })
        .where(eq(schema.recoveryKnowledge.knowledge_id, knowledgeId))
        .run();
    },
    async findAll(opts) {
      let query = db
        .select()
        .from(schema.recoveryKnowledge)
        .orderBy(desc(schema.recoveryKnowledge.created_at));
      if (opts?.limit) query = query.limit(opts.limit) as typeof query;
      return query.all() as RecoveryKnowledgeRow[];
    },
  };

  // Wraps a synchronous callback in a better-sqlite3 transaction.
  // All repo .run() calls inside fn() participate in the same transaction.
  // db.transaction(fn) for better-sqlite3 executes fn synchronously and returns T.
  const transact = <T>(fn: () => T): T => {
    const result = db.transaction(fn) as unknown as T;
    if (result instanceof Promise) {
      throw new Error(
        'transact() callback must be synchronous — received Promise. Do not use async repo methods inside transact().',
      );
    }
    return result;
  };

  return {
    ...orchestration,
    ...employeesFamily,
    ...conversationsFamily,
    ...llmFamily,
    ...installFamily,
    ...permissionsFamily,
    ...memorySystemFamily,
    ...filesFamily,
    ...workspaceFamily,
    projects,
    projectAssignments,
    agentEvents,
    recoveryKnowledge,
    transact,
  };
}
