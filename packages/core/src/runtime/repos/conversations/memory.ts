import type {
  ActiveInteractionRepository,
  HandoffEventRow,
  HandoffRepository,
  InteractionActiveRow,
  InteractionHistoryRepository,
  InteractionHistoryRow,
  MeetingRepository,
  MeetingSessionRow,
  NewHandoffEvent,
  NewInteractionActive,
  NewInteractionHistory,
  NewMeetingSession,
  NewToolCall,
  ToolCallRepository,
  ToolCallRow,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

function now(): string {
  return new Date().toISOString();
}

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

export class MemoryToolCallRepository implements ToolCallRepository {
  private readonly rows = new Map<string, ToolCallRow>();

  constructor(initial?: Iterable<ToolCallRow>) {
    if (initial) {
      for (const row of initial) this.rows.set(row.tool_call_id, { ...row });
    }
  }

  async create(t: NewToolCall): Promise<ToolCallRow> {
    const row: ToolCallRow = { ...t, finished_at: null };
    this.rows.set(row.tool_call_id, row);
    return row;
  }

  async updateResult(
    id: string,
    status: string,
    responseJson: string | null,
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, { ...row, status, response_json: responseJson, finished_at: now() });
    }
  }

  snapshot(): ToolCallRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryHandoffRepository implements HandoffRepository {
  private readonly rows = new Map<string, HandoffEventRow>();

  constructor(initial?: Iterable<HandoffEventRow>) {
    if (initial) {
      for (const row of initial) this.rows.set(row.handoff_id, { ...row });
    }
  }

  async create(h: NewHandoffEvent): Promise<HandoffEventRow> {
    const row: HandoffEventRow = { ...h };
    this.rows.set(row.handoff_id, row);
    return row;
  }

  async findByThread(threadId: string): Promise<HandoffEventRow[]> {
    return [...this.rows.values()].filter((h) => h.thread_id === threadId);
  }

  snapshot(): HandoffEventRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryMeetingRepository implements MeetingRepository {
  private readonly rows = new Map<string, MeetingSessionRow>();

  constructor(initial?: Iterable<MeetingSessionRow>) {
    if (initial) {
      for (const row of initial) this.rows.set(row.meeting_id, { ...row });
    }
  }

  async create(m: NewMeetingSession): Promise<MeetingSessionRow> {
    const row: MeetingSessionRow = { ...m };
    this.rows.set(row.meeting_id, row);
    return row;
  }

  async findById(id: string): Promise<MeetingSessionRow | null> {
    return this.rows.get(id) ?? null;
  }

  async updateStatus(
    id: string,
    status: string,
    summaryJson?: string | null,
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.rows.set(id, {
        ...row,
        status,
        summary_json: summaryJson ?? row.summary_json,
        updated_at: now(),
      });
    }
  }

  snapshot(): MeetingSessionRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryActiveInteractionRepository implements ActiveInteractionRepository {
  private readonly rows = new Map<string, InteractionActiveRow>();

  constructor(initialRows?: Iterable<InteractionActiveRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.rows.set(row.thread_id, { ...row });
    }
  }

  async upsert(row: NewInteractionActive): Promise<InteractionActiveRow> {
    const persisted = { ...row };
    this.rows.set(persisted.thread_id, persisted);
    return persisted;
  }

  async findByThread(threadId: string): Promise<InteractionActiveRow | null> {
    return this.rows.get(threadId) ?? null;
  }

  async deleteByThread(threadId: string): Promise<void> {
    this.rows.delete(threadId);
  }

  snapshot(): InteractionActiveRow[] {
    return cloneRows(this.rows.values());
  }
}

export class MemoryInteractionHistoryRepository implements InteractionHistoryRepository {
  private readonly rows: InteractionHistoryRow[] = [];

  constructor(initialRows?: Iterable<InteractionHistoryRow>) {
    if (!initialRows) return;
    this.rows.push(...cloneRows(initialRows));
  }

  async create(row: NewInteractionHistory): Promise<InteractionHistoryRow> {
    const persisted = { ...row };
    this.rows.push(persisted);
    return persisted;
  }

  async listByThread(
    threadId: string,
    opts?: { limit?: number },
  ): Promise<InteractionHistoryRow[]> {
    const rows = this.rows
      .filter((row) => row.thread_id === threadId)
      .sort((a, b) => b.resolved_at.localeCompare(a.resolved_at));
    return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
  }

  snapshot(): InteractionHistoryRow[] {
    return cloneRows(this.rows);
  }
}

export interface ConversationsMemoryRepos {
  toolCalls: MemoryToolCallRepository;
  handoffs: MemoryHandoffRepository;
  meetings: MemoryMeetingRepository;
  activeInteractions: MemoryActiveInteractionRepository;
  interactionHistory: MemoryInteractionHistoryRepository;
}

export function createConversationsMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): ConversationsMemoryRepos {
  const toolCalls = new MemoryToolCallRepository(snapshot?.toolCalls);
  const handoffs = new MemoryHandoffRepository(snapshot?.handoffs);
  const meetings = new MemoryMeetingRepository(snapshot?.meetings);
  const activeInteractions = new MemoryActiveInteractionRepository(snapshot?.activeInteractions);
  const interactionHistory = new MemoryInteractionHistoryRepository(snapshot?.interactionHistory);
  return { toolCalls, handoffs, meetings, activeInteractions, interactionHistory };
}
