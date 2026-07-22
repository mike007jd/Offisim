import type {
  ChatThread,
  InteractionKind,
  InteractionMode,
  NewChatThread,
} from '@offisim/shared-types';

export type { ChatThread, NewChatThread } from '@offisim/shared-types';

/** Row types — mirror db-local schema shapes */

export interface GraphThreadRow {
  thread_id: string;
  company_id: string;
  entry_mode: string;
  root_task_id: string | null;
  status: string;
  project_id: string | null;
  interaction_mode: InteractionMode;
  synopsis_json: string | null;
  compact_baseline_json: string | null;
  created_at: string;
  updated_at: string;
}

/** New-row types (omit auto-generated fields) */
export type NewGraphThread = Omit<
  GraphThreadRow,
  | 'created_at'
  | 'updated_at'
  | 'project_id'
  | 'interaction_mode'
  | 'synopsis_json'
  | 'compact_baseline_json'
> & {
  project_id?: string | null;
  interaction_mode?: InteractionMode;
  synopsis_json?: string | null;
  compact_baseline_json?: string | null;
};

export interface ThreadRepository {
  create(thread: NewGraphThread): Promise<GraphThreadRow>;
  findById(threadId: string): Promise<GraphThreadRow | null>;
  findByCompany(
    companyId: string,
    opts?: { limit?: number; status?: string },
  ): Promise<GraphThreadRow[]>;
  findByCompanyAndStatus(companyId: string, status: string): Promise<GraphThreadRow[]>;
  updateStatus(threadId: string, status: string): Promise<void>;
  updateInteractionMode(threadId: string, interactionMode: InteractionMode): Promise<void>;
  updateSynopsis(threadId: string, synopsisJson: string | null): Promise<void>;
  updateCompactBaseline(threadId: string, compactBaselineJson: string | null): Promise<void>;
}

// ---------------------------------------------------------------------------
// Durable interactions
// ---------------------------------------------------------------------------

export type InteractionHistoryStatus = 'resolved' | 'cancelled' | 'superseded';

export interface InteractionActiveRow {
  thread_id: string;
  company_id: string;
  interaction_id: string;
  kind: InteractionKind;
  interaction_mode: InteractionMode;
  request_json: string;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}

export type NewInteractionActive = InteractionActiveRow;

export interface ActiveInteractionRepository {
  upsert(row: NewInteractionActive): Promise<InteractionActiveRow>;
  findByThread(threadId: string): Promise<InteractionActiveRow | null>;
  findByCompany(companyId: string): Promise<InteractionActiveRow[]>;
  deleteByThread(threadId: string): Promise<void>;
}

export interface InteractionHistoryRow {
  history_id: string;
  interaction_id: string;
  thread_id: string;
  company_id: string;
  kind: InteractionKind;
  interaction_mode: InteractionMode;
  status: InteractionHistoryStatus;
  selected_option_id: string | null;
  freeform_response: string | null;
  request_json: string;
  response_json: string | null;
  payload_json: string | null;
  created_at: string;
  resolved_at: string;
}

export type NewInteractionHistory = InteractionHistoryRow;

export interface InteractionHistoryRepository {
  create(row: NewInteractionHistory): Promise<InteractionHistoryRow>;
  listByThread(threadId: string, opts?: { limit?: number }): Promise<InteractionHistoryRow[]>;
  listByCompany(companyId: string, opts?: { limit?: number }): Promise<InteractionHistoryRow[]>;
}

// ---------------------------------------------------------------------------
// Chat threads (product-layer thread metadata; decoupled from graph_threads)
// ---------------------------------------------------------------------------

export interface ChatThreadRepository {
  create(input: NewChatThread): Promise<ChatThread>;
  findById(threadId: string): Promise<ChatThread | null>;
  /** Non-archived threads for the project, ordered by `updated_at DESC`. */
  listByProject(projectId: string): Promise<ChatThread[]>;
  /** All threads for the project, including soft-archived rows. Used by hard-delete cascades. */
  listAllByProject(projectId: string): Promise<ChatThread[]>;
  /**
   * Update the thread title.
   *
   * - When `byUser === true`, persist the title and set `title_set_by_user = 1`.
   * - When `byUser === false`, no-op if the row already has `title_set_by_user = 1`
   *   (preserves a user-set rename); otherwise persist the title and keep
   *   `title_set_by_user = 0`.
   *
   * Returns the row's persisted `title_set_by_user` after the call so callers
   * (e.g. boss auto-title) can detect a no-op without re-reading.
   */
  updateTitle(
    threadId: string,
    title: string,
    opts: { byUser: boolean },
  ): Promise<{ title: string; title_set_by_user: 0 | 1; persisted: boolean }>;
  /** Claim the thread's one semantic-title job. A manual title or an existing
   * claim refuses the write, preventing restart/retry duplicate billing. */
  beginSemanticTitleJob(input: {
    threadId: string;
    jobId: string;
    sourceProvenanceJson: string;
  }): Promise<boolean>;
  /** Persist a generated title only while this job still owns an unrenamed row. */
  completeSemanticTitleJob(input: {
    threadId: string;
    jobId: string;
    title: string;
    resultProvenanceJson: string;
    usageJson: string | null;
  }): Promise<boolean>;
  /** Close a claimed job without changing its readable fallback title. */
  failSemanticTitleJob(input: {
    threadId: string;
    jobId: string;
    errorCode: string;
  }): Promise<void>;
  /** Bumps `updated_at`. Used after activity on the thread. */
  touch(threadId: string): Promise<void>;
  /** Sets `archived_at` to now. Idempotent — no-op when already archived. */
  archive(threadId: string): Promise<void>;
  /** Clears `archived_at`. Idempotent — no-op when the row is already active or missing. */
  unarchive(threadId: string): Promise<void>;
  /** Hard delete. Callers that own an AttachmentStore must cascade blobs before invoking this. */
  delete(threadId: string): Promise<void>;
  /**
   * Idempotent: if the project has zero non-archived `chat_threads` rows,
   * insert one with `title = 'New thread'`. Returns the most-recently-updated
   * non-archived thread for the project (the freshly-created one or the
   * existing one).
   */
  ensureProjectHasAtLeastOneThread(projectId: string): Promise<ChatThread>;
}

/** A persisted pi-kernel transcript message row (table `pi_messages`). */
export interface PiMessageRow {
  message_id: string;
  thread_id: string;
  company_id: string;
  /** Worker that owns this thread turn (null = boss). Used to resume as the right worker. */
  employee_id: string | null;
  seq: number;
  role: string;
  message_json: string;
  created_at: string;
}

/** Per-message persistence for the pi agent loop (replaces graph checkpoints). */
export interface PiMessageRepository {
  listByThread(threadId: string): Promise<PiMessageRow[]>;
  append(rows: readonly PiMessageRow[]): Promise<void>;
  /** Highest persisted seq for the thread, or -1 when empty. */
  maxSeq(threadId: string): Promise<number>;
  /** `employee_id` of the thread's last row (null = boss / empty) — for resume. */
  lastEmployeeId(threadId: string): Promise<string | null>;
  /** Delete the oldest persisted rows for a thread, preserving seq values of the remaining tail. */
  deleteFirstByThread(threadId: string, count: number): Promise<void>;
  deleteByThread(threadId: string): Promise<void>;
}
