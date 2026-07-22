import type { AgentEventRepository, AgentEventRow, NewAgentEvent } from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface AgentEventsTauriRepos {
  agentEvents: AgentEventRepository;
}

export function createAgentEventsTauriRepos(db: TauriDrizzleDb): AgentEventsTauriRepos {
  const agentEvents: AgentEventRepository = {
    async append(event: NewAgentEvent) {
      const row: AgentEventRow = {
        ...event,
        created_at: event.created_at ?? now(),
      };
      const insert = db.insert(schema.agentEvents).values(row);
      if (row.event_type === 'direct_chat.message') {
        await insert.onConflictDoUpdate({
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
        });
      } else {
        await insert;
      }
      return row;
    },
    async findById(eventId) {
      const rows = (await db
        .select()
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.event_id, eventId))) as AgentEventRow[];
      return rows[0] ?? null;
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
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as AgentEventRow[];
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
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as AgentEventRow[];
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
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as AgentEventRow[];
    },
    async findCausalChain(eventId) {
      const chain: AgentEventRow[] = [];
      let currentId: string | null = eventId;
      const visited = new Set<string>();

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const rows = (await db
          .select()
          .from(schema.agentEvents)
          .where(eq(schema.agentEvents.event_id, currentId))) as AgentEventRow[];
        if (rows.length === 0) {
          break;
        }
        const [current] = rows;
        if (!current) {
          break;
        }
        chain.push(current);
        currentId = current.parent_event_id;
      }

      return chain;
    },
    async findRecent(threadId, limit) {
      return (await db
        .select()
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.thread_id, threadId))
        .orderBy(desc(schema.agentEvents.created_at))
        .limit(limit)) as AgentEventRow[];
    },
  };

  return { agentEvents };
}
