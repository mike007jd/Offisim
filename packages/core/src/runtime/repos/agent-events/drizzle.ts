import * as schema from '@offisim/db-local/dist/schema.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  AgentEventRepository,
  AgentEventRow,
  NewAgentEvent,
  NewRecoveryKnowledge,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface AgentEventsDrizzleRepos {
  agentEvents: AgentEventRepository;
  recoveryKnowledge: RecoveryKnowledgeRepository;
}

export function createAgentEventsDrizzleRepos(db: Db): AgentEventsDrizzleRepos {
  const agentEvents: AgentEventRepository = {
    async append(event: NewAgentEvent) {
      const row: AgentEventRow = {
        ...event,
        created_at: event.created_at ?? now(),
      };
      const insert = db.insert(schema.agentEvents).values(row);
      if (row.event_type === 'direct_chat.message') {
        insert
          .onConflictDoUpdate({
            target: schema.agentEvents.event_id,
            setWhere: sql`excluded.created_at >= ${schema.agentEvents.created_at}`,
            set: {
              project_id: row.project_id,
              thread_id: row.thread_id,
              company_id: row.company_id,
              agent_name: row.agent_name,
              event_type: row.event_type,
              payload_json: row.payload_json,
              parent_event_id: row.parent_event_id,
              created_at: row.created_at,
            },
          })
          .run();
      } else {
        insert.run();
      }
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

  return { agentEvents, recoveryKnowledge };
}
