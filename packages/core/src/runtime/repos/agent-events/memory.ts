import type {
  AgentEventRepository,
  AgentEventRow,
  NewAgentEvent,
  NewRecoveryKnowledge,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows } from '../memory-utils.js';

export class MemoryAgentEventRepository implements AgentEventRepository {
  private readonly rows: AgentEventRow[] = [];

  constructor(initialRows?: Iterable<AgentEventRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async append(event: NewAgentEvent): Promise<AgentEventRow> {
    const row: AgentEventRow = {
      ...event,
      created_at: event.created_at ?? new Date().toISOString(),
    };
    const existingIndex =
      row.event_type === 'direct_chat.message'
        ? this.rows.findIndex((candidate) => candidate.event_id === row.event_id)
        : -1;
    if (existingIndex >= 0) {
      const existing = this.rows[existingIndex];
      if (!existing || row.created_at >= existing.created_at) this.rows[existingIndex] = row;
    } else {
      this.rows.push(row);
    }
    return row;
  }

  async findByProject(
    projectId: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]> {
    let results = this.rows
      .filter(
        (r) => r.project_id === projectId && (!opts?.eventType || r.event_type === opts.eventType),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findByThread(
    threadId: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]> {
    let results = this.rows
      .filter(
        (r) => r.thread_id === threadId && (!opts?.eventType || r.event_type === opts.eventType),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findByAgent(
    agentName: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]> {
    let results = this.rows
      .filter(
        (r) => r.agent_name === agentName && (!opts?.eventType || r.event_type === opts.eventType),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async findCausalChain(eventId: string): Promise<AgentEventRow[]> {
    const chain: AgentEventRow[] = [];
    let currentId: string | null = eventId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const found = this.rows.find((r) => r.event_id === currentId);
      if (!found) break;
      chain.push(found);
      currentId = found.parent_event_id;
    }
    return chain;
  }

  async findRecent(threadId: string, limit: number): Promise<AgentEventRow[]> {
    return this.rows
      .filter((r) => r.thread_id === threadId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  snapshot(): AgentEventRow[] {
    return cloneRows(this.rows);
  }
}

export class MemoryRecoveryKnowledgeRepository implements RecoveryKnowledgeRepository {
  private readonly store = new Map<string, RecoveryKnowledgeRow>();

  constructor(initialRows?: Iterable<RecoveryKnowledgeRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(`${row.symptom}::${row.cause}`, { ...row });
    }
  }

  async upsert(entry: NewRecoveryKnowledge): Promise<RecoveryKnowledgeRow> {
    const key = `${entry.symptom}::${entry.cause}`;
    const existing = this.store.get(key);
    if (existing) {
      const updated = {
        ...existing,
        fix_strategy: entry.fix_strategy,
        fix_config: entry.fix_config ?? null,
      };
      this.store.set(key, updated);
      return updated;
    }
    const row: RecoveryKnowledgeRow = {
      ...entry,
      fix_config: entry.fix_config ?? null,
      success_count: 0,
      failure_count: 0,
      last_used_at: null,
      created_at: new Date().toISOString(),
    };
    this.store.set(key, row);
    return row;
  }

  async findBySymptom(symptom: string): Promise<RecoveryKnowledgeRow[]> {
    return [...this.store.values()].filter((r) => r.symptom === symptom);
  }

  async findBestFix(symptom: string): Promise<RecoveryKnowledgeRow | null> {
    const matches = [...this.store.values()].filter((r) => r.symptom === symptom);
    if (matches.length === 0) return null;
    return (
      matches.sort((a, b) => {
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
  }

  async incrementSuccess(knowledgeId: string): Promise<void> {
    for (const [key, row] of this.store.entries()) {
      if (row.knowledge_id === knowledgeId) {
        this.store.set(key, {
          ...row,
          success_count: row.success_count + 1,
          last_used_at: new Date().toISOString(),
        });
        return;
      }
    }
  }

  async incrementFailure(knowledgeId: string): Promise<void> {
    for (const [key, row] of this.store.entries()) {
      if (row.knowledge_id === knowledgeId) {
        this.store.set(key, {
          ...row,
          failure_count: row.failure_count + 1,
          last_used_at: new Date().toISOString(),
        });
        return;
      }
    }
  }

  async findAll(opts?: { limit?: number }): Promise<RecoveryKnowledgeRow[]> {
    let results = [...this.store.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  snapshot(): RecoveryKnowledgeRow[] {
    return cloneRows(this.store.values());
  }
}

export interface AgentEventsMemoryRepos {
  agentEvents: MemoryAgentEventRepository;
  recoveryKnowledge: MemoryRecoveryKnowledgeRepository;
}

export function createAgentEventsMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): AgentEventsMemoryRepos {
  const agentEvents = new MemoryAgentEventRepository(snapshot?.agentEvents);
  const recoveryKnowledge = new MemoryRecoveryKnowledgeRepository(snapshot?.recoveryKnowledge);
  return { agentEvents, recoveryKnowledge };
}
