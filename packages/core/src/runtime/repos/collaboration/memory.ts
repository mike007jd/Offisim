import type {
  CollaborationMemberRepository,
  CollaborationMessageRepository,
  CollaborationMessageRow,
  CollaborationReadStateRepository,
  CollaborationReadStateRow,
  CollaborationThreadMemberRow,
  CollaborationThreadPatch,
  CollaborationThreadRepository,
  CollaborationThreadRow,
  NewCollaborationMessage,
  NewCollaborationThread,
  NewCollaborationThreadMember,
} from '../../repositories.js';

const DEFAULT_PAGE_LIMIT = 50;

/** Newest-first comparator on the keyset `(created_at, message_id)`. */
function newestFirst(a: CollaborationMessageRow, b: CollaborationMessageRow): number {
  const t = b.created_at.localeCompare(a.created_at);
  return t !== 0 ? t : b.message_id.localeCompare(a.message_id);
}

/** True when `row` is strictly older than the cursor on `(created_at, message_id)`. */
function olderThan(
  row: CollaborationMessageRow,
  cursor: { createdAt: string; messageId: string },
): boolean {
  if (row.created_at < cursor.createdAt) return true;
  return row.created_at === cursor.createdAt && row.message_id < cursor.messageId;
}

export class MemoryCollaborationThreadRepository implements CollaborationThreadRepository {
  private readonly store = new Map<string, CollaborationThreadRow>();

  async insert(row: NewCollaborationThread): Promise<void> {
    if (this.store.has(row.thread_id)) return;
    // Model the partial-unique index `idx_collaboration_threads_active_direct`
    // (UNIQUE(company_id, direct_employee_id) WHERE kind='direct' AND
    // archived_at IS NULL) as the Drizzle backend's `onConflictDoNothing`: a
    // second active direct for the same (company, employee) is a silent no-op,
    // so a racing insert converges to the existing row instead of duplicating.
    if (row.kind === 'direct' && row.archived_at == null) {
      const clash = [...this.store.values()].some(
        (r) =>
          r.company_id === row.company_id &&
          r.kind === 'direct' &&
          r.direct_employee_id === row.direct_employee_id &&
          r.archived_at == null,
      );
      if (clash) return;
    }
    this.store.set(row.thread_id, { ...row });
  }

  async findById(threadId: string): Promise<CollaborationThreadRow | null> {
    const row = this.store.get(threadId);
    return row ? { ...row } : null;
  }

  async findActiveDirect(
    companyId: string,
    employeeId: string,
  ): Promise<CollaborationThreadRow | null> {
    const row = [...this.store.values()].find(
      (r) =>
        r.company_id === companyId &&
        r.kind === 'direct' &&
        r.direct_employee_id === employeeId &&
        r.archived_at == null,
    );
    return row ? { ...row } : null;
  }

  async findArchivedDirect(
    companyId: string,
    employeeId: string,
  ): Promise<CollaborationThreadRow | null> {
    const row = [...this.store.values()]
      .filter(
        (r) =>
          r.company_id === companyId &&
          r.kind === 'direct' &&
          r.direct_employee_id === employeeId &&
          r.archived_at != null,
      )
      .sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''))[0];
    return row ? { ...row } : null;
  }

  async listByCompany(companyId: string): Promise<CollaborationThreadRow[]> {
    return [...this.store.values()]
      .filter((r) => r.company_id === companyId && r.archived_at == null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((r) => ({ ...r }));
  }

  async update(threadId: string, patch: CollaborationThreadPatch): Promise<void> {
    const row = this.store.get(threadId);
    if (!row) return;
    this.store.set(threadId, {
      ...row,
      title: patch.title !== undefined ? patch.title : row.title,
      reply_policy: patch.reply_policy !== undefined ? patch.reply_policy : row.reply_policy,
      round_speaker_limit:
        patch.round_speaker_limit !== undefined
          ? patch.round_speaker_limit
          : row.round_speaker_limit,
      archived_at: patch.archived_at !== undefined ? patch.archived_at : row.archived_at,
      updated_at: patch.updated_at,
    });
  }
}

export class MemoryCollaborationMemberRepository implements CollaborationMemberRepository {
  private readonly store = new Map<string, CollaborationThreadMemberRow>();

  async insert(row: NewCollaborationThreadMember): Promise<void> {
    if (this.store.has(row.member_id)) return;
    this.store.set(row.member_id, { ...row });
  }

