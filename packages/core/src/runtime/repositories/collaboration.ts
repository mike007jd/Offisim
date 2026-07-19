// ---------------------------------------------------------------------------
// Collaboration (PR-02). Company-scoped daily chat (direct + group), fully
// separate from project-scoped `chat_threads`. Snake_case rows mirror the
// SQLite columns; the camelCase domain model lives in `@offisim/shared-types`
// collaboration module. NO method here accepts or returns `project_id`.
// ---------------------------------------------------------------------------

export interface CollaborationThreadRow {
  thread_id: string;
  company_id: string;
  kind: string;
  title: string;
  direct_employee_id: string | null;
  reply_policy: string;
  capability_profile: string;
  round_speaker_limit: number;
  created_by: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCollaborationThread = CollaborationThreadRow;

export interface CollaborationThreadMemberRow {
  member_id: string;
  thread_id: string;
  actor_type: string;
  employee_id: string | null;
  role: string;
  joined_at: string;
  left_at: string | null;
}

export type NewCollaborationThreadMember = CollaborationThreadMemberRow;

export interface CollaborationMessageRow {
  message_id: string;
  thread_id: string;
  sender_type: string;
  sender_employee_id: string | null;
  body: string;
  reply_to_message_id: string | null;
  status: string;
  /**
   * Double-send idempotency key, deduped by a partial-unique index per thread.
   * A dedicated column (not a metadata field) so a concurrent second append
   * fails at the DB layer and the service catch-rereads the single winner.
   */
  idempotency_key: string | null;
  metadata_json: string | null;
  created_at: string;
  edited_at: string | null;
}

export type NewCollaborationMessage = CollaborationMessageRow;

export interface CollaborationReadStateRow {
  thread_id: string;
  last_read_message_id: string | null;
  updated_at: string;
}

/**
 * A collaboration turn ledger row (PR-03). Records one scheduled AI reply's
 * lifecycle (streaming / error / usage recovery) — NOT a transcript copy. The
 * visible message lives in `collaboration_messages`; this row exists so a stop /
 * retry / recovery pass can reason about an in-flight speaker turn.
 */
export interface CollaborationTurnRow {
  turn_id: string;
  thread_id: string;
  trigger_message_id: string | null;
  employee_id: string | null;
  sequence_index: number;
  status: string;
  runtime_request_id: string;
  /** Exact engine/account/model selection frozen before the runtime is invoked. */
  execution_target_json: string;
  /** Host-observed final identity. Required for complete turns by the SQL baseline. */
  result_provenance_json: string | null;
  usage_json: string | null;
  error_summary: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export type NewCollaborationTurn = CollaborationTurnRow;

/** Immutable engine/account/billing lane claimed by the first turn on a thread. */
export interface CollaborationExecutionLane {
  engineId: string;
  accountId: string;
  billingMode: 'api' | 'subscription';
}

/** Storage shape for the one first-writer-wins lane row owned by a thread. */
export interface CollaborationExecutionLaneRow {
  thread_id: string;
  engine_id: string;
  account_id: string;
  billing_mode: 'api' | 'subscription';
}

/** Patch for the mutable turn fields the controller advances over a turn's life. */
export interface CollaborationTurnPatch {
  status?: string;
  runtime_request_id?: string;
  result_provenance_json?: string | null;
  usage_json?: string | null;
  error_summary?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

/**
 * Patch for the mutable fields of an existing collaboration message (PR-03
 * streaming upsert). Only `body` / `status` / `edited_at` are mutable; the keyset
 * (`created_at`, `message_id`) is immutable so pagination never shifts.
 */
export interface CollaborationMessagePatch {
  body?: string;
  status?: string;
  edited_at?: string | null;
}

/** Patch for the small set of mutable thread fields the service updates. */
export interface CollaborationThreadPatch {
  title?: string;
  reply_policy?: string;
  capability_profile?: string;
  round_speaker_limit?: number;
  archived_at?: string | null;
  updated_at: string;
}

export interface CollaborationThreadRepository {
  /** Idempotent insert keyed on thread_id (INSERT OR IGNORE semantics). */
  insert(row: NewCollaborationThread): Promise<void>;
  findById(threadId: string): Promise<CollaborationThreadRow | null>;
  /**
   * The single ACTIVE direct thread for `(companyId, employeeId)`, or null. Used
   * by `getOrCreateDirect` to enforce the active-direct uniqueness invariant
   * before inserting.
   */
  findActiveDirect(companyId: string, employeeId: string): Promise<CollaborationThreadRow | null>;
  /**
   * The most-recently-archived direct thread for `(companyId, employeeId)`, or
   * null. `getOrCreateDirect` restores this instead of creating a duplicate.
   */
  findArchivedDirect(companyId: string, employeeId: string): Promise<CollaborationThreadRow | null>;
  /** Non-archived threads for the company; caller orders by last activity. */
  listByCompany(companyId: string): Promise<CollaborationThreadRow[]>;
  update(threadId: string, patch: CollaborationThreadPatch): Promise<void>;
}

export interface CollaborationMemberRepository {
  insert(row: NewCollaborationThreadMember): Promise<void>;
  /** Active members (left_at IS NULL) of the thread. */
  listActiveByThread(threadId: string): Promise<CollaborationThreadMemberRow[]>;
  /** All members of the thread, including those that left. */
  listAllByThread(threadId: string): Promise<CollaborationThreadMemberRow[]>;
  /** Mark a member as left at `leftAt` (idempotent — no-op if already left). */
  markLeft(memberId: string, leftAt: string): Promise<void>;
}

export interface CollaborationMessageRepository {
  insert(row: NewCollaborationMessage): Promise<void>;
  findById(messageId: string): Promise<CollaborationMessageRow | null>;
  /**
   * Look up a previously-appended message by its `idempotency_key` column value
   * (a dedicated column deduped by a partial-unique index — NOT a metadata
   * field), scoped to the thread. Backs append idempotency.
   */
  findByIdempotencyKey(
    threadId: string,
    idempotencyKey: string,
  ): Promise<CollaborationMessageRow | null>;
  /**
   * One page of messages for the thread, NEWEST first, keyset-paginated by
   * `(created_at, message_id)`. `before` returns rows strictly older than the
   * cursor — no duplicates across pages, no gaps. `limit` rows are returned.
   */
  listByThread(
    threadId: string,
    opts?: {
      limit?: number;
      before?: { createdAt: string; messageId: string };
    },
  ): Promise<CollaborationMessageRow[]>;
  /** The newest message in the thread, or null. Used for list ordering. */
  findLatestByThread(threadId: string): Promise<CollaborationMessageRow | null>;
  /** Count messages strictly newer than `messageId` — backs unread computation. */
  countSince(threadId: string, messageId: string | null): Promise<number>;
  /**
   * Update an EXISTING message's mutable fields (PR-03 streaming upsert). The
   * collaboration turn controller inserts a `streaming` placeholder under a stable
   * `message_id`, then advances `body` / `status` / `edited_at` as the reply
   * settles — so the visible row stays authoritative across stop / retry / failure
   * without re-inserting. A no-op when the message id is absent. Never moves the
   * keyset (`created_at` / `message_id` are immutable here).
   */
  update(messageId: string, patch: CollaborationMessagePatch): Promise<void>;
}

export interface CollaborationReadStateRepository {
  findByThread(threadId: string): Promise<CollaborationReadStateRow | null>;
  /** Upsert the last-read boundary for the thread. */
  upsert(row: CollaborationReadStateRow): Promise<void>;
}

export interface CollaborationTurnRepository {
  /**
   * Atomically claim the thread's immutable execution lane, or verify that the
   * existing claim matches. Returns false when another caller already claimed a
   * different engine/account/billing lane.
   */
  bindThreadExecutionLane(threadId: string, lane: CollaborationExecutionLane): Promise<boolean>;
  /** Idempotent insert keyed on turn_id (INSERT OR IGNORE semantics). */
  insert(row: NewCollaborationTurn): Promise<void>;
  findById(turnId: string): Promise<CollaborationTurnRow | null>;
  /** The thread's turns in speaker order (ascending sequence_index). */
  listByThread(threadId: string): Promise<CollaborationTurnRow[]>;
  /** Advance a turn's lifecycle fields (status / usage / error / timestamps). */
  update(turnId: string, patch: CollaborationTurnPatch): Promise<void>;
}
