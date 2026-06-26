/**
 * Collaboration domain model (PR-02). Types-only contract for the company-scoped
 * daily chat aggregate (direct + group), FULLY separate from the project-scoped
 * `chat_threads` thread metadata.
 *
 * A Collaboration thread belongs to a COMPANY, never a project: no `projectId`
 * appears anywhere in this contract or in the repository/service interfaces it
 * backs. Field names are camelCase (domain); the SQLite columns are snake_case
 * and the mapping lives in the repositories (`@offisim/core` runtime/repos/
 * collaboration).
 */

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export type CollaborationThreadKind = 'direct' | 'group';

/**
 * How employees in the thread react to a message.
 * - `mentions_only` — only @mentioned employees reply (default).
 * - `roundtable` — every active employee may reply, up to `roundSpeakerLimit`.
 * - `silent` — employees never auto-reply (boss-only / archival channel).
 */
export type CollaborationReplyPolicy = 'mentions_only' | 'roundtable' | 'silent';

export interface CollaborationThread {
  threadId: string;
  companyId: string;
  kind: CollaborationThreadKind;
  title: string;
  /** Set iff `kind === 'direct'`; the single employee on the other side. */
  directEmployeeId?: string | null;
  replyPolicy: CollaborationReplyPolicy;
  /** Clamped to 1–8 by the service. */
  roundSpeakerLimit: number;
  createdBy: string;
  /** ISO timestamp when soft-archived, or null when active. */
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Member
// ---------------------------------------------------------------------------

export type CollaborationActorType = 'boss' | 'employee';
export type CollaborationMemberRole = 'owner' | 'member';

export interface CollaborationMember {
  memberId: string;
  threadId: string;
  actorType: CollaborationActorType;
  /** null for the boss member; required for employee members. */
  employeeId?: string | null;
  role: CollaborationMemberRole;
  joinedAt: string;
  /** ISO timestamp when the member left, or null when still active. */
  leftAt?: string | null;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export type CollaborationSenderType = 'boss' | 'employee' | 'system';

export type CollaborationMessageStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'interrupted'
  | 'failed';

export interface CollaborationMessage {
  messageId: string;
  threadId: string;
  senderType: CollaborationSenderType;
  /** null for boss/system senders; the author for employee senders. */
  senderEmployeeId?: string | null;
  body: string;
  replyToMessageId?: string | null;
  status: CollaborationMessageStatus;
  /**
   * JSON string. Carries an author SNAPSHOT (e.g. `{"senderLabel":"Alex"}`) so a
   * message stays attributable after the employee is deleted and the FK
   * `sender_employee_id` is set to null. The idempotency key is a dedicated
   * column, not stored here.
   */
  metadataJson?: string | null;
  createdAt: string;
  editedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Service inputs
// ---------------------------------------------------------------------------

export interface CreateDirectThreadInput {
  companyId: string;
  employeeId: string;
  /** Optional override; defaults to the employee's display name when omitted. */
  title?: string;
  /** Defaults to `'mentions_only'`. */
  replyPolicy?: CollaborationReplyPolicy;
  /** Clamped to 1–8. Defaults to 3. */
  roundSpeakerLimit?: number;
}

export interface CreateGroupThreadInput {
  companyId: string;
  title: string;
  /** At least one employee; the boss is added automatically as owner. */
  employeeIds: readonly string[];
  /** Defaults to `'mentions_only'`. */
  replyPolicy?: CollaborationReplyPolicy;
  /** Clamped to 1–8. Defaults to 3. */
  roundSpeakerLimit?: number;
}

export interface AppendCollaborationMessageInput {
  threadId: string;
  senderType: CollaborationSenderType;
  senderEmployeeId?: string | null;
  body: string;
  replyToMessageId?: string | null;
  /** Defaults to `'complete'`. */
  status?: CollaborationMessageStatus;
  /**
   * Human-readable author label persisted into `metadataJson` so the message
   * stays attributable after the sender employee is deleted (FK SET NULL).
   */
  senderLabel?: string | null;
  /** Extra metadata merged into `metadataJson` (author snapshot is always added). */
  metadata?: Record<string, unknown>;
  /**
   * Idempotency key. A second append with the same key on the same thread is a
   * no-op that returns the already-stored message, so a double-click (or a
   * retried first-message materialization) never produces a duplicate.
   */
  idempotencyKey?: string;
}

/** Opaque pagination cursor for {@link CollaborationService.listMessages}. */
export interface CollaborationMessageCursor {
  /** `created_at` of the last message returned by the previous page. */
  createdAt: string;
  /** `message_id` of that message — tiebreaks rows that share `created_at`. */
  messageId: string;
}

export interface CollaborationMessagePage {
  messages: CollaborationMessage[];
  /** Cursor to fetch the next (older) page, or null when the start is reached. */
  nextCursor: CollaborationMessageCursor | null;
}