  async listActiveByThread(threadId: string): Promise<CollaborationThreadMemberRow[]> {
    return [...this.store.values()]
      .filter((r) => r.thread_id === threadId && r.left_at == null)
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
      .map((r) => ({ ...r }));
  }

  async listAllByThread(threadId: string): Promise<CollaborationThreadMemberRow[]> {
    return [...this.store.values()]
      .filter((r) => r.thread_id === threadId)
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
      .map((r) => ({ ...r }));
  }

  async markLeft(memberId: string, leftAt: string): Promise<void> {
    const row = this.store.get(memberId);
    if (!row || row.left_at != null) return;
    this.store.set(memberId, { ...row, left_at: leftAt });
  }
}

export class MemoryCollaborationMessageRepository implements CollaborationMessageRepository {
  private readonly store = new Map<string, CollaborationMessageRow>();

  async insert(row: NewCollaborationMessage): Promise<void> {
    if (this.store.has(row.message_id)) return;
    // Model the partial-unique index on (thread_id, idempotency_key): a second
    // insert carrying a key already used in the thread is a silent no-op, so a
    // concurrent double-send converges on the first writer (the service then
    // catch-rereads the winner). Matches INSERT OR IGNORE on the unique index.
    if (row.idempotency_key != null) {
      const clash = [...this.store.values()].some(
        (r) => r.thread_id === row.thread_id && r.idempotency_key === row.idempotency_key,
      );
      if (clash) return;
    }
    this.store.set(row.message_id, { ...row });
  }

  async findById(messageId: string): Promise<CollaborationMessageRow | null> {
    const row = this.store.get(messageId);
    return row ? { ...row } : null;
  }

  async findByIdempotencyKey(
    threadId: string,
    idempotencyKey: string,
  ): Promise<CollaborationMessageRow | null> {
    const row = [...this.store.values()]
      .filter((r) => r.thread_id === threadId && r.idempotency_key === idempotencyKey)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return row ? { ...row } : null;
  }

  async listByThread(
    threadId: string,
    opts?: { limit?: number; before?: { createdAt: string; messageId: string } },
  ): Promise<CollaborationMessageRow[]> {
    const before = opts?.before;
    return [...this.store.values()]
      .filter((r) => r.thread_id === threadId && (!before || olderThan(r, before)))
      .sort(newestFirst)
      .slice(0, opts?.limit ?? DEFAULT_PAGE_LIMIT)
      .map((r) => ({ ...r }));
  }

  async findLatestByThread(threadId: string): Promise<CollaborationMessageRow | null> {
    const row = [...this.store.values()]
      .filter((r) => r.thread_id === threadId)
      .sort(newestFirst)[0];
    return row ? { ...row } : null;
  }

  async countSince(threadId: string, messageId: string | null): Promise<number> {
    const boundary = messageId ? this.store.get(messageId) ?? null : null;
    return [...this.store.values()].filter((r) => {
      if (r.thread_id !== threadId) return false;
      if (!boundary) return true;
      if (r.created_at > boundary.created_at) return true;
      return r.created_at === boundary.created_at && r.message_id > boundary.message_id;
    }).length;
  }
}

export class MemoryCollaborationReadStateRepository
  implements CollaborationReadStateRepository
{
  private readonly store = new Map<string, CollaborationReadStateRow>();

  async findByThread(threadId: string): Promise<CollaborationReadStateRow | null> {
    const row = this.store.get(threadId);
    return row ? { ...row } : null;
  }

  async upsert(row: CollaborationReadStateRow): Promise<void> {
    this.store.set(row.thread_id, { ...row });
  }
}

export interface CollaborationMemoryRepos {
  collaborationThreads: MemoryCollaborationThreadRepository;
  collaborationMembers: MemoryCollaborationMemberRepository;
  collaborationMessages: MemoryCollaborationMessageRepository;
  collaborationReadState: MemoryCollaborationReadStateRepository;
}

export function createCollaborationMemoryRepos(): CollaborationMemoryRepos {
  return {
    collaborationThreads: new MemoryCollaborationThreadRepository(),
    collaborationMembers: new MemoryCollaborationMemberRepository(),
    collaborationMessages: new MemoryCollaborationMessageRepository(),
    collaborationReadState: new MemoryCollaborationReadStateRepository(),
  };
}
