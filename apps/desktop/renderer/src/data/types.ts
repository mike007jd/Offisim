import type { EmployeeAppearance } from '@/lib/avatar.js';
import type {
  AiSubscriptionUsageSnapshot,
  AttachmentKind,
  RoleSlug,
  VaultRef,
  WorkspaceProvenance,
} from '@offisim/shared-types';
import type { TokenBudgetAlert } from './token-budget-policy.js';

export type { EmployeeAppearance };

/**
 * Renderer view-model types. These are presentation contracts for the desktop
 * UI; they are intentionally decoupled from the core runtime/db schema. Product
 * data must come from Tauri repositories and sandboxed commands.
 */

export type RunState = 'idle' | 'running' | 'paused' | 'error' | 'done';

export interface Company {
  id: string;
  name: string;
  initials: string;
  accentA: string;
  accentB: string;
  /** Real template label chosen at creation (e.g. "R&D Company"), or "Custom". */
  templateLabel: string;
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  workspaceRoot: string;
  branch: string | null;
  verifyCommand: string | null;
  verifyMaxAttempts: number;
  verifyTokenBudget: number | null;
}

type EmployeeKind = 'internal' | 'external';

/** Live presence derived from the runtime: idle in office, executing a run,
 *  blocked on a gate, failed, or offline/asleep. */
export type EmployeePresence = 'working' | 'idle' | 'blocked' | 'failed' | 'offline';

/** Exact graph_threads.status values projected into the renderer. */
export type ThreadRuntimeStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | null;

export interface Employee {
  id: string;
  name: string;
  role: string;
  kind: EmployeeKind;
  brandLabel?: string;
  online: boolean;
  avatarA: string;
  avatarB: string;
  appearance?: EmployeeAppearance;
  discipline: string;
  /** Canonical role family — drives dramaturgy performance flavor (tempo). */
  roleSlug?: RoleSlug;
  /** Persisted Pi model binding. Null/absent inherits the conversation model. */
  model?: string | null;
  /** Optional Pi reasoning effort paired with the employee binding. */
  thinkingLevel?: string | null;
  modelLabel: string;
  skillCount: number;
  /** Office zone the workstation sits in, e.g. "Engineering Bay". */
  zoneLabel?: string;
  /** Persisted workstation assignment; zone-level moves use the zone id as the workstation id. */
  workstationId?: string | null;
  /** Desk/seat label within the zone, e.g. "Desk 1". */
  deskLabel?: string;
  expertise?: string[];
  /** Disabled employees stay in the roster but do not run. */
  disabled?: boolean;
}

type ThreadScope = 'team' | 'direct';

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  subtitle: string;
  scope: ThreadScope;
  employeeId: string | null;
  updatedAt: number;
  runState: RunState;
  /** Exact graph status; keeps blocked and failed distinct for Office presence. */
  runtimeStatus: ThreadRuntimeStatus;
}

type MessageAuthor = 'boss' | 'employee' | 'system';

export interface ChatAttachment {
  id: string;
  name: string;
  sizeLabel: string;
  ext: string;
  vaultRef?: VaultRef;
  mimeType?: string;
  byteLength?: number;
  kind?: AttachmentKind;
  summary?: string;
}

interface RunRecordStep {
  id: string;
  label: string;
  detail: string;
  state: 'done' | 'running' | 'pending' | 'error';
}

/** One Activity entry inside a sedimented run record (tool call / event). */
interface RunActivityEntry {
  id: string;
  /** Tool / domain label e.g. "read", "edit", "bash". */
  tool: string;
  detail: string;
  state: 'done' | 'running' | 'pending' | 'error';
  /** Collapsed repeat count for consecutive identical entries. */
  repeat?: number;
}

/** One Plan step inside a run record: who did what, role and cost. */
interface RunPlanStep {
  id: string;
  label: string;
  assigneeId: string | null;
  roleLabel: string;
  costLabel?: string;
  state: 'done' | 'running' | 'pending' | 'error';
}

export interface RunRecord {
  id: string;
  title: string;
  meta: string;
  costLabel: string;
  steps: RunRecordStep[];
  /** Activity + Plan sub-regions shown when the record is expanded. */
  activity?: RunActivityEntry[];
  plan?: RunPlanStep[];
}

/** A single tool invocation surfaced inline in the assistant message stream
 *  (rendered as a native assistant-ui `tool-call` content part). The Pi host
 *  does not forward tool args/output to the renderer bus yet, so only the tool
 *  identity, lifecycle status, and duration are carried. */
export interface ChatToolCall {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  author: MessageAuthor;
  employeeId: string | null;
  body: string;
  reasoning?: string;
  /** Assistant reply target; lets retry/checkpoint projections replace one run response. */
  replyToMessageId?: string;
  /** Stable run attempt id emitted by the ConversationRunController. */
  attemptId?: string;
  /** Live persistence state for streamed checkpoints and interrupted runs. */
  status?: 'streaming' | 'complete' | 'interrupted' | 'failed';
  /** Live + in-session tool steps; not persisted (lost on reload by design). */
  toolCalls?: ChatToolCall[];
  /** Structured Project-folder recovery provenance for this Turn. Product copy
   * is derived at the presentation boundary and never persisted as authority. */
  workspaceProvenance?: WorkspaceProvenance;
  at: number;
  attachments?: ChatAttachment[];
  runRecord?: RunRecord;
}

