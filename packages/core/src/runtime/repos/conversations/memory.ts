import type {
  ActiveInteractionRepository,
  InteractionActiveRow,
  InteractionHistoryRepository,
  InteractionHistoryRow,
  MeetingRepository,
  MeetingSessionRow,
  NewInteractionActive,
  NewInteractionHistory,
  NewMeetingSession,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows, now } from '../memory-utils.js';

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

  async findByCompany(companyId: string): Promise<MeetingSessionRow[]> {
    return [...this.rows.values()]
      .filter((m) => m.company_id === companyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async updateStatus(id: string, status: string, summaryJson?: string | null): Promise<void> {
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

  async findByCompany(companyId: string): Promise<InteractionActiveRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.company_id === companyId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
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

  async listByCompany(
    companyId: string,
    opts?: { limit?: number },
  ): Promise<InteractionHistoryRow[]> {
    const rows = this.rows
      .filter((row) => row.company_id === companyId)
      .sort((a, b) => b.resolved_at.localeCompare(a.resolved_at));
    return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
  }

  snapshot(): InteractionHistoryRow[] {
    return cloneRows(this.rows);
  }
}

export interface ConversationsMemoryRepos {
  meetings: MemoryMeetingRepository;
  activeInteractions: MemoryActiveInteractionRepository;
  interactionHistory: MemoryInteractionHistoryRepository;
}

export function createConversationsMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): ConversationsMemoryRepos {
  const meetings = new MemoryMeetingRepository(snapshot?.meetings);
  const activeInteractions = new MemoryActiveInteractionRepository(snapshot?.activeInteractions);
  const interactionHistory = new MemoryInteractionHistoryRepository(snapshot?.interactionHistory);
  return { meetings, activeInteractions, interactionHistory };
}