export interface Deliverable {
  id: string;
  threadId?: string | null;
  /** The run that produced this artifact — its provenance / "where it came from". */
  runId?: string | null;
  name: string;
  kind: string;
  contributorIds: string[];
  fileName?: string | null;
  mimeType?: string | null;
  contentSize?: number;
  /** Short body preview shown in the expanded deliverable card. */
  preview?: string;
  /** Default export format label, e.g. "MD". */
  format?: string;
}

/* --- Git workbench (left workspace panel, Git tab) --------------------------*/

type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitFileChange {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  added: number;
  removed: number;
}

type GitCheckState = 'pass' | 'fail' | 'running';

interface GitCheck {
  id: string;
  label: string;
  state: GitCheckState;
}

export interface GitWorkbench {
  branch: string;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  /** Unified diff preview lines for the focused file. */
  diffPreview: Array<{ kind: 'add' | 'remove' | 'context'; text: string }>;
  diffFiles: Array<{ path: string; diff: string }>;
  checks: GitCheck[];
}

/** Resolved git state for a project's bound workspace folder. Distinguishes the
 *  three non-repo causes so the UI can route them differently — Initialize a
 *  valid uninitialized folder, Rebind an invalid/missing one, Bind an unbound
 *  project — instead of collapsing all of them into a single null "not a repo"
 *  state that only ever offered Rebind. */
export type GitRepoState =
  | { status: 'repo'; workbench: GitWorkbench }
  | { status: 'uninitialized' }
  | { status: 'invalid-folder' }
  | { status: 'unbound' };

export interface RunCost {
  /** Exact only when every provider contribution supplied every additive bucket. */
  tokens: number | null;
  knownTokens: number;
  tokenCoverage: 'complete' | 'partial' | 'unavailable';
  monthlyTokens: number | null;
  monthlyKnownTokens: number;
  monthlyTokenCoverage: 'complete' | 'partial' | 'unavailable';
  sessionTokens: number | null;
  sessionKnownTokens: number;
  sessionTokenCoverage: 'complete' | 'partial' | 'unavailable';
  /** Exact engine/account lane(s) proven by the selected Conversation's persisted root usage. */
  sessionAccounts: RunAccountingAccount[];
  sessionCostKind: 'actual' | 'estimate' | 'unavailable' | 'none';
  sessionCostLabel: string;
  /** Provider-native subscription limits for the selected lane, never local token math. */
  sessionSubscriptionUsage: AiSubscriptionUsageSnapshot | null;
  costKind: 'actual' | 'estimate' | 'unavailable' | 'none';
  costLabel: string;
  live: boolean;
  breakdown: RunCostBreakdown[];
  alerts: TokenBudgetAlert[];
}

export interface RunAccountingAccount {
  engineId: string;
  accountId: string;
  billingMode: 'api' | 'subscription';
}

export interface RunCostBreakdown {
  employeeId: string | null;
  employeeName: string;
  model: string;
  tokens: number | null;
  knownTokens: number;
  tokenCoverage: 'complete' | 'partial' | 'unavailable';
  costKind: 'actual' | 'estimate' | 'unavailable';
  costLabel: string;
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  depth: number;
}

export type ZoneKind = 'workspace' | 'meeting' | 'lounge';

export interface Skill {
  id: string;
  name: string;
  description: string;
  scope: 'global' | 'company' | 'employee';
  /** True only when the vault-authoritative SKILL.md exists and will be passed
   * to Pi's native resource loader at session creation. */
  runtimeInjected: boolean;
}

/** A recoverable chat run failure. Drives the in-thread ErrorBanner. */
export interface RunError {
  id: string;
  message: string;
  /** Technical detail revealed under "Details". */
  technicalDetail: string;
  /**
   * Re-dispatch closure for the failed send, set by the runtime that surfaced
   * the error. Absent when the failure cannot be re-dispatched (e.g. a seeded
   * historical error), in which case the banner honestly stays dismiss-only.
   * Riding on the error keeps the pair's lifecycle atomic: whatever replaces
   * or clears the error replaces or clears the retry with it.
   */
  retry?: () => void;
  /** A typed recovery action that is not an ordinary re-dispatch. Native
   * session reset uses this so the UI says exactly what will happen and never
   * disguises a fresh session as Retry. Mutually exclusive with `retry`. */
  recoveryAction?: {
    label: string;
    run: () => void;
  };
}

/* --- Chat attachment staging ------------------------------------------------*/

type AttachmentStatus = 'attached' | 'error';

/** Canonical staging failure reasons (size cap, dedupe, unsupported, etc.). */
export type AttachmentFailReason =
  | 'too-large'
  | 'duplicate'
  | 'unsupported-type'
  | 'storage-unavailable'
  | 'too-many';

export const ATTACHMENT_FAIL_MESSAGE: Record<AttachmentFailReason, string> = {
  'too-large': 'File exceeds the 8 MB attachment limit.',
  duplicate: 'This file is already attached.',
  'unsupported-type': 'This file type can’t be attached.',
  'storage-unavailable': 'Attachment storage is unavailable right now.',
  'too-many': 'You can attach up to 6 files per message.',
};

export interface StagedAttachment {
  id: string;
  name: string;
  ext: string;
  sizeLabel: string;
  status: AttachmentStatus;
  mimeType?: string;
  byteLength?: number;
  bytes?: Uint8Array;
  sha256?: string;
  attachmentId?: string;
  file?: { arrayBuffer(): Promise<ArrayBuffer> };
  kind?: AttachmentKind;
  summary?: string;
  /** Present when status is "error". */
  failReason?: AttachmentFailReason;
}
